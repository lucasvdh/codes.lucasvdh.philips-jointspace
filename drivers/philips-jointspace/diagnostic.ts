import type Homey from "homey";
import * as net from "net";
import { JointspaceApi } from "./jointspace-api";
import { analyseReport } from "./diagnostic-analysis";
import { ActivityEntry, activityLog, deviceScope, PAIRING_SCOPE } from "./activity-log";
import { PAIR_DEVICE_INFO, probeTransport } from "./pairing-logic";
import { extractOsType, extractPairingType, extractSecuredTransport } from "./quirks";
import { PairingStatus } from "./enums";
import {
  currentAmbilightMode,
  currentPictureStyle,
  currentSliderValue,
  describeMenuTree,
  extractMenuCapabilities,
  MenuCurrentResponse,
  menuNodesToRead,
  MenuStructure,
} from "./menu";
import { PairingError } from "./errors";
import { Protocol, SystemInfo } from "./types";

// Store keys whose value must never appear in a diagnostic report.
const SECRET_STORE_KEYS = new Set<string>(["credentials"]);

export type ProbeKind = "system" | "pair" | "state" | "menu-structure" | "menu-current";

export interface ProbeResult {
  kind?: ProbeKind;
  label: string;
  method: "GET" | "POST";
  endpoint: string;
  status: "ok" | "fail" | "skipped";
  durationMs?: number;
  statusCode?: number;
  errorName?: string;
  errorMessage?: string;
  responseSummary?: string;
  responseRaw?: unknown;
}

export interface DeviceSnapshot {
  id: string;
  name: string;
  hasCredentials: boolean;
  mac: string | null;
  settings: Record<string, unknown>;
  store: Record<string, unknown>;
  capabilities: Array<{ id: string; value: unknown }>;
}

export interface DiscoverySnapshot {
  ssdpResults: number;
  mdnsResults: number;
  ssdpSample: Array<{ id: string; address: string }>;
  mdnsSample: Array<{ id: string; address: string; name?: string }>;
  mdnsUniqueAddresses?: number;
}

export interface NetworkSnapshot {
  ip: string;
  arpMac?: string;
  arpError?: string;
}

export interface PortCheck {
  port: number;
  label: string;
  result: "open" | "refused" | "timeout" | "error";
  durationMs: number;
  detail?: string;
}

export interface PairingTarget {
  protocol: Protocol;
  port: number;
  versionPrefix: number | null;
}

export interface PairingPlanSnapshot {
  systemTransport: string | null;
  advertised?: { apiVersion: number; secured: boolean; port: number };
  pairingType?: string;
  osType?: string | null;
  httpsResponds?: boolean | null;
  chosen: PairingTarget | null;
  httpsUnavailable?: boolean;
  error?: string;
  log: string[];
}

export interface ActivitySection {
  title: string;
  entries: ActivityEntry[];
}

export interface DiagnosticReport {
  generatedAt: string;
  appVersion: string;
  homeyFirmwareVersion?: string;
  homeyPlatform?: string;
  scope: "paired-device" | "ip-only";
  scopeTarget: string;
  device?: DeviceSnapshot;
  network?: NetworkSnapshot;
  discovery?: DiscoverySnapshot;
  system?: SystemInfo;
  ports?: PortCheck[];
  pairingPlan?: PairingPlanSnapshot;
  probes: ProbeResult[];
  activity?: ActivitySection[];
}

interface ProbeRunner {
  (): Promise<{ result: unknown }>;
}

const RESPONSE_PREVIEW_LENGTH = 600;
// The report no longer runs inside a settings-API request - it's kicked off
// in the background and progress streams back over realtime events. That
// lifts the old 10s ceiling, so individual probes can take as long as a
// genuinely slow Philips TV needs. notifyChange is a long-poll: a 30s
// timeout gives the TV a real chance to stream at least one state change
// while still bounding the worst case.
const PER_PROBE_TIMEOUT_MS = 15_000;
const NOTIFY_PROBE_TIMEOUT_MS = 30_000;
const PORT_CHECK_TIMEOUT_MS = 3_000;
const PAIRING_PLAN_TIMEOUT_MS = 70_000;
const MAX_ACTIVITY_ENTRIES = 150;

