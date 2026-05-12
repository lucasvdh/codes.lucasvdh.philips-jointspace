#!/usr/bin/env node
/**
 * Standalone Philips Jointspace diagnostic - for use when the TV is not
 * yet paired with Homey (the in-app diagnostic needs a paired device).
 *
 * Usage:
 *   node scripts/diagnose.mjs <tv-ip>
 *   node scripts/diagnose.mjs 192.168.1.42
 *
 * Probes the unauthenticated /system endpoint on both HTTP/1925 and
 * HTTPS/1926 plus a couple of other endpoints that don't need auth.
 * Prints a Markdown report to stdout - pipe to a file with `> report.md`
 * or copy/paste the output into a GitHub issue.
 *
 * Requires Node 18+ (uses built-in fetch). No npm install needed.
 */

import { argv, exit } from "node:process";
import { Agent } from "node:https";

const PROBE_TIMEOUT_MS = 8000;
const PREVIEW_LENGTH = 600;

const insecureAgent = new Agent({ rejectUnauthorized: false });

async function probe(label, url, opts = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const result = { label, url, status: "fail", durationMs: 0 };
  try {
    const fetchOpts = {
      method: opts.method ?? "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    };
    if (url.startsWith("https://")) {
      // Node fetch in undici lets us configure dispatchers, but for a
      // single insecure call we just shell to a global setting via
      // Node 18+ fetch options. Wrap via "dispatcher" if available.
      fetchOpts.dispatcher = await maybeInsecureDispatcher();
    }
    const response = await fetch(url, fetchOpts);
    result.durationMs = Date.now() - started;
    result.statusCode = response.status;
    result.contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    if (text.length === 0) {
      result.bodyPreview = "(empty body)";
    } else if (result.contentType.includes("application/json")) {
      try {
        const parsed = JSON.parse(text);
        result.bodyJson = parsed;
        result.bodyPreview = JSON.stringify(parsed).slice(0, PREVIEW_LENGTH);
      } catch {
        result.bodyPreview = text.slice(0, PREVIEW_LENGTH);
      }
    } else {
      result.bodyPreview = text.slice(0, PREVIEW_LENGTH);
    }
    result.status = response.status >= 200 && response.status < 300 ? "ok" : "http_error";
  } catch (err) {
    result.durationMs = Date.now() - started;
    result.errorName = err.name;
    result.errorMessage = err.message;
    result.errorCode = err.cause?.code ?? err.code;
  } finally {
    clearTimeout(timer);
  }
  return result;
}

async function maybeInsecureDispatcher() {
  try {
    const undici = await import("undici");
    return new undici.Agent({ connect: { rejectUnauthorized: false } });
  } catch {
    return undefined;
  }
}

async function main() {
  const ip = argv[2];
  if (!ip) {
    console.error("Usage: node scripts/diagnose.mjs <tv-ip>");
    exit(1);
  }

  const probes = [];
  probes.push(await probe("System info (HTTP/1925, no API version prefix)", `http://${ip}:1925/system`));
  probes.push(await probe("System info (HTTPS/1926, no API version prefix)", `https://${ip}:1926/system`));
  probes.push(await probe("System info (HTTP/1925, /1/ prefix)", `http://${ip}:1925/1/system`));
  probes.push(await probe("System info (HTTPS/1926, /6/ prefix)", `https://${ip}:1926/6/system`));
  probes.push(await probe("Power state probe (will 401 if TV requires auth)", `https://${ip}:1926/6/powerstate`));
  probes.push(await probe("Sources probe (legacy TVs only)", `http://${ip}:1925/1/sources`));

  // Pick whichever system probe gave back api_version
  const systemInfo = probes
    .filter((p) => p.bodyJson?.api_version?.Major)
    .map((p) => p.bodyJson)[0];

  console.log(renderReport(ip, probes, systemInfo));
}

function renderReport(ip, probes, systemInfo) {
  const lines = [];
  lines.push("# Philips Jointspace standalone diagnostic");
  lines.push("");
  lines.push(`- Target IP: ${ip}`);
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Node: ${process.version} on ${process.platform}`);
  lines.push("");

  if (systemInfo) {
    lines.push("## TV identification");
    lines.push("");
    lines.push(`- Name: ${systemInfo.name ?? "-"}`);
    lines.push(`- Model: ${systemInfo.model ?? "(encrypted: " + (systemInfo.model_encrypted ? "yes" : "no") + ")"}`);
    lines.push(`- API version: ${[systemInfo.api_version?.Major, systemInfo.api_version?.Minor, systemInfo.api_version?.Patch].filter(Boolean).join(".")}`);
    lines.push(`- OS type: ${systemInfo.os_type ?? systemInfo.featuring?.systemfeatures?.os_type ?? "-"}`);
    lines.push(`- Pairing type: ${systemInfo.featuring?.systemfeatures?.pairing_type ?? "-"}`);
    lines.push(`- Secured transport: ${systemInfo.featuring?.systemfeatures?.secured_transport ?? "-"}`);
    lines.push(`- notifyChange: ${systemInfo.notifyChange ?? "(not advertised)"}`);
    lines.push("");
  } else {
    lines.push("## TV identification");
    lines.push("");
    lines.push("> Could not retrieve system info from any endpoint. See probe table below.");
    lines.push("");
  }

  lines.push("## Probes");
  lines.push("");
  lines.push("| Result | Endpoint | Status | Time | Body preview |");
  lines.push("|---|---|---|---|---|");
  for (const p of probes) {
    const icon = p.status === "ok" ? "✅" : p.status === "http_error" ? "⚠️" : "❌";
    const statusText = p.statusCode
      ? `HTTP ${p.statusCode}`
      : `${p.errorCode ?? p.errorName ?? "error"}`;
    const preview = (p.bodyPreview ?? p.errorMessage ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\n/g, " ");
    const previewTrunc = preview.length > 80 ? preview.slice(0, 80) + "…" : preview;
    lines.push(`| ${icon} | \`${p.url}\` | ${statusText} | ${p.durationMs} ms | ${previewTrunc} |`);
  }
  lines.push("");

  lines.push("## Raw probe data");
  lines.push("");
  lines.push("<details><summary>Click to expand</summary>");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(probes.map(({ bodyJson, ...rest }) => rest), null, 2));
  lines.push("```");
  lines.push("");
  lines.push("</details>");

  if (systemInfo) {
    lines.push("");
    lines.push("## Full system info JSON");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(systemInfo, null, 2));
    lines.push("```");
  }

  return lines.join("\n");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  exit(2);
});
