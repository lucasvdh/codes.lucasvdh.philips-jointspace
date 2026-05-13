#!/usr/bin/env node
/**
 * Probe what payload shape the TV actually accepts for POST /screenstate.
 *
 * The app currently POSTs {screenstate:"screenOff"} but the TV returns 200
 * without acting on it. ha-philipsjs uses {screenstate:"Off"} (capital O).
 * This script tries every plausible variant on a paired TV, with a GET
 * before/after each POST so you can see whether the value actually flipped.
 *
 * Watch the TV: a working variant should turn the screen off (audio keeps
 * playing). The script flips it back to On after each round.
 *
 * Usage:
 *   node scripts/debug-screenstate.mjs <tv-ip> [credentials.json]
 *
 * credentials.json (defaults to ./credentials.json) must contain:
 *   { "user": "<digest-user>", "pass": "<digest-password>" }
 * Optionally: { "host": "...", "apiVersion": 6 }
 */

import { argv, exit, stdout } from "node:process";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { setTimeout as wait } from "node:timers/promises";

const TIMEOUT_MS = 8000;
const SETTLE_MS = 2500; // pause between POST and read-back

const VARIANTS = [
  { label: "current app payload", body: { screenstate: "screenOff" } },
  { label: "ha-philipsjs style",  body: { screenstate: "Off" } },
  { label: "lowercase",           body: { screenstate: "off" } },
  { label: "uppercase",           body: { screenstate: "OFF" } },
  { label: "underscore caps",     body: { screenstate: "SCREEN_OFF" } },
  { label: "wrapped value",       body: { screenstate: { value: "Off" } } },
];

function loadCreds(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(`Could not read ${path}: ${err.message}`);
    exit(1);
  }
}

const md5 = (s) => createHash("md5").update(s).digest("hex");

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

function rawRequest({ url, method, headers, body }) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const payload = body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    const opts = {
      host: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method,
      headers: {
        Accept: "application/json",
        ...(payload && { "Content-Type": "application/json", "Content-Length": payload.length }),
        ...(headers ?? {}),
      },
      rejectUnauthorized: false,
      timeout: TIMEOUT_MS,
    };
    const req = httpsRequest(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({
          ok: true,
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      res.on("error", (err) => resolve({ ok: false, error: err.message }));
    });
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", (err) => resolve({ ok: false, error: err.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function digestRequest({ url, method, body, creds }) {
  const u = new URL(url);
  const uri = u.pathname + u.search;
  let response = await rawRequest({ url, method, body });
  if (!response.ok) return response;
  if (response.status === 401) {
    const challenge = parseChallenge(response.headers["www-authenticate"]);
    if (!challenge) return response;
    const authHeader = buildAuthHeader(challenge, {
      user: creds.user, pass: creds.pass, method, uri, nc: "00000001",
    });
    response = await rawRequest({ url, method, body, headers: { Authorization: authHeader } });
  }
  return response;
}

function summariseBody(text) {
  if (!text) return "(empty)";
  try { return JSON.stringify(JSON.parse(text)); } catch { return text.slice(0, 200); }
}

async function readScreenstate(url, creds) {
  const r = await digestRequest({ url, method: "GET", creds });
  if (!r.ok) return `error: ${r.error}`;
  return `${r.status} ${summariseBody(r.body)}`;
}

async function main() {
  const ip = argv[2];
  const credsPath = argv[3] ?? "./credentials.json";
  if (!ip) {
    console.error("Usage: node scripts/debug-screenstate.mjs <tv-ip> [credentials.json]");
    exit(1);
  }
  const creds = loadCreds(credsPath);
  const apiVersion = creds.apiVersion ?? 6;
  const url = `https://${ip}:1926/${apiVersion}/screenstate`;

  console.log(`Probing ${url}\n`);
  console.log(`initial GET    = ${await readScreenstate(url, creds)}\n`);

  for (const { label, body } of VARIANTS) {
    stdout.write(`POST ${JSON.stringify(body).padEnd(48)} — `);
    const post = await digestRequest({ url, method: "POST", body, creds });
    if (!post.ok) {
      console.log(`error: ${post.error}`);
      continue;
    }
    console.log(`${post.status} ${summariseBody(post.body)}`);
    await wait(SETTLE_MS);
    console.log(`  → after ${SETTLE_MS}ms, GET = ${await readScreenstate(url, creds)}    (${label})`);

    // If the screen actually went off, restore it so we can test the next variant.
    await digestRequest({ url, method: "POST", body: { screenstate: "screenOn" }, creds });
    await digestRequest({ url, method: "POST", body: { screenstate: "On" }, creds });
    await wait(SETTLE_MS);
  }

  console.log(`\nfinal GET     = ${await readScreenstate(url, creds)}`);
  console.log(`\nWatch the TV: a variant is "working" if you saw the screen turn off`);
  console.log(`(briefly — the script flips it back on after each probe). Match the`);
  console.log(`visible behaviour with the labels above.`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  exit(1);
});