const PORTS: Array<{ port: number; label: string }> = [
  { port: 1925, label: "JointSpace HTTP" },
  { port: 1926, label: "JointSpace HTTPS" },
  { port: 8008, label: "Chromecast HTTP (Android TV)" },
  { port: 8009, label: "Chromecast TLS (Android TV)" },
];

export type ProgressCallback = (message: string) => void;

export async function generateDeviceReport(opts: {
  device: Homey.Device;
  api: JointspaceApi;
  appVersion: string;
  homeyFirmwareVersion?: string;
  homeyPlatform?: string;
  discovery?: DiscoverySnapshot;
  network?: NetworkSnapshot;
  onProgress?: ProgressCallback;
}): Promise<DiagnosticReport> {
  const { device, api, appVersion, homeyFirmwareVersion, homeyPlatform, discovery, network, onProgress } = opts;
  const snapshot = snapshotDevice(device);
  const ip = typeof snapshot.settings.ipAddress === "string" ? snapshot.settings.ipAddress : null;

  onProgress?.("Checking TV ports…");
  const ports = ip ? await checkPorts(ip) : undefined;
  const probes = await runProbes(api, onProgress);
  const systemProbe = probes.find((p) => p.kind === "system" && p.status === "ok");

  return {
    generatedAt: new Date().toISOString(),
    appVersion,
    homeyFirmwareVersion,
    homeyPlatform,
    scope: "paired-device",
    scopeTarget: device.getName(),
    device: snapshot,
    network,
    discovery,
    system: systemProbe?.responseRaw as SystemInfo | undefined,
    ports,
    probes,
    activity: [
      { title: "Device log (commands, errors and failed requests)", entries: recentActivity(deviceScope(snapshot.id)) },
      { title: "Last pairing / repair attempts", entries: recentActivity(PAIRING_SCOPE) },
    ],
  };
}

/**
 * Report against an IP address only, for when pairing fails or discovery never finds the TV. Replays the
 * app's own transport decision and sends real pair/request calls, so one report shows where pairing breaks.
 */
export async function generateIpReport(opts: {
  ip: string;
  api: JointspaceApi;
  appVersion: string;
  homeyFirmwareVersion?: string;
  homeyPlatform?: string;
  discovery?: DiscoverySnapshot;
  network?: NetworkSnapshot;
  onProgress?: ProgressCallback;
}): Promise<DiagnosticReport> {
  const { ip, api, appVersion, homeyFirmwareVersion, homeyPlatform, discovery, network, onProgress } = opts;

  onProgress?.("Checking TV ports…");
  const ports = await checkPorts(ip);
  const systemProbes = await runUnauthenticatedProbes(api, onProgress);
  onProgress?.("Replaying the app's pairing transport decision…");
  const { plan, system } = await capturePairingPlan(ip);
  const pairProbes = await runPairRequestProbes(ip, plan, system, onProgress);

  return {
    generatedAt: new Date().toISOString(),
    appVersion,
    homeyFirmwareVersion,
    homeyPlatform,
    scope: "ip-only",
    scopeTarget: ip,
    network,
    discovery,
    system: system ?? (systemProbes.find((p) => p.status === "ok")?.responseRaw as SystemInfo | undefined),
    ports,
    pairingPlan: plan,
    probes: [...systemProbes, ...pairProbes],
    activity: [{ title: "Last pairing / repair attempts", entries: recentActivity(PAIRING_SCOPE) }],
  };
}

function recentActivity(scope: string): ActivityEntry[] {
  return activityLog.list(scope).slice(-MAX_ACTIVITY_ENTRIES);
}

async function checkPorts(ip: string): Promise<PortCheck[]> {
  return Promise.all(PORTS.map(({ port, label }) => checkPort(ip, port, label)));
}

