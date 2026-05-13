#!/usr/bin/env node
/**
 * Low-level TLS handshake probe for Philips TVs.
 *
 * fetch() in Node 22 uses undici under the hood, with its own TLS connector
 * that doesn't always honour Agent.connect options the way Node's native
 * https.Agent does. axios (which our app uses) goes through Node's https
 * module directly. So a TLS failure in scripts/diagnose-auth.mjs doesn't
 * necessarily imply a failure in the app.
 *
 * This script bypasses fetch / undici and uses node:tls + node:https
 * directly, the same way axios and needle do. If it succeeds, the app's
 * TLS path is sound and only the auth-aware fetch script is broken. If it
 * fails, the TV's TLS is genuinely unreachable from Node regardless of
 * client.
 *
 * Usage:
 *   node scripts/diagnose-tls.mjs <tv-ip>
 *
 * Output: a small report showing what the TLS handshake actually negotiates
 * (protocol, cipher) and the raw response of a GET /system attempt.
 */

import { argv, exit } from "node:process";
import { connect as tlsConnect } from "node:tls";
import { request as httpsRequest } from "node:https";

const HTTPS_PORT = 1926;
const HANDSHAKE_TIMEOUT_MS = 8000;
const REQUEST_TIMEOUT_MS = 8000;

function probeHandshake(host, port) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = tlsConnect({
      host,
      port,
      rejectUnauthorized: false,
      minVersion: "TLSv1",
      ciphers: "DEFAULT@SECLEVEL=0",
    });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, durationMs: Date.now() - started, error: `timeout after ${HANDSHAKE_TIMEOUT_MS}ms` });
    }, HANDSHAKE_TIMEOUT_MS);
    socket.on("secureConnect", () => {
      clearTimeout(timer);
      const protocol = socket.getProtocol();
      const cipher = socket.getCipher();
      const cert = socket.getPeerCertificate(true);
      socket.end();
      resolve({
        ok: true,
        durationMs: Date.now() - started,
        protocol,
        cipher,
        cert: cert ? {
          subject: cert.subject,
          issuer: cert.issuer,
          valid_from: cert.valid_from,
          valid_to: cert.valid_to,
          fingerprint: cert.fingerprint,
          sigalg: cert.sigalg,
        } : null,
      });
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        durationMs: Date.now() - started,
        error: err.message,
        errorCode: err.code,
        errorLibrary: err.library,
        errorReason: err.reason,
      });
    });
  });
}

function probeHttpsRequest(host, port, path) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = httpsRequest({
      host,
      port,
      path,
      method: "GET",
      rejectUnauthorized: false,
      minVersion: "TLSv1",
      ciphers: "DEFAULT@SECLEVEL=0",
      timeout: REQUEST_TIMEOUT_MS,
      headers: { Accept: "application/json" },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: true,
          durationMs: Date.now() - started,
          statusCode: res.statusCode,
          contentType: res.headers["content-type"],
          bodyPreview: body.slice(0, 400),
          bodyLength: body.length,
        });
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.on("error", (err) => {
      resolve({
        ok: false,
        durationMs: Date.now() - started,
        error: err.message,
        errorCode: err.code,
      });
    });
    req.end();
  });
}

async function main() {
  const ip = argv[2];
  if (!ip) {
    console.error("Usage: node scripts/diagnose-tls.mjs <tv-ip>");
    exit(1);
  }

  console.log(`# TLS handshake probe for ${ip}:${HTTPS_PORT}`);
  console.log("");
  console.log(`- Node: ${process.version} on ${process.platform}`);
  console.log(`- OpenSSL: ${process.versions.openssl}`);
  console.log(`- Generated: ${new Date().toISOString()}`);
  console.log("");

  console.log("## Pure TLS handshake (no HTTP)");
  console.log("");
  const tls = await probeHandshake(ip, HTTPS_PORT);
  console.log("```json");
  console.log(JSON.stringify(tls, null, 2));
  console.log("```");
  console.log("");

  console.log("## https.request GET /system");
  console.log("");
  const req = await probeHttpsRequest(ip, HTTPS_PORT, "/system");
  console.log("```json");
  console.log(JSON.stringify(req, null, 2));
  console.log("```");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  exit(2);
});
