/** Explains known failure patterns in diagnostic reports. Patterns come from real issue reports. */

export interface AnalysableProbe {
  label: string;
  endpoint: string;
  status: "ok" | "fail" | "skipped";
  statusCode?: number;
  errorName?: string;
  errorMessage?: string;
}

export interface AnalysableReport {
  scope: "paired-device" | "ip-only";
  probes: AnalysableProbe[];
}

export interface Finding {
  id:
    | "api-service-not-running"
    | "https-closed-http-works"
    | "unreachable"
    | "network-healthy"
    | "tv-not-responding"
    | "sources-forbidden"
    | "applications-forbidden";
  title: string;
  detail: string;
}

const isHttps = (p: AnalysableProbe) => p.endpoint.startsWith("https://");
const isHttp = (p: AnalysableProbe) => p.endpoint.startsWith("http://");
const isRefused = (p: AnalysableProbe) => p.status === "fail" && /ECONNREFUSED/.test(p.errorMessage ?? "");
const isNoResponse = (p: AnalysableProbe) =>
  p.status === "fail" &&
  (p.errorName === "OfflineError" || /timeout|timed out/i.test(p.errorMessage ?? ""));

export function analyseReport(report: AnalysableReport): Finding[] {
  return report.scope === "ip-only" ? analyseIpReport(report.probes) : analysePairedReport(report.probes);
}

function analyseIpReport(probes: AnalysableProbe[]): Finding[] {
  const http = probes.filter(isHttp);
  const https = probes.filter(isHttps);
  if (http.length === 0 && https.length === 0) return [];

  const httpOk = http.some((p) => p.status === "ok");
  const httpsOk = https.some((p) => p.status === "ok");

  if (probes.every(isNoResponse)) {
    return [{
      id: "unreachable",
      title: "The TV did not answer at all",
      detail:
        "Nothing answered on port 1925 or 1926. Check that the IP address is correct, that the TV is switched on " +
        "(not in standby) and that Homey and the TV are on the same network.",
    }];
  }

  // #65, #68
  if (!httpOk && !httpsOk && http.length > 0 && http.every((p) => p.statusCode === 500)) {
    return [{
      id: "api-service-not-running",
      title: "The TV's control API is not running",
      detail:
        "The TV answers on port 1925 but returns HTTP 500 for every request, and port 1926 is closed. The TV is " +
        "reachable, but its JointSpace API service is not working, so this is not a Homey or network problem. " +
        "Try: (1) switch the TV fully on and wait until the home screen is shown; (2) unplug the TV for 60 seconds, " +
        "plug it back in and wait 5 minutes; (3) install the latest TV firmware. Then generate this report again.",
    }];
  }

  // #61, #67
  if (httpOk && !httpsOk && https.length > 0 && https.every(isRefused)) {
    return [{
      id: "https-closed-http-works",
      title: "The TV only serves its API over HTTP (port 1925)",
      detail:
        "System info works on port 1925, but port 1926 (HTTPS) refuses connections. This app version then tries " +
        "pairing over HTTP. If pairing still fails, unplug the TV for 60 seconds and try again; on some firmwares " +
        "the HTTPS service only starts after a full power-cycle.",
    }];
  }

  // #62, #66
  if (httpOk && httpsOk) {
    return [{
      id: "network-healthy",
      title: "Network and API look healthy",
      detail:
        "The TV answers on both HTTP/1925 and HTTPS/1926. If pairing still fails, the problem is in the PIN " +
        "handshake itself. Please mention whether a PIN appears on the TV and the exact message Homey shows.",
    }];
  }

  return [];
}

function analysePairedReport(probes: AnalysableProbe[]): Finding[] {
  const findings: Finding[] = [];
  // notifychange is a long-poll that "succeeds" by timing out.
  const requestProbes = probes.filter((p) => p.endpoint !== "notifychange");

  // #64
  if (requestProbes.length > 0 && requestProbes.every(isNoResponse)) {
    findings.push({
      id: "tv-not-responding",
      title: "The TV did not respond",
      detail:
        "No request got an answer. This is normal when the TV is switched off or in standby: most Philips TVs " +
        "switch their network API off then. Generate the report again while the TV is on.",
    });
    return findings;
  }

  const forbidden = (endpoint: string) =>
    requestProbes.some((p) => p.endpoint === endpoint && p.status === "fail" && p.statusCode === 403);

  // #69
  if (forbidden("sources")) {
    findings.push({
      id: "sources-forbidden",
      title: "The TV refuses access to its input sources",
      detail:
        "The sources endpoint returns HTTP 403, so this TV does not allow switching inputs (HDMI, ...) through " +
        "its API. On Android TVs the app falls back to Google Assistant; TVs without Google Assistant cannot " +
        "switch sources from Homey.",
    });
  }
  if (forbidden("applications")) {
    findings.push({
      id: "applications-forbidden",
      title: "The TV refuses access to its app list",
      detail:
        "The applications endpoint returns HTTP 403, so the app list and app flow cards are not available on " +
        "this TV.",
    });
  }
  return findings;
}

// mDNS name conflicts can make one TV appear hundreds of times ("Name (3)", "Name (5)", ...).
export function uniqueByAddress<T extends { address: string }>(results: T[]): T[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    if (seen.has(r.address)) return false;
    seen.add(r.address);
    return true;
  });
}