function checkPort(ip: string, port: number, label: string): Promise<PortCheck> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port });
    const done = (result: PortCheck["result"], detail?: string) => {
      socket.destroy();
      resolve({ port, label, result, durationMs: Date.now() - started, detail });
    };
    socket.setTimeout(PORT_CHECK_TIMEOUT_MS, () => done("timeout"));
    socket.once("connect", () => done("open"));
    socket.once("error", (err: NodeJS.ErrnoException) =>
      done(err.code === "ECONNREFUSED" ? "refused" : "error", err.code ?? err.message),
    );
  });
}

async function capturePairingPlan(ip: string): Promise<{ plan: PairingPlanSnapshot; system?: SystemInfo }> {
  const log: string[] = [];
  const started = Date.now();
  const record = (...args: unknown[]) =>
    log.push(`+${Date.now() - started}ms ${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")}`);
  try {
    const probe = await withTimeout(probeTransport(ip, record, true), PAIRING_PLAN_TIMEOUT_MS);
    const chosen = probe.resolution?.transport;
    return {
      system: probe.system,
      plan: {
        systemTransport: probe.systemTransport ? `${probe.systemTransport.protocol}/${probe.systemTransport.port}` : null,
        advertised: probe.advertised,
        pairingType: probe.pairingType,
        osType: probe.osType,
        httpsResponds: probe.httpsResponds,
        chosen: chosen
          ? { protocol: chosen.secured ? "https" : "http", port: chosen.port, versionPrefix: chosen.apiVersion }
          : null,
        httpsUnavailable: probe.resolution?.httpsUnavailable,
        error: probe.resolutionError ? `${probe.resolutionError.name}: ${probe.resolutionError.message}` : undefined,
        log,
      },
    };
  } catch (err) {
    const e = err as Error;
    return { plan: { systemTransport: null, chosen: null, error: `${e.name}: ${e.message}`, log } };
  }
}

const targetUrl = (t: PairingTarget) =>
  `${t.protocol}://<ip>:${t.port}/${t.versionPrefix == null ? "" : `${t.versionPrefix}/`}pair/request`;

