import { test } from "node:test";
import assert from "node:assert/strict";

import { ambilightModeFromConfigPoll, featureCapabilityChanges, snapSliderValue } from "../drivers/philips-jointspace/capabilities";

test("adds and removes optional capabilities, leaving unknown ones alone", () => {
  const present = new Set(["ambihue_onoff", "key_record", "ambilight_mode"]);
  const changes = featureCapabilityChanges(
    { ambihue_onoff: false, key_record: false, current_application: true, ambilight_mode: true, key_toggle_ambilight: null },
    (id) => present.has(id),
  );
  assert.deepEqual(changes, { add: ["current_application"], remove: ["ambihue_onoff", "key_record"] });
});

test("nothing changes when the capabilities already match", () => {
  assert.deepEqual(featureCapabilityChanges({ ambihue_onoff: true, key_record: false }, (id) => id === "ambihue_onoff"), {
    add: [],
    remove: [],
  });
});

test("slider values are rounded to the step and clamped to the range", () => {
  const brightness = { nodeId: 1, min: 0, max: 10, step: 1 };
  const saturation = { nodeId: 2, min: -2, max: 2, step: 1 };
  assert.equal(snapSliderValue(brightness, 6.4), 6);
  assert.equal(snapSliderValue(brightness, 12), 10);
  assert.equal(snapSliderValue(brightness, -3), 0);
  assert.equal(snapSliderValue(saturation, -1.6), -2);
  assert.equal(snapSliderValue({ nodeId: 3, min: 0, max: 100, step: 5 }, 42), 40);
});

test("with the menu, the config poll never sets the Ambilight mode (#96)", () => {
  // A stale cached mode used to flip the capability: off -> video_natural -> video_standard.
  assert.deepEqual(
    ambilightModeFromConfigPoll({ menuHasAmbilight: true, reported: "video_standard", cached: "video_natural", osHasQuirk: true }),
    { mode: undefined, clearCache: false },
  );
});

test("without the menu, the quirk cache wins until the TV reports the same mode", () => {
  const base = { menuHasAmbilight: false, osHasQuirk: true, cached: "video_vivid" };
  assert.deepEqual(ambilightModeFromConfigPoll({ ...base, reported: "video_standard" }), { mode: "video_vivid", clearCache: false });
  assert.deepEqual(ambilightModeFromConfigPoll({ ...base, reported: "video_vivid" }), { mode: "video_vivid", clearCache: true });
});

test("without the quirk or a cached mode, the reported mode is used", () => {
  assert.deepEqual(
    ambilightModeFromConfigPoll({ menuHasAmbilight: false, osHasQuirk: false, cached: "video_vivid", reported: "video_game" }),
    { mode: "video_game", clearCache: false },
  );
  assert.deepEqual(
    ambilightModeFromConfigPoll({ menuHasAmbilight: false, osHasQuirk: true, cached: null, reported: "video_game" }),
    { mode: "video_game", clearCache: false },
  );
});
