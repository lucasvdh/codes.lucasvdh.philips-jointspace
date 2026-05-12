import type Homey from "homey";
import type { JointspaceApi } from "./jointspace-api";

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
// Homey settings API call has a 10s ceiling, and we run all probes inside a
// single request, so each individual probe gets capped well below that.
// `notifyChange` is the only legitimately slow one (it's a long-poll); we
// shorten it to enough time to confirm the endpoint exists.
const PER_PROBE_TIMEOUT_MS = 4_000;
const NOTIFY_PROBE_TIMEOUT_MS = 4_000;

export async function generateDeviceReport(opts: {
  device: Homey.Device;
  api: JointspaceApi;
  appVersion: string;
  homeyFirmwareVersion?: string;
  homeyPlatform?: string;
  discovery?: DiscoverySnapshot;
  network?: NetworkSnapshot;
}): Promise<DiagnosticReport> {
  const { device, api, appVersion, homeyFirmwareVersion, homeyPlatform, discovery, network } = opts;

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
    probes: await runProbes(api),
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
}): Promise<DiagnosticReport> {
  const { ip, api, appVersion, homeyFirmwareVersion, homeyPlatform, discovery, network } = opts;

  return {
    generatedAt: new Date().toISOString(),
    appVersion,
    homeyFirmwareVersion,
    homeyPlatform,
    scope: "ip-only",
    scopeTarget: ip,
    network,
    discovery,
    probes: await runUnauthenticatedProbes(api),
  };
}

function snapshotDevice(device: Homey.Device): DeviceSnapshot {
  const data = device.getData() as { id?: string; mac?: string | null; credentials?: { user?: string; pass?: string } };
  const settings = device.getSettings() as Record<string, unknown>;
  const store: Record<string, unknown> = {};
  for (const key of device.getStoreKeys() ?? []) {
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

async function runProbes(api: JointspaceApi): Promise<ProbeResult[]> {
  const probes: Array<{ label: string; method: "GET" | "POST"; endpoint: string; runner: ProbeRunner }> = [
    {
      label: "System info",
      method: "GET",
      endpoint: "/system (HTTP/1925 → HTTPS/1926 fallback)",
      runner: async () => ({ result: await api.getSystem() }),
    },
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
      label: `notifyChange (long-poll probe, ${NOTIFY_PROBE_TIMEOUT_MS / 1000}s timeout)`,
      method: "POST",
      endpoint: "notifychange",
      runner: async () => {
        const racePromise = Promise.race([
          api.notifyChange(),
          new Promise<{ timedOut: true }>((resolve) =>
            setTimeout(() => resolve({ timedOut: true }), NOTIFY_PROBE_TIMEOUT_MS),
          ),
        ]);
        return { result: await racePromise };
      },
    },
  ];

  // Run all probes in parallel so the total time is bounded by the slowest
  // single probe, not the sum. Each probe carries its own timeout so a fully
  // offline TV doesn't lock the report-generation up.
  return Promise.all(
    probes.map((p) => runProbe(p.label, p.method, p.endpoint, p.runner)),
  );
}

async function runUnauthenticatedProbes(api: JointspaceApi): Promise<ProbeResult[]> {
  const probes: Array<{ label: string; method: "GET" | "POST"; endpoint: string; runner: ProbeRunner }> = [
    {
      label: "System info",
      method: "GET",
      endpoint: "/system (HTTP/1925 → HTTPS/1926 fallback)",
      runner: async () => ({ result: await api.getSystem() }),
    },
  ];
  return Promise.all(
    probes.map((p) => runProbe(p.label, p.method, p.endpoint, p.runner)),
  );
}

async function runProbe(
  label: string,
  method: "GET" | "POST",
  endpoint: string,
  runner: ProbeRunner,
): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const { result } = await withTimeout(runner(), PER_PROBE_TIMEOUT_MS);
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