/** The app's chosen transport first, then the alternatives, stopping at the first one that shows a PIN. */
export function pairRequestTargets(plan: PairingPlanSnapshot, apiVersion: number): PairingTarget[] {
  const candidates: PairingTarget[] = [
    ...(plan.chosen ? [plan.chosen] : []),
    { protocol: "https", port: 1926, versionPrefix: apiVersion },
    { protocol: "http", port: 1925, versionPrefix: apiVersion },
    { protocol: "http", port: 1925, versionPrefix: null },
  ];
  const seen = new Set<string>();
  return candidates.filter((t) => {
    const key = targetUrl(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function runPairRequestProbes(
  ip: string,
  plan: PairingPlanSnapshot,
  system: SystemInfo | undefined,
  onProgress?: ProgressCallback,
): Promise<ProbeResult[]> {
  const skipped = (reason: string): ProbeResult[] => [{
    kind: "pair",
    label: "pair/request",
    method: "POST",
    endpoint: "pair/request",
    status: "skipped",
    errorMessage: reason,
  }];
  if (!system) return skipped("No /system response, so the pairing transport is unknown");
  const pairingType = extractPairingType(system) ?? "none";
  if (pairingType !== "digest_auth_pairing") return skipped(`TV does not use PIN pairing (pairing_type=${pairingType})`);

  const api = new JointspaceApi({ host: ip, apiVersion: system.api_version.Major, secured: false, port: 1925 });
  const device = { ...PAIR_DEVICE_INFO, id: JointspaceApi.generateDeviceId() };
  const results: ProbeResult[] = [];
  for (const target of pairRequestTargets(plan, system.api_version.Major)) {
    const isChosen = plan.chosen != null && targetUrl(plan.chosen) === targetUrl(target);
    onProgress?.(`Sending pair/request to ${targetUrl(target)} (a PIN may appear on the TV)…`);
    const result = await runProbe(
      `Pair request${isChosen ? " (transport the app uses)" : ""}`,
      "POST",
      targetUrl(target),
      async () => {
        const response = await api.probePairRequest(device, target);
        if (response.error_id !== PairingStatus.Success) {
          throw new PairingError(`pair/request rejected: ${response.error_id}`, response.error_id, response.error_text);
        }
        return { result: response };
      },
    );
    results.push({ ...result, kind: "pair" });
    if (result.status === "ok") break;
  }
  return results;
}

function snapshotDevice(device: Homey.Device): DeviceSnapshot {
  const data = device.getData() as { id?: string; mac?: string | null; credentials?: { user?: string; pass?: string } };
  const settings = device.getSettings() as Record<string, unknown>;
  const store: Record<string, unknown> = {};
  for (const key of device.getStoreKeys() ?? []) {
    if (SECRET_STORE_KEYS.has(key)) {
      store[key] = "<redacted>";
      continue;
    }
    store[key] = device.getStoreValue(key);
  }
  const capabilities = device.getCapabilities().map((cap) => ({
    id: cap,
    value: device.getCapabilityValue(cap),
  }));

  return {
    id: String(data.id ?? device.getName()),
    name: device.getName(),
    hasCredentials: Boolean(data.credentials?.user && data.credentials?.pass),
    mac: data.mac ?? null,
    settings,
    store,
    capabilities,
  };
}

interface ProbeSpec {
  label: string;
  method: "GET" | "POST";
  endpoint: string;
  runner: ProbeRunner;
}

async function runProbes(api: JointspaceApi, onProgress?: ProgressCallback): Promise<ProbeResult[]> {
  const progress = (msg: string) => onProgress?.(msg);

  // Phase 1: /system first, on its own. Most failures are auth/transport
  // problems that this probe surfaces; running it standalone makes its
  // result easy to spot in progress logs and avoids racing it against ten
  // other concurrent connections on TVs with fragile HTTPS servers.
  progress("Probing /system…");
  const systemProbe: ProbeResult = {
    ...(await runProbe(
      "System info",
      "GET",
      "/system (HTTP/1925 → HTTPS/1926 fallback)",
      async () => ({ result: await api.getSystem() }),
    )),
    kind: "system",
  };

  // Phase 2: live-state endpoints. Each is small, independent, and we want
  // them in parallel since the bottleneck is round-trip latency.
  progress("Probing live state (power, audio, ambilight, ambihue, screen)…");
  const stateSpecs: ProbeSpec[] = [
    {
      label: "Power state",
      method: "GET",
      endpoint: "powerstate",
      runner: async () => ({ result: await api.getPowerState() }),
    },
    {
      label: "Audio / volume",
      method: "GET",
      endpoint: "audio/volume",
      runner: async () => ({ result: await api.getAudioData() }),
    },
    {
      label: "Ambilight configuration",
      method: "GET",
      endpoint: "ambilight/currentconfiguration",
      runner: async () => ({ result: await api.getAmbilight() }),
    },
    {
      label: "AmbiHue state",
      method: "GET",
      endpoint: "HueLamp/power",
      runner: async () => ({ result: await api.getAmbiHue() }),
    },
    {
      label: "Screen state",
      method: "GET",
      endpoint: "screenstate",
      runner: async () => ({ result: await api.getScreenState() }),
    },
  ];
  const stateProbes = await Promise.all(
    stateSpecs.map((p) => runProbe(p.label, p.method, p.endpoint, p.runner)),
  );

  // Phase 3: list/lookup endpoints. Same parallel pattern, but separated
  // from live state because they trigger heavier work on the TV (channel db
  // can be slow) and benefit from not competing with the state probes.
  progress("Probing applications, channels, sources…");
  const listSpecs: ProbeSpec[] = [
    {
      label: "Applications",
      method: "GET",
      endpoint: "applications",
      runner: async () => ({ result: await api.getApplications() }),
    },
    {
      label: "Channel database (TV)",
      method: "GET",
      endpoint: "channeldb/tv",
      runner: async () => ({ result: await api.getChannelLists() }),
    },
    {
      label: "Sources",
      method: "GET",
      endpoint: "sources",
      runner: async () => ({ result: await api.getSources() }),
    },
    {
      label: "Current source",
      method: "GET",
      endpoint: "sources/current",
      runner: async () => ({ result: await api.getCurrentSource() }),
    },
  ];
  const listProbes = await Promise.all(
    listSpecs.map((p) => runProbe(p.label, p.method, p.endpoint, p.runner)),
  );

  // Phase 4: long-poll notifyChange. We deliberately leave room for the TV
  // to either push a real state update or close the connection - both
  // outcomes are diagnostically useful.
  progress(`Long-polling notifyChange (up to ${NOTIFY_PROBE_TIMEOUT_MS / 1000}s)…`);
  const notifyProbe = await runProbe(
    `notifyChange (long-poll probe, ${NOTIFY_PROBE_TIMEOUT_MS / 1000}s timeout)`,
    "POST",
    "notifychange",
    async () => {
      const racePromise = Promise.race([
        api.notifyChange(),
        new Promise<{ timedOut: true }>((resolve) =>
          setTimeout(() => resolve({ timedOut: true }), NOTIFY_PROBE_TIMEOUT_MS),
        ),
      ]);
      return { result: await racePromise };
    },
    NOTIFY_PROBE_TIMEOUT_MS + 1_000,
  );

  progress("Reading the settings menu (picture style, Ambilight styles)…");
  const menuProbes = await runMenuProbes(api);

  return [systemProbe, ...stateProbes, ...listProbes, ...menuProbes, notifyProbe];
}

async function runMenuProbes(api: JointspaceApi): Promise<ProbeResult[]> {
  const structureProbe: ProbeResult = {
    ...(await runProbe("Settings menu structure", "GET", "menuitems/settings/structure", async () => ({
      result: await api.getMenuStructure(),
    }), 25_000)),
    kind: "menu-structure",
  };
  if (structureProbe.status !== "ok") return [structureProbe];
  const nodes = menuNodesToRead(extractMenuCapabilities(structureProbe.responseRaw as MenuStructure));
  if (nodes.length === 0) return [structureProbe];
  const currentProbe: ProbeResult = {
    ...(await runProbe("Settings menu values", "POST", "menuitems/settings/current", async () => ({
      result: await api.getMenuCurrent(nodes),
    }))),
    kind: "menu-current",
  };
  return [structureProbe, currentProbe];
}

async function runUnauthenticatedProbes(api: JointspaceApi, onProgress?: ProgressCallback): Promise<ProbeResult[]> {
  // Probe both transports separately so the report shows which one the TV
  // actually serves. Important when the TV advertises secured_transport=true
  // but only responds on HTTP/1925 (or vice versa); pair/request will hang
  // on the wrong transport even though /system works on the other.
  onProgress?.("Probing /system on HTTP/1925 and HTTPS/1926 (unversioned and version-prefixed)…");
  const specs: ProbeSpec[] = [
    {
      label: "System info (HTTP/1925)",
      method: "GET",
      endpoint: "http://<ip>:1925/system",
      runner: async () => ({ result: await api.probeSystemHttp() }),
    },
    {
      label: "System info (HTTPS/1926)",
      method: "GET",
      endpoint: "https://<ip>:1926/system",
      runner: async () => ({ result: await api.probeSystemHttps() }),
    },
    // Version-prefixed paths: some firmwares 403 the bare /system but serve
    // /1/system (issue #60). Probing both makes that asymmetry obvious in the
    // report instead of looking like a flat "TV refuses everything".
    {
      label: "System info (HTTP/1925, /1/system)",
      method: "GET",
      endpoint: "http://<ip>:1925/1/system",
      runner: async () => ({ result: await api.probeSystemVersionedHttp(1) }),
    },
    {
      label: "System info (HTTP/1925, /5/system)",
      method: "GET",
      endpoint: "http://<ip>:1925/5/system",
      runner: async () => ({ result: await api.probeSystemVersionedHttp(5) }),
    },
    // Some TVs serve API v6 over plain HTTP when HTTPS/1926 is closed (#61, #67).
    {
      label: "System info (HTTP/1925, /6/system)",
      method: "GET",
      endpoint: "http://<ip>:1925/6/system",
      runner: async () => ({ result: await api.probeSystemVersionedHttp(6) }),
    },
    {
      label: "System info (HTTPS/1926, /6/system)",
      method: "GET",
      endpoint: "https://<ip>:1926/6/system",
      runner: async () => ({ result: await api.probeSystemVersionedHttps(6) }),
    },
  ];
  const results = await Promise.all(
    specs.map((p) => runProbe(p.label, p.method, p.endpoint, p.runner)),
  );
  return results.map((r) => ({ ...r, kind: "system" as const }));
}

async function runProbe(
  label: string,
  method: "GET" | "POST",
  endpoint: string,
  runner: ProbeRunner,
  timeoutMs: number = PER_PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const { result } = (await withTimeout(runner(), timeoutMs)) as { result: unknown };
    return {
      label,
      method,
      endpoint,
      status: "ok",
      durationMs: Date.now() - started,
      responseSummary: summariseResponse(result),
      responseRaw: result,
    };
  } catch (err) {
    const e = err as Error & { statusCode?: number };
    return {
      label,
      method,
      endpoint,
      status: "fail",
      durationMs: Date.now() - started,
      statusCode: e.statusCode,
      errorName: e.name,
      errorMessage: e.message,
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Probe timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function summariseResponse(value: unknown): string {
  if (value == null) return String(value);
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return "<unserialisable>";
  }
  if (json.length <= RESPONSE_PREVIEW_LENGTH) return json;
  return `${json.slice(0, RESPONSE_PREVIEW_LENGTH)}… (truncated, ${json.length} chars)`;
}

export function renderMarkdown(report: DiagnosticReport): string {
  const lines: string[] = [];
  const scopeHeader = report.scope === "paired-device"
    ? `paired device "${report.scopeTarget}"`
    : `IP address \`${report.scopeTarget}\` (no paired device)`;
  lines.push("# Philips TV diagnostic report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- App version: ${report.appVersion}`);
  if (report.homeyFirmwareVersion) lines.push(`- Homey firmware: ${report.homeyFirmwareVersion}`);
  if (report.homeyPlatform) lines.push(`- Homey platform: ${report.homeyPlatform}`);
  lines.push(`- Scope: ${scopeHeader}`);
  lines.push("");

  const findings = analyseReport(report);
  if (findings.length > 0) {
    lines.push("## Analysis");
    lines.push("");
    for (const f of findings) {
      lines.push(`- **${f.title}.** ${f.detail}`);
    }
    lines.push("");
  }

  if (report.system) {
    const system = report.system;
    const features = system.featuring?.systemfeatures;
    lines.push("## TV");
    lines.push("");
    lines.push(`- Name: ${system.name ?? "-"}`);
    lines.push(`- API version: ${system.api_version ? `${system.api_version.Major}.${system.api_version.Minor}.${system.api_version.Patch}` : "-"}`);
    lines.push(`- OS type: ${extractOsType(system) ?? "-"}`);
    lines.push(`- Pairing type: ${extractPairingType(system) ?? "none"}`);
    lines.push(`- Secured transport advertised: ${extractSecuredTransport(system) ? "yes" : "no"}`);
    if (features) lines.push(`- System features: \`${JSON.stringify(features)}\``);
    lines.push("");
    lines.push("<details><summary>Full /system response</summary>");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(system, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  if (report.device) {
    const device = report.device;
    lines.push("## Device snapshot");
    lines.push("");
    lines.push(`- Name: ${device.name}`);
    lines.push(`- Data id: ${device.id}`);
    lines.push(`- Has credentials: ${device.hasCredentials ? "yes" : "no"}`);
    lines.push("");
    lines.push("### Settings");
    lines.push("```json");
    lines.push(JSON.stringify(device.settings, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("### Store");
    lines.push("```json");
    lines.push(JSON.stringify(device.store, null, 2));
    lines.push("```");
    lines.push("");
    const stateful = device.capabilities.filter((c) => c.value !== null && c.value !== undefined);
    const stateless = device.capabilities.filter((c) => c.value === null || c.value === undefined);
    lines.push(`### Capabilities (${device.capabilities.length} total, ${stateful.length} with state)`);
    for (const cap of stateful) {
      lines.push(`- \`${cap.id}\` = ${JSON.stringify(cap.value)}`);
    }
    if (stateless.length > 0) {
      lines.push("");
      lines.push(`<details><summary>${stateless.length} stateless capabilities (write-only keys / triggers)</summary>`);
      lines.push("");
      lines.push(stateless.map((c) => `\`${c.id}\``).join(", "));
      lines.push("");
      lines.push("</details>");
    }
    lines.push("");
  }

  if (report.network) {
    lines.push("## Network");
    lines.push("");
    lines.push(`- Configured IP: \`${report.network.ip}\``);
    if (report.network.arpMac) {
      lines.push(`- ARP-resolved MAC: \`${report.network.arpMac}\` (would enable Wake-on-LAN)`);
    } else if (report.network.arpError) {
      lines.push(`- ARP lookup failed: ${report.network.arpError}`);
    } else {
      lines.push(`- ARP lookup: no MAC found (TV may be powered off or on a different subnet)`);
    }
    lines.push("");
  }

  if (report.discovery) {
    lines.push("## Discovery");
    lines.push("");
    lines.push(`- SSDP (\`MediaRenderer:3\`): ${report.discovery.ssdpResults} result(s)`);
    for (const r of report.discovery.ssdpSample) {
      lines.push(`  - \`${r.id}\` at \`${r.address}\``);
    }
    const unique = report.discovery.mdnsUniqueAddresses;
    const uniqueNote = unique != null && unique !== report.discovery.mdnsResults ? ` (${unique} unique address(es))` : "";
    lines.push(`- mDNS (\`_philipstv_s_rpc._tcp\`): ${report.discovery.mdnsResults} result(s)${uniqueNote}`);
    for (const r of report.discovery.mdnsSample) {
      lines.push(`  - \`${r.name ?? r.id}\` at \`${r.address}\``);
    }
    lines.push("");
  }

  if (report.ports) {
    lines.push("## Ports");
    lines.push("");
    for (const p of report.ports) {
      lines.push(`- ${p.port} (${p.label}): **${p.result}** in ${p.durationMs} ms${p.detail ? ` (${p.detail})` : ""}`);
    }
    lines.push("");
  }

  if (report.pairingPlan) {
    const plan = report.pairingPlan;
    lines.push("## Pairing transport (as the app decides it)");
    lines.push("");
    lines.push(`- /system answered on: ${plan.systemTransport ?? "nothing"}`);
    if (plan.advertised) lines.push(`- TV advertises: \`${JSON.stringify(plan.advertised)}\``);
    if (plan.pairingType) lines.push(`- Pairing type: ${plan.pairingType}, OS type: ${plan.osType ?? "-"}`);
    if (plan.httpsResponds != null) lines.push(`- HTTPS check: ${plan.httpsResponds ? "responds" : "does not respond"}`);
    lines.push(`- Chosen: ${plan.chosen ? `\`${plan.chosen.protocol}/${plan.chosen.port}\` (API ${plan.chosen.versionPrefix})${plan.httpsUnavailable ? ", HTTP fallback because HTTPS is unavailable" : ""}` : "none"}`);
    if (plan.error) lines.push(`- Error: ${plan.error}`);
    if (plan.log.length > 0) {
      lines.push("");
      lines.push("<details><summary>Request log</summary>");
      lines.push("");
      lines.push("```");
      lines.push(...plan.log);
      lines.push("```");
      lines.push("");
      lines.push("</details>");
    }
    lines.push("");
  }

  lines.push("## Probes");
  lines.push("");
  lines.push("| Result | Endpoint | Status | Time | Summary |");
  lines.push("|---|---|---|---|---|");
  for (const p of report.probes) {
    const result = p.status === "ok" ? "✅" : p.status === "skipped" ? "⏭" : "❌";
    const status = p.status === "ok" ? "200" : `${p.statusCode ?? "-"} ${p.errorName ?? ""}`.trim();
    const time = p.durationMs != null ? `${p.durationMs} ms` : "-";
    const summary = p.status === "ok"
      ? truncateForTable(p.responseSummary ?? "")
      : truncateForTable(p.errorMessage ?? "");
    lines.push(`| ${result} | \`${p.method} ${p.endpoint}\` | ${status} | ${time} | ${summary} |`);
  }
  lines.push("");

  lines.push(...renderMenuSection(report));

  for (const section of report.activity ?? []) {
    lines.push(`## ${section.title}`);
    lines.push("");
    if (section.entries.length === 0) {
      lines.push("_Nothing recorded since the app last started._");
    } else {
      lines.push(`<details><summary>${section.entries.length} entries</summary>`);
      lines.push("");
      lines.push("```");
      for (const e of section.entries) lines.push(`${e.at} ${e.message}`);
      lines.push("```");
      lines.push("");
      lines.push("</details>");
    }
    lines.push("");
  }

  lines.push("## Raw probe data (JSON)");
  lines.push("");
  lines.push("<details><summary>Click to expand</summary>");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(report.probes.map(stripRaw), null, 2));
  lines.push("```");
  lines.push("");
  lines.push("</details>");

  return lines.join("\n");
}

function renderMenuSection(report: DiagnosticReport): string[] {
  const structureProbe = report.probes.find((p) => p.kind === "menu-structure");
  if (!structureProbe) return [];
  const lines = ["## Settings menu", ""];
  const structure = structureProbe.responseRaw as MenuStructure | undefined;
  if (structureProbe.status !== "ok" || !structure?.node) {
    lines.push(`The TV did not return its settings menu (${structureProbe.statusCode ?? "-"} ${structureProbe.errorMessage ?? ""}).`.replace(/\s+\)/, ")"));
    lines.push("Picture style and the Ambilight style list then fall back to the fixed list.", "");
    return lines;
  }
  const capabilities = extractMenuCapabilities(structure);
  const current = report.probes.find((p) => p.kind === "menu-current" && p.status === "ok")?.responseRaw as MenuCurrentResponse | undefined;

  const picture = capabilities.pictureStyle;
  if (picture) {
    const selected = current ? currentPictureStyle(picture, current) : null;
    lines.push(`- **Picture style** (node ${picture.nodeId}): ${picture.options.map((o) => `\`${o.id}\`=${o.enumId}`).join(", ")}`);
    lines.push(`  - Current: ${selected ? `\`${selected}\`` : "unknown"}`);
  } else {
    lines.push("- **Picture style**: not in the menu");
  }
  const ambilight = capabilities.ambilight;
  if (ambilight) {
    const selected = current ? currentAmbilightMode(ambilight, current) : null;
    lines.push(`- **Ambilight style** (node ${ambilight.styleNodeId}): ${ambilight.options.map((o) => `\`${o.id}\``).join(", ")}`);
    lines.push(`  - Current: ${selected ? `\`${selected}\`` : "unknown"}`);
  } else {
    lines.push("- **Ambilight style**: not in the menu");
  }
  for (const [capabilityId, slider] of Object.entries(capabilities.sliders ?? {})) {
    const value = current ? currentSliderValue(slider, current) : null;
    lines.push(`- **${capabilityId}** (node ${slider.nodeId}): ${slider.min} to ${slider.max}, step ${slider.step}, current ${value ?? "unknown"}`);
  }
  lines.push("");
  lines.push("<details><summary>Full menu tree</summary>");
  lines.push("");
  lines.push("```");
  lines.push(...describeMenuTree(structure.node));
  lines.push("```");
  lines.push("");
  lines.push("</details>");
  if (current) {
    lines.push("");
    lines.push("<details><summary>Current menu values</summary>");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(current, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("</details>");
  }
  lines.push("");
  return lines;
}

function truncateForTable(text: string): string {
  const cleaned = text.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned;
}

function stripRaw(p: ProbeResult): ProbeResult {
  // Drop the giant raw response from the JSON appendix since the summary
  // already captures it. Keeps the report under reasonable size.
  const { responseRaw: _, ...rest } = p;
  return rest;
}
