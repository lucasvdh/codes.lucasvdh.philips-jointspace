import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyPinError,
  describePairingError,
  resolveTransport,
  singleFlight,
} from "../drivers/philips-jointspace/pairing-logic";
import { HttpsUnavailableError, OfflineError, PairingError } from "../drivers/philips-jointspace/errors";

const SECURED = { apiVersion: 6, secured: true, port: 1926 };
const PLAIN = { apiVersion: 6, secured: false, port: 1925 };

// --- resolveTransport ----------------------------------------------------

test("unsecured transport is used as-is", () => {
  assert.deepEqual(resolveTransport(PLAIN, false, null), { transport: PLAIN, httpsUnavailable: false });
});

test("secured transport is kept when HTTPS responds", () => {
  assert.deepEqual(resolveTransport(SECURED, true, "MSAF_2019_P"), { transport: SECURED, httpsUnavailable: false });
});

test("Saphi/Linux TV with dead HTTPS falls back to HTTP/1925 and flags it (issues #61, #67)", () => {
  assert.deepEqual(resolveTransport(SECURED, false, "Linux"), {
    transport: { apiVersion: 6, secured: false, port: 1925 },
    httpsUnavailable: true,
  });
});

test("unknown OS with dead HTTPS also falls back", () => {
  assert.equal(resolveTransport(SECURED, false, null).httpsUnavailable, true);
});

test("MSAF TV with dead HTTPS throws HttpsUnavailableError", () => {
  assert.throws(() => resolveTransport(SECURED, false, "MSAF_2019_P"), HttpsUnavailableError);
});

// --- classifyPinError ----------------------------------------------------

test("INVALID_PIN keeps the PIN screen open", () => {
  assert.deepEqual(classifyPinError(new PairingError("x", "INVALID_PIN")), { kind: "retry_pin" });
});

test("TIMEOUT restarts pairing with an explanation (issue #66)", () => {
  assert.deepEqual(classifyPinError(new PairingError("x", "TIMEOUT")), {
    kind: "restart_pair",
    messageKey: "error.pairing_timeout",
  });
});

test("unknown pairing error ids are surfaced with their text instead of a generic error", () => {
  const action = classifyPinError(new PairingError("x", "FAILURE", "Device not allowed"));
  assert.deepEqual(action, {
    kind: "abort",
    messageKey: "error.pairing_rejected",
    tokens: { reason: "FAILURE: Device not allowed" },
  });
});

test("non-pairing errors abort with the generic message", () => {
  assert.deepEqual(classifyPinError(new OfflineError()), { kind: "abort", messageKey: "error.generic" });
  assert.deepEqual(classifyPinError("boom"), { kind: "abort", messageKey: "error.generic" });
});

test("describePairingError falls back to 'unknown' when the TV sends nothing", () => {
  assert.equal(describePairingError(new PairingError("x")), "unknown");
  assert.equal(describePairingError(new PairingError("x", "TIMEOUT", "  ")), "TIMEOUT");
});

// --- singleFlight --------------------------------------------------------

test("singleFlight shares one in-flight run between concurrent callers", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const run = singleFlight(async () => {
    calls += 1;
    await gate;
    return calls;
  });

  const a = run();
  const b = run();
  release();
  assert.deepEqual(await Promise.all([a, b]), [1, 1]);
  assert.equal(calls, 1);
});

test("singleFlight runs again after the previous run settled, also after a rejection", async () => {
  let calls = 0;
  const run = singleFlight(async () => {
    calls += 1;
    if (calls === 1) throw new Error("first fails");
    return calls;
  });

  await assert.rejects(run(), /first fails/);
  assert.equal(await run(), 2);
});
