import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  availableOptions,
  currentAmbilightMode,
  currentPictureStyle,
  currentSliderValue,
  extractMenuCapabilities,
  humanizeMenuKey,
  MenuCurrentResponse,
  menuNodesToRead,
  MenuStructure,
} from "../drivers/philips-jointspace/menu";

// Picture style node and Ambilight style subtree from a 49PUS6412 (Android, 2018).
const structure = JSON.parse(
  readFileSync(join(process.cwd(), "tests/fixtures/menu-49pus6412.json"), "utf8"),
) as MenuStructure;

function current(entries: Array<[number, { selected_item?: number; activenode_id?: number }]>): MenuCurrentResponse {
  return { values: entries.map(([Nodeid, data]) => ({ value: { Nodeid, data } })) };
}

test("picture style options come from the TV, in its order", () => {
  const { pictureStyle } = extractMenuCapabilities(structure);
  assert.ok(pictureStyle);
  assert.equal(pictureStyle.nodeId, 2131230838);
  assert.deepEqual(
    pictureStyle.options.map((o) => `${o.id}=${o.enumId}`),
    [
      "personal=1", "vivid=2", "natural=3", "standard=4", "movie=5", "game=6", "monitor=14",
      "hdr_personal=13", "hdr_vivid=9", "hdr_natural=10", "hdr_movie=11", "hdr_game=12", "isf_day=7", "isf_night=8",
    ],
  );
});

test("Ambilight menu options map onto the existing ambilight_mode ids", () => {
  const { ambilight } = extractMenuCapabilities(structure);
  assert.ok(ambilight);
  assert.equal(ambilight.styleNodeId, 2131230762);
  assert.equal(ambilight.offNodeId, 2131230763);
  assert.deepEqual(ambilight.options.map((o) => o.id), [
    "off",
    "video_standard", "video_natural", "video_immersive", "video_vivid", "video_game", "video_comfort", "video_relax",
    "audio_adapt_brightness", "audio_adapt_colors", "audio_vu_meter", "audio_spectrum", "audio_knight_rider_2", "audio_flash", "audio_random",
    "color_hot_lava", "color_deep_water", "color_fresh_nature", "color_warm_white", "color_cool_white",
  ]);
  // Vivid is listed twice (enum 4 and an unavailable 8); the first wins.
  assert.equal(ambilight.options.find((o) => o.id === "video_vivid")?.enumId, 4);
});

test("unknown menu options get a readable id and title", () => {
  const extended = structuredClone(structure);
  const style = extended.node.data!.nodes![1].data!.nodes![0];
  const video = style.data!.nodes!.find((n) => n.context === "ambilight_follow_video")!;
  video.data!.enums!.push({ enum_id: 9, string_id: "org.droidtv.ui.strings.R.string.MAIN_AMBILIGHT_AI" });
  const option = extractMenuCapabilities(extended).ambilight!.options.find((o) => o.enumId === 9);
  assert.deepEqual(option && { id: option.id, title: option.fallbackTitle }, { id: "video_ai", title: "AI" });
  assert.equal(humanizeMenuKey("MAIN_HDR_VIVID"), "HDR Vivid");
});

test("reads the current picture style and Ambilight style", () => {
  const capabilities = extractMenuCapabilities(structure);
  const values = current([
    [2131230838, { selected_item: 5 }],
    [2131230762, { activenode_id: 2131230766 }],
    [2131230766, { selected_item: 207 }],
  ]);
  assert.equal(currentPictureStyle(capabilities.pictureStyle!, values), "movie");
  assert.equal(currentAmbilightMode(capabilities.ambilight!, values), "color_warm_white");
  assert.equal(currentAmbilightMode(capabilities.ambilight!, current([[2131230762, { activenode_id: 2131230763 }]])), "off");
  assert.deepEqual(menuNodesToRead(capabilities), [2131230838, 2131230762, 2131230764, 2131230765, 2131230766, 2131230769, 2131230771]);
});

test("a TV without the menu has no dynamic capabilities", () => {
  assert.deepEqual(extractMenuCapabilities(null), { pictureStyle: null, ambilight: null, sliders: {} });
  assert.deepEqual(extractMenuCapabilities({ node: { node_id: 1, type: "PARENT_NODE", data: { nodes: [] } } }), {
    pictureStyle: null,
    ambilight: null,
    sliders: {},
  });
});

test("hides the options the TV marks unavailable", () => {
  const { pictureStyle, ambilight } = extractMenuCapabilities(structure);
  const sdr: MenuCurrentResponse = {
    values: [{
      value: {
        Nodeid: 2131230838,
        data: {
          selected_item: 2,
          enum_values: [9, 10, 11, 12, 13].map((enum_id) => ({ enum_id, string_id: "", available: false })),
        },
      },
    }],
  };
  assert.deepEqual(
    availableOptions(pictureStyle!.options, sdr).map((o) => o.id),
    ["personal", "vivid", "natural", "standard", "movie", "game", "monitor", "isf_day", "isf_night"],
  );
  // No availability reported for a node: keep every option.
  assert.equal(availableOptions(ambilight!.options, sdr).length, ambilight!.options.length);
});

test("Ambilight brightness and saturation come with the range the TV reports", () => {
  const { sliders } = extractMenuCapabilities(structure);
  assert.deepEqual(sliders, {
    ambilight_brightness: { nodeId: 2131230769, min: 0, max: 10, step: 1 },
    ambilight_saturation: { nodeId: 2131230771, min: -2, max: 2, step: 1 },
  });
  const values: MenuCurrentResponse = {
    values: [
      { value: { Nodeid: 2131230769, data: { value: 8 } } },
      { value: { Nodeid: 2131230771, data: { value: -1 } } },
    ],
  };
  assert.equal(currentSliderValue(sliders!.ambilight_brightness, values), 8);
  assert.equal(currentSliderValue(sliders!.ambilight_saturation, values), -1);
  assert.ok(menuNodesToRead(extractMenuCapabilities(structure)).includes(2131230771));
});

test("2026 Linux TV Ambilight styles get the titles the TV shows (#83)", () => {
  const list = (node_id: number, context: string, keys: Array<[number, string]>) => ({
    node_id, type: "LIST_NODE", context, data: { enums: keys.map(([enum_id, string_id]) => ({ enum_id, string_id })) },
  });
  const oled911: MenuStructure = {
    node: { node_id: 1, type: "PARENT_NODE", context: "Setup_Menu", data: { nodes: [{
      node_id: 200, type: "PARENT_NODE", context: "ambilight_style", data: { nodes: [
        { node_id: 210, type: "PARENT_NODE", context: "ambilight_off", data: {} },
        list(220, "ambilight_follow_video", [
          [221, "MISC_AI"], [222, "MAIN_AMBILIGHT_STYLE_VIDEO_1_2K20"], [223, "MAIN_AMBILIGHT_STYLE_VIDEO_3_2K20"],
          [224, "MAIN_AMBILIGHT_CINEMA"], [225, "MAIN_AMBILIGHT_GAME_2K23"],
        ]),
        list(240, "ambilight_lounge_light", [[241, "MAIN_AMBILIGHT_FIXED_COLOUR"]]),
      ] },
    }] } },
  };
  const options = extractMenuCapabilities(oled911).ambilight!.options;
  assert.deepEqual(options.map((o) => `${o.id}=${o.fallbackTitle}`), [
    "off=Off",
    "video_misc_ai=AI",
    "video_standard=Style Video 1",
    "video_style_video_3_2k20=Sport",
    "video_cinema=Cinema",
    "video_game_2k23=Game",
    "lounge_light_fixed_colour=Fixed Colour",
  ]);
});
