import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AnalysableProbe,
  analyseReport,
  uniqueByAddress,
} from "../drivers/philips-jointspace/diagnostic-analysis";
import { renderMarkdown, DiagnosticReport } from "../drivers/philips-jointspace/diagnostic";
import { osSupportsGoogleAssistant } from "../drivers/philips-jointspace/quirks";

const ok = (endpoint: string): AnalysableProbe => ({ label: endpoint, endpoint, status: "ok" });
const http = (endpoint: string, statusCode: number, errorName = "JointspaceError"): AnalysableProbe => ({
  label: endpoint,
  endpoint,
  status: "fail",
  statusCode,
  errorName,
  errorMessage: `HTTP ${statusCode}: `,
});
const refused = (endpoint: string): AnalysableProbe => ({
  label: endpoint,
  endpoint,
  status: "fail",
  statusCode: 503,
  errorName: "OfflineError",
  errorMessage: "TV unreachable (ECONNREFUSED)",
});
const timeout = (endpoint: string): AnalysableProbe => ({
  label: endpoint,
  endpoint,
  status: "fail",
  errorName: "Error",
  errorMessage: "Probe timeout after 15000ms",
});

const ids = (probes: AnalysableProbe[], scope: "ip-only" | "paired-device" = "ip-only") =>
  analyseReport({ scope, probes }).map((f) => f.id);

test("HTTP 500 everywhere and 1926 refused means the API service is not running (#65, #68)", () => {
  assert.deepEqual(ids([
    http("http://<ip>:1925/system", 500),
    refused("https://<ip>:1926/system"),
    http("http://<ip>:1925/1/system", 500),
    http("http://<ip>:1925/5/system", 500),
    refused("https://<ip>:1926/6/system"),
  ]), ["api-service-not-running"]);
});

test("/1/system on HTTP works while 1926 refuses means HTTP-only (#61, #67)", () => {
  assert.deepEqual(ids([
    http("http://<ip>:1925/system", 403, "ForbiddenError"),
    refused("https://<ip>:1926/system"),
    ok("http://<ip>:1925/1/system"),
    http("http://<ip>:1925/5/system", 403, "ForbiddenError"),
    refused("https://<ip>:1926/6/system"),
  ]), ["https-closed-http-works"]);
});

test("both transports answering means the network is healthy (#62, #66)", () => {
  assert.deepEqual(ids([
    ok("http://<ip>:1925/system"),
    ok("https://<ip>:1926/system"),
    http("http://<ip>:1925/1/system", 404, "NotFoundError"),
    ok("https://<ip>:1926/6/system"),
  ]), ["network-healthy"]);
});

test("nothing answering means unreachable", () => {
  assert.deepEqual(ids([refused("http://<ip>:1925/system"), refused("https://<ip>:1926/system")]), ["unreachable"]);
});

test("paired report with every request timing out says the TV is off (#64)", () => {
  assert.deepEqual(ids([
    timeout("/system (HTTP/1925 → HTTPS/1926 fallback)"),
    timeout("powerstate"),
    timeout("sources"),
    ok("notifychange"),
  ], "paired-device"), ["tv-not-responding"]);
});

test("paired report flags 403 on sources and applications (#69)", () => {
  assert.deepEqual(ids([
    ok("/system (HTTP/1925 → HTTPS/1926 fallback)"),
    ok("powerstate"),
    http("applications", 403, "ForbiddenError"),
    http("sources", 403, "ForbiddenError"),
    ok("notifychange"),
  ], "paired-device"), ["sources-forbidden", "applications-forbidden"]);
});

test("healthy paired report has no findings", () => {
  assert.deepEqual(ids([ok("powerstate"), ok("sources"), ok("applications")], "paired-device"), []);
});

test("renderMarkdown puts the analysis section in the report", () => {
  const report: DiagnosticReport = {
    generatedAt: "2026-11-13T00:00:00.000Z",
    appVersion: "test",
    scope: "ip-only",
    scopeTarget: "192.0.2.1",
    probes: [
      { ...http("http://<ip>:1925/system", 500), method: "GET" },
      { ...refused("https://<ip>:1926/system"), method: "GET" },
    ],
    discovery: {
      ssdpResults: 0,
      mdnsResults: 511,
      mdnsUniqueAddresses: 2,
      ssdpSample: [],
      mdnsSample: [],
    },
  };
  const md = renderMarkdown(report);
  assert.match(md, /## Analysis/);
  assert.match(md, /control API is not running/);
  assert.match(md, /511 result\(s\) \(2 unique address\(es\)\)/);
});

test("uniqueByAddress keeps the first result per IP", () => {
  const results = [
    { id: "6_65OLED909/12", address: "192.0.2.10" },
    { id: "6_65OLED909/12 (3)", address: "192.0.2.10" },
    { id: "6_Bedroom", address: "192.0.2.20" },
  ];
  assert.deepEqual(uniqueByAddress(results).map((r) => r.id), ["6_65OLED909/12", "6_Bedroom"]);
});

test("Google Assistant fallback is skipped only on Saphi/Linux (#69)", () => {
  assert.equal(osSupportsGoogleAssistant("Linux"), false);
  assert.equal(osSupportsGoogleAssistant("MSAF_2019_P"), true);
  assert.equal(osSupportsGoogleAssistant(null), true);
});
