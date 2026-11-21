import { test } from "node:test";
import assert from "node:assert/strict";

import { featureCapabilities } from "../drivers/philips-jointspace/quirks";
import type { SystemInfo } from "../drivers/philips-jointspace/types";

function system(jsonfeatures?: Record<string, string[]>): SystemInfo {
  return { api_version: { Major: 6, Minor: 1, Patch: 0 }, featuring: jsonfeatures ? { jsonfeatures } : undefined } as SystemInfo;
}

test("an Android TV with Hue and recordings keeps every optional capability", () => {
  // 49PUS6412/12, MSAF_2018_O
  const tv = system({
    editfavorites: ["TVChannels", "SatChannels"],
    recordings: ["List", "Schedule", "Manage"],
    ambilight: ["LoungeLight", "Hue", "Ambilight"],
    menuitems: ["Setup_Menu"],
    applications: ["TV_Apps", "TV_Games", "TV_Settings"],
    inputkey: ["key"],
  });
  assert.deepEqual(featureCapabilities(tv), {
    ambilight_onoff: true,
    ambilight_mode: true,
    key_toggle_ambilight: true,
    ambihue_onoff: true,
    key_record: true,
    current_application: true,
  });
});

test("a Linux TV without Hue, recordings or apps drops those capabilities", () => {
  // 48OLED911/12, Linux (#77): HueLamp/power 404s and applications 403s.
  const tv = system({
    editfavorites: ["TVChannels", "SatChannels"],
    ambilight: ["Ambilight"],
    inputkey: ["key", "unicode"],
    activities: ["browser"],
  });
  assert.deepEqual(featureCapabilities(tv), {
    ambilight_onoff: true,
    ambilight_mode: true,
    key_toggle_ambilight: true,
    ambihue_onoff: false,
    key_record: false,
    current_application: false,
  });
});

test("a TV without Ambilight drops the Ambilight capabilities", () => {
  const caps = featureCapabilities(system({ inputkey: ["key"], applications: ["TV_Apps"] }));
  assert.equal(caps.ambilight_onoff, false);
  assert.equal(caps.ambilight_mode, false);
  assert.equal(caps.key_toggle_ambilight, false);
  assert.equal(caps.ambihue_onoff, false);
});

test("a TV that doesn't report jsonfeatures keeps everything", () => {
  assert.ok(Object.values(featureCapabilities(system())).every((v) => v === null));
});
