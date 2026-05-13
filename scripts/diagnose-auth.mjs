#!/usr/bin/env node
/**
 * Auth-aware Philips Jointspace diagnostic.
 *
 * Uses Node's built-in `https.request` / `http.request` (same stack as
 * axios in the app, same as needle in v2.5.1). Earlier versions of this
 * script used `fetch()` which goes through undici; on some Philips TVs
 * undici's TLS connector fails where Node's native one works, so the
 * fetch-based probe was reporting false negatives. This version matches
 * what the app actually does.
 *
 * Usage:
 *   node scripts/diagnose-auth.mjs <tv-ip> [credentials.json]
 *
 * credentials.json (defaults to ./credentials.json) must contain at least:
 *   { "user": "<digest-user>", "pass": "<digest-password>" }
 * Optionally: { "host": "...", "apiVersion": 6 }
 *
 * Requires Node 18+. No npm install.
 */

import { argv, exit } from "node:process";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const PROBE_TIMEOUT_MS = 8000;
const PREVIEW_LENGTH = 600;

const ENDPOINTS = [
  { label: "System info", method: "GET", path: "system", auth: false, noPrefix: true },
  { label: "Power state", method: "GET", path: "powerstate", auth: true },
  { label: "Audio / volume", method: "GET", path: "audio/volume", auth: true },
  { label: "Ambilight configuration", method: "GET", path: "ambilight/currentconfiguration", auth: true },
  { label: "AmbiHue state", method: "GET", path: "HueLamp/power", auth: true },
  { label: "Screen state", method: "GET", path: "screenstate", auth: true },
  { label: "Applications", method: "GET", path: "applications", auth: true },
  { label: "Sources", method: "GET", path: "sources", auth: true },
  { label: "Channel database (TV)", method: "GET", path: "channeldb/tv", auth: true },
  { label: "Current activity", method: "GET", path: "activities/current", auth: true },
];

function loadCredentials(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    console.error(`Could not read ${path}: ${err.message}`);
    exit(1);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error(`${path} is not valid JSON: ${err.message}`);
    exit(1);
  }
  const user = data.user ?? data.username;
  const pass = data.pass ?? data.password;
  if (!user || !pass) {
    console.error(`${path} must contain user/pass (or username/password) fields.`);
    exit(1);
  }
  return {
    user,
    pass,
    host: data.host,
    apiVersion: typeof data.apiVersion === "number" ? data.apiVersion : 6,
  };
}

function md5(s) {
  return createHash("md5").update(s).digest("hex");
}

function parseChallenge(headerValue) {
  if (typeof headerValue !== "string" || !/^digest/i.test(headerValue)) return null;
  const body = headerValue.replace(/^digest\s*/i, "");
  const params = {};
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|([^,]+))/g;
  let m;
  while ((m = re.exec(body))) params[m[1].toLowerCase()] = (m[2] ?? m[3] ?? "").trim();
  if (!params.realm || !params.nonce) return null;
  return params;
}

