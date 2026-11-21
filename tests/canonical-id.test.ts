import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canonicalIdAliases,
  decryptSystemField,
  extractCanonicalId,
  isUnstableCanonicalId,
} from "../drivers/philips-jointspace/quirks";
import type { SystemInfo } from "../drivers/philips-jointspace/types";

// 49PUS6412/12 (Android, MSAF_2018_O): a fresh IV per response.
const RANDOM_IV_SERIALS = [
  "NVYBOEc+lUZTKf2+NWdt1jZm/7nUeQxkZSbZ5FWlBZw=\n",
  "sKN9K62v04VjeVJ3Pg1Tuk6s9eOOOCwEZy+xEm60dhM=\n",
  "EMRCpktBpDcudCkumUxqyA+XR8mwo0mxxbo58wek6Fw=\n",
  "6UELrJ9LgWMVn1bwmzDOlINnASokdSAZoyYk6BDxwaQ=\n",
];
const RANDOM_IV_DEVICE_IDS = [
  "TlLHmNLBkiikCbU9ldnDXef/tYvpu7wF9iMxSH9KoTI=\n",
  "tPq2+0GA1cEW34AeUxud1ynwyuSFgDqKkk7XN+k4PRM=\n",
];
// 48OLED911/12 (Linux, #77): the same IV every time.
const FIXED_IV_SERIAL = "K2kseVsmQFgkd15gKkJ+akLtw1FQbe2Rdy8L7/pW6T327IivxGJcdtCPiy8FgTkx";
const FIXED_IV_MODEL = "K2kseVsmQFgkd15gKkJ+akmMHkdA8iYSCMaTZqCBadA=";

function system(fields: Partial<SystemInfo>): SystemInfo {
  return { api_version: { Major: 6, Minor: 1, Patch: 0 }, ...fields } as SystemInfo;
}

test("decrypts *_encrypted fields regardless of the IV", () => {
  for (const value of RANDOM_IV_SERIALS) assert.equal(decryptSystemField(value), "FZ5A1823065423");
  for (const value of RANDOM_IV_DEVICE_IDS) assert.equal(decryptSystemField(value), "1001650152");
  assert.equal(decryptSystemField(FIXED_IV_SERIAL), "FZ1T2631035890-bcc2d9350049");
  assert.equal(decryptSystemField(FIXED_IV_MODEL), "48OLED911/12");
});

test("returns null for values that aren't valid ciphertext", () => {
  assert.equal(decryptSystemField(undefined), null);
  assert.equal(decryptSystemField(""), null);
  assert.equal(decryptSystemField("not base64 at all"), null);
  assert.equal(decryptSystemField(Buffer.alloc(32, 7).toString("base64")), null);
});

test("canonical id is the same for every response of a random-IV TV", () => {
  const ids = RANDOM_IV_SERIALS.map((s) => extractCanonicalId(system({ serialnumber_encrypted: s }), { ip: "192.168.1.129" }));
  assert.deepEqual(new Set(ids), new Set(["serial-FZ5A1823065423"]));
});

test("falls back to the decrypted device id, then the USN", () => {
  assert.equal(
    extractCanonicalId(system({ deviceid_encrypted: RANDOM_IV_DEVICE_IDS[0] }), { ip: "10.0.0.1" }),
    "deviceid-1001650152",
  );
  assert.equal(
    extractCanonicalId(system({ serialnumber_encrypted: "garbage" }), {
      usn: "uuid:F00DBABE-AA5E-BABA-DADA-2CD9745F1469::urn:schemas-upnp-org:device:MediaRenderer:3",
      ip: "10.0.0.1",
    }),
    "uuid-F00DBABE-AA5E-BABA-DADA-2CD9745F1469",
  );
});

test("legacy ciphertext and USN ids resolve to the new canonical ids", () => {
  assert.ok(canonicalIdAliases(`enc-serial-${FIXED_IV_SERIAL}`).includes("serial-FZ1T2631035890-bcc2d9350049"));
  assert.ok(canonicalIdAliases(`enc-serial-${RANDOM_IV_SERIALS[0].trim()}`).includes("serial-FZ5A1823065423"));
  assert.ok(canonicalIdAliases(`enc-device-${RANDOM_IV_DEVICE_IDS[1].trim()}`).includes("deviceid-1001650152"));
  assert.ok(
    canonicalIdAliases("uuid:F00DBABE-AA5E-BABA-DADA-2CD9745F1469::urn:schemas-upnp-org:device:MediaRenderer:3")
      .includes("uuid-F00DBABE-AA5E-BABA-DADA-2CD9745F1469"),
  );
});

test("only ciphertext canonical ids are recomputed", () => {
  assert.equal(isUnstableCanonicalId(`enc-serial-${FIXED_IV_SERIAL}`), true);
  assert.equal(isUnstableCanonicalId("enc-device-abc"), true);
  assert.equal(isUnstableCanonicalId("serial-FZ5A1823065423"), false);
  assert.equal(isUnstableCanonicalId("uuid-F00DBABE-AA5E-BABA-DADA-2CD9745F1469"), false);
});
