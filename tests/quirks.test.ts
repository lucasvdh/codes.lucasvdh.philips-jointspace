import { test } from "node:test";
import assert from "node:assert/strict";

import { extractPairingType, extractTransportConfig } from "../drivers/philips-jointspace/quirks";
import type { SystemInfo } from "../drivers/philips-jointspace/types";

function system(major: number, secured?: boolean, pairingType?: string): SystemInfo {
  const systemfeatures: Record<string, unknown> = {};
  if (secured !== undefined) systemfeatures.secured_transport = secured ? "true" : "false";
  if (pairingType) systemfeatures.pairing_type = pairingType;
  return {
    api_version: { Major: major, Minor: 0, Patch: 0 },
    featuring: { systemfeatures },
  } as SystemInfo;
}

test("API 5 with secured transport uses HTTPS on 1926 (issue #63)", () => {
  assert.deepEqual(extractTransportConfig(system(5, true)), { apiVersion: 5, secured: true, port: 1926 });
});

test("API 6 with secured transport uses HTTPS on 1926", () => {
  assert.deepEqual(extractTransportConfig(system(6, true)), { apiVersion: 6, secured: true, port: 1926 });
});

test("API 6 without secured transport uses HTTP on 1925", () => {
  assert.deepEqual(extractTransportConfig(system(6, false)), { apiVersion: 6, secured: false, port: 1925 });
});

test("legacy API 1 without features uses HTTP on 1925", () => {
  assert.deepEqual(extractTransportConfig({ api_version: { Major: 1 } } as SystemInfo), {
    apiVersion: 1,
    secured: false,
    port: 1925,
  });
});

test("secured_transport accepts both boolean and string true", () => {
  const asBool = { api_version: { Major: 6 }, featuring: { systemfeatures: { secured_transport: true } } } as SystemInfo;
  assert.equal(extractTransportConfig(asBool).secured, true);
});

test("extractPairingType reads digest_auth_pairing and ignores empty values", () => {
  assert.equal(extractPairingType(system(6, true, "digest_auth_pairing")), "digest_auth_pairing");
  assert.equal(extractPairingType(system(6, true, "")), null);
  assert.equal(extractPairingType(system(6, true)), null);
});
