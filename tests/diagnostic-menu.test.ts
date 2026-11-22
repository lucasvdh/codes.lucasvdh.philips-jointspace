import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DiagnosticReport, ProbeResult, renderMarkdown } from "../drivers/philips-jointspace/diagnostic";
import { analyseReport } from "../drivers/philips-jointspace/diagnostic-analysis";

const structure = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/menu-49pus6412.json"), "utf8"));

function report(probes: ProbeResult[]): DiagnosticReport {
  return {
    generatedAt: "2026-11-22T00:00:00.000Z",
    appVersion: "3.9.0",
    scope: "paired-device",
    scopeTarget: "Philips TV",
    probes: [
      { label: "Power state", method: "GET", endpoint: "powerstate", status: "ok", durationMs: 10, responseSummary: "{}" },
      ...probes,
    ],
  };
}

const structureProbe: ProbeResult = {
  kind: "menu-structure",
  label: "Settings menu structure",
  method: "GET",
  endpoint: "menuitems/settings/structure",
  status: "ok",
  durationMs: 300,
  responseRaw: structure,
};

test("the report lists the menu options, current values and the menu tree", () => {
  const current: ProbeResult = {
    kind: "menu-current",
    label: "Settings menu values",
    method: "POST",
    endpoint: "menuitems/settings/current",
    status: "ok",
    durationMs: 80,
    responseRaw: {
      values: [
        { value: { Nodeid: 2131230838, data: { selected_item: 5 } } },
        { value: { Nodeid: 2131230762, data: { activenode_id: 2131230764 } } },
        { value: { Nodeid: 2131230764, data: { selected_item: 2 } } },
        { value: { Nodeid: 2131230769, data: { value: 8 } } },
      ],
    },
  };
  const md = renderMarkdown(report([structureProbe, current]));

  assert.match(md, /## Settings menu/);
  assert.match(md, /\*\*Picture style\*\* \(node 2131230838\): `personal`=1, `vivid`=2/);
  assert.match(md, /Current: `movie`/);
  assert.match(md, /\*\*Ambilight style\*\* \(node 2131230762\): `off`, `video_standard`/);
  assert.match(md, /Current: `video_natural`/);
  assert.match(md, /\*\*ambilight_brightness\*\* \(node 2131230769\): 0 to 10, step 1, current 8/);
  assert.match(md, /2131230838 LIST_NODE picture_style \[1=MAIN_PERSONAL, 2=MAIN_VIVID/);
});

test("a TV without the menu gets a finding and a short section", () => {
  const missing: ProbeResult = {
    ...structureProbe,
    status: "fail",
    statusCode: 404,
    errorName: "NotFoundError",
    errorMessage: "Endpoint not found",
    responseRaw: undefined,
  };
  const r = report([missing]);
  const md = renderMarkdown(r);

  assert.match(md, /The TV did not return its settings menu \(404 Endpoint not found\)/);
  assert.doesNotMatch(md, /Full menu tree/);
  assert.ok(analyseReport(r).some((f) => f.id === "menu-unavailable"));
});

test("reports without menu probes have no settings menu section", () => {
  assert.doesNotMatch(renderMarkdown(report([])), /## Settings menu/);
});
