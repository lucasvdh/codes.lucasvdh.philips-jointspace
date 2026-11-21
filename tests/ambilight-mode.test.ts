import { test } from "node:test";
import assert from "node:assert/strict";

import { ambilightModeFromConfiguration } from "../drivers/philips-jointspace/enums";

// As read back from a 49PUS6412 after selecting each option in the TV menu.
test("Ambilight configuration matches on style and setting, not the display string", () => {
  assert.equal(ambilightModeFromConfiguration({ styleName: "FOLLOW_AUDIO", isExpert: false, menuSetting: "MODE_RANDOM", stringValue: "Party" }), "audio_random");
  assert.equal(ambilightModeFromConfiguration({ styleName: "FOLLOW_AUDIO", isExpert: false, menuSetting: "SPECTRUM_ANALYSER", stringValue: "Spectrum" }), "audio_spectrum");
  assert.equal(ambilightModeFromConfiguration({ styleName: "FOLLOW_VIDEO", isExpert: false, menuSetting: "IMMERSIVE", stringValue: "Immersive" }), "video_immersive");
  assert.equal(ambilightModeFromConfiguration({ styleName: "FOLLOW_COLOR", isExpert: false, menuSetting: "ISF", stringValue: "WarmWhite" }), "color_warm_white");
  assert.equal(ambilightModeFromConfiguration({ styleName: "FOLLOW_VIDEO", isExpert: false, menuSetting: "NATURAL", stringValue: "Natural" }), "video_natural");
});

test("an unknown Ambilight setting maps to no mode", () => {
  assert.equal(ambilightModeFromConfiguration({ styleName: "FOLLOW_VIDEO", isExpert: false, menuSetting: "SOMETHING_NEW" }), undefined);
  assert.equal(ambilightModeFromConfiguration({ styleName: "OFF", isExpert: false }), undefined);
});