function buildAuthHeader(challenge, { user, pass, method, uri, nc }) {
  const cnonce = randomBytes(8).toString("hex");
  const ha1 = md5(`${user}:${challenge.realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const qopOptions = (challenge.qop ?? "").split(",").map((s) => s.trim());
  const qop = qopOptions.includes("auth") ? "auth" : qopOptions[0] || undefined;
  const responseHash = qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  const parts = [
    `username="${user}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${responseHash}"`,
  ];
  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
  if (qop) {
    parts.push(`qop=${qop}`);
    parts.push(`nc=${nc}`);
    parts.push(`cnonce="${cnonce}"`);
  }
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  return `Digest ${parts.join(", ")}`;
}

function rawRequest({ url, method, headers }) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const requestFn = u.protocol === "https:" ? httpsRequest : httpRequest;
    const started = Date.now();
    const opts = {
      host: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: u.pathname + u.search,
      method,
      headers: { Accept: "application/json", ...(headers ?? {}) },
      rejectUnauthorized: false,
      timeout: PROBE_TIMEOUT_MS,
    };
    const req = requestFn(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: true,
          status: res.statusCode,
          headers: res.headers,
          body: text,
          durationMs: Date.now() - started,
        });
      });
      res.on("error", (err) =>
        resolve({ ok: false, error: err.message, code: err.code, durationMs: Date.now() - started }),
      );
    });
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", (err) =>
      resolve({ ok: false, error: err.message, code: err.code, durationMs: Date.now() - started }),
    );
    req.end();
  });
}

async function probe({ url, method, useAuth, creds }) {
  const u = new URL(url);
  const uri = u.pathname + u.search;
  const result = { url, method, status: "fail", durationMs: 0 };

  let response = await rawRequest({ url, method });
  if (!response.ok) {
    result.durationMs = response.durationMs;
    result.errorName = "Error";
    result.errorMessage = response.error;
    result.errorCode = response.code;
    return result;
  }

  if (useAuth && response.status === 401) {
    const challenge = parseChallenge(response.headers["www-authenticate"]);
    if (challenge) {
      const nc = "00000001";
      const authHeader = buildAuthHeader(challenge, { user: creds.user, pass: creds.pass, method, uri, nc });
      response = await rawRequest({ url, method, headers: { Authorization: authHeader } });
      if (!response.ok) {
        result.durationMs = response.durationMs;
        result.errorName = "Error";
        result.errorMessage = response.error;
        result.errorCode = response.code;
        return result;
      }
    }
  }

  result.durationMs = response.durationMs;
  result.statusCode = response.status;
  result.contentType = response.headers["content-type"] ?? "";
  const text = response.body ?? "";
  if (text.length === 0) {
    result.bodyPreview = "(empty body)";
  } else if (String(result.contentType).includes("application/json")) {
    try {
      const parsed = JSON.parse(text);
      result.bodyPreview = JSON.stringify(parsed).slice(0, PREVIEW_LENGTH);
    } catch {
      result.bodyPreview = text.slice(0, PREVIEW_LENGTH);
    }
  } else {
    result.bodyPreview = text.slice(0, PREVIEW_LENGTH);
  }
  result.status = response.status >= 200 && response.status < 300 ? "ok" : "http_error";
  return result;
}

async function main() {
  const ipArg = argv[2];
  const credsPath = argv[3] ?? "./credentials.json";
  const creds = loadCredentials(credsPath);
  const ip = ipArg ?? creds.host;
  if (!ip) {
    console.error("No IP provided as argument or 'host' field in credentials.json");
    exit(1);
  }
  const apiVersion = creds.apiVersion;

  const results = [];
  for (const ep of ENDPOINTS) {
    for (const transport of [
      { name: "HTTP/1925", protocol: "http", port: 1925 },
      { name: "HTTPS/1926", protocol: "https", port: 1926 },
    ]) {
      const path = ep.noPrefix ? ep.path : `${apiVersion}/${ep.path}`;
      const url = `${transport.protocol}://${ip}:${transport.port}/${path}`;
      const r = await probe({ url, method: ep.method, useAuth: ep.auth, creds });
      results.push({ label: `${ep.label} (${transport.name})`, ...r });
    }
  }

  console.log(renderReport(ip, apiVersion, creds.user, results));
}

function renderReport(ip, apiVersion, user, results) {
  const lines = [];
  lines.push("# Philips Jointspace auth-aware diagnostic (Node https.request)");
  lines.push("");
  lines.push(`- Target IP: ${ip}`);
  lines.push(`- API version prefix: /${apiVersion}/`);
  lines.push(`- Digest user: ${user}`);
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Node: ${process.version} on ${process.platform}`);
  lines.push("");

  lines.push("## Probes");
  lines.push("");
  lines.push("| Result | Endpoint | Status | Time | Body preview |");
  lines.push("|---|---|---|---|---|");
  for (const r of results) {
    const icon = r.status === "ok" ? "✅" : r.status === "http_error" ? "⚠️" : "❌";
    const statusText = r.statusCode ? `HTTP ${r.statusCode}` : `${r.errorCode ?? r.errorName ?? "error"}`;
    const preview = (r.bodyPreview ?? r.errorMessage ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    const previewTrunc = preview.length > 80 ? `${preview.slice(0, 80)}…` : preview;
    lines.push(`| ${icon} | \`${r.label}\` | ${statusText} | ${r.durationMs} ms | ${previewTrunc} |`);
  }
  lines.push("");

  lines.push("## Raw JSON");
  lines.push("");
  lines.push("<details><summary>Click to expand</summary>");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(results, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("</details>");
  return lines.join("\n");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  exit(2);
});
