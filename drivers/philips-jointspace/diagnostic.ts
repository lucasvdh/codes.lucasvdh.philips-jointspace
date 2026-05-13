import type Homey from "homey";
import type { JointspaceApi } from "./jointspace-api";

// Store keys whose value must never appear in a diagnostic report.
const SECRET_STORE_KEYS = new Set<string>(["credentials"]);

export interface ProbeResult {
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
}

export interface NetworkSnapshot {
  ip: string;
  arpMac?: string;
  arpError?: string;
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
  probes: ProbeResult[];
}

interface ProbeRunner {
  (): Promise<{ result: unknown }>;
}

const RESPONSE_PREVIEW_LENGTH = 600;
// The report no longer runs inside a settings-API request — it's kicked off
// in the background and progress streams back over realtime events. That
// lifts the old 10s ceiling, so individual probes can take as long as a
// genuinely slow Philips TV needs. notifyChange is a long-poll: a 30s
// timeout gives the TV a real chance to stream at least one state change
// while still bounding the worst case.
const PER_PROBE_TIMEOUT_MS = 15_000;
const NOTIFY_PROBE_TIMEOUT_MS = 30_000;

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

  return {
    generatedAt: new Date().toISOString(),
    appVersion,
    homeyFirmwareVersion,
    homeyPlatform,
    scope: "paired-device",
    scopeTarget: device.getName(),
    device: snapshotDevice(device),
    network,
    discovery,
    probes: await runProbes(api, onProgress),
  };
}

/**
 * Build a report against an IP address only, used when the TV refuses to
 * pair or when discovery never finds it. We can only run the handful of
 * probes that don't require credentials (which means: getSystem and not
 * much else), so the body is intentionally thinner than the paired-device
 * report.
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

  return {
    generatedAt: new Date().toISOString(),
    appVersion,
    homeyFirmwareVersion,
    homeyPlatform,
    scope: "ip-only",
    scopeTarget: ip,
    network,
    discovery,
    probes: await runUnauthenticatedProbes(api, onProgress),
  };
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
  const systemProbe = await runProbe(
    "System info",
    "GET",
    "/system (HTTP/1925 → HTTPS/1926 fallback)",
    async () => ({ result: await api.getSystem() }),
  );

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
  ];
  const listProbes = await Promise.all(
    listSpecs.map((p) => runProbe(p.label, p.method, p.endpoint, p.runner)),
  );

  // Phase 4: long-poll notifyChange. We deliberately leave room for the TV
  // to either push a real state update or close the connection — both
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

  return [systemProbe, ...stateProbes, ...listProbes, notifyProbe];
}

async function runUnauthenticatedProbes(api: JointspaceApi, onProgress?: ProgressCallback): Promise<ProbeResult[]> {
  // Probe both transports separately so the report shows which one the TV
  // actually serves. Important when the TV advertises secured_transport=true
  // but only responds on HTTP/1925 (or vice versa); pair/request will hang
  // on the wrong transport even though /system works on the other.
  onProgress?.("Probing /system on HTTP/1925 and HTTPS/1926…");
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
  ];
  return Promise.all(
    specs.map((p) => runProbe(p.label, p.method, p.endpoint, p.runner)),
  );
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
    lines.push(`- mDNS (\`_philipstv_s_rpc._tcp\`): ${report.discovery.mdnsResults} result(s)`);
    for (const r of report.discovery.mdnsSample) {
      lines.push(`  - \`${r.name ?? r.id}\` at \`${r.address}\``);
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
