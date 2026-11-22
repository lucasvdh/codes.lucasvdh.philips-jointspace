// Kept free of Homey imports so it can be unit-tested.
import { PairingStatus } from "./enums";
import { HttpsUnavailableError, PairingError } from "./errors";
import { JointspaceApi, LogFn } from "./jointspace-api";
import {
  canonicalIdAliases,
  extractOsType,
  extractPairingType,
  extractTransportConfig,
  osRequiresHttpsForAuthenticatedEndpoints,
  TransportConfig,
} from "./quirks";
import { PairDevice, Protocol, SystemInfo } from "./types";

export const PAIR_DEVICE_INFO: PairDevice = {
  app_id: "codes.lucasvdh.philips-jointspace",
  app_name: "Homey Philips TV",
  device_name: "Homey",
  device_os: "Homey",
  id: "",
  type: "native",
};

export interface TransportResolution {
  transport: TransportConfig;
  httpsUnavailable: boolean;
}

/** MSAF only serves authenticated endpoints over HTTPS; other TVs may pair over HTTP when 1926 is closed (#61, #67). */
export function resolveTransport(
  advertised: TransportConfig,
  httpsResponds: boolean,
  osType: string | null,
): TransportResolution {
  if (!advertised.secured || httpsResponds) {
    return { transport: advertised, httpsUnavailable: false };
  }
  if (osRequiresHttpsForAuthenticatedEndpoints(osType)) {
    throw new HttpsUnavailableError(
      `TV requires HTTPS (osType=${osType}) but HTTPS/${advertised.port} is not responding`,
    );
  }
  return {
    transport: { apiVersion: advertised.apiVersion, secured: false, port: 1925 },
    httpsUnavailable: true,
  };
}

export interface TransportProbe {
  system: SystemInfo;
  /** Which /system attempt answered first. */
  systemTransport: { protocol: Protocol; port: number } | null;
  advertised: TransportConfig;
  pairingType: string;
  osType: string | null;
  /** null when no separate HTTPS check was needed. */
  httpsResponds: boolean | null;
  resolution: TransportResolution | null;
  resolutionError: Error | null;
}

/** The transport decision pairing makes; shared with the diagnostic report so both always agree. */
export async function probeTransport(ip: string, log: LogFn, debug = false): Promise<TransportProbe> {
  const api = new JointspaceApi({ host: ip, apiVersion: 1, secured: false, port: 1925 }, { log, debug });
  const system = await api.getSystem();
  const advertised = extractTransportConfig(system);
  const osType = extractOsType(system);
  const systemTransport = api.getLastSystemTransport();
  const base = { system, systemTransport, advertised, pairingType: extractPairingType(system) ?? "none", osType };

  // A second HTTPS request to a fragile TV often hangs; trust a getSystem that just succeeded.
  if (!advertised.secured || (systemTransport?.protocol === "https" && systemTransport.port === advertised.port)) {
    return {
      ...base,
      httpsResponds: null,
      resolution: { transport: advertised, httpsUnavailable: false },
      resolutionError: null,
    };
  }

  const httpsApi = new JointspaceApi(
    { host: ip, apiVersion: advertised.apiVersion, secured: true, port: advertised.port },
    { log, debug },
  );
  const httpsResponds = await httpsApi.verifyHttpsResponds();
  try {
    return { ...base, httpsResponds, resolution: resolveTransport(advertised, httpsResponds, osType), resolutionError: null };
  } catch (err) {
    return { ...base, httpsResponds, resolution: null, resolutionError: err as Error };
  }
}

export type PinErrorAction =
  | { kind: "retry_pin" }
  | { kind: "restart_pair"; messageKey: string }
  | { kind: "abort"; messageKey: string; tokens?: Record<string, string> };

export function classifyPinError(err: unknown): PinErrorAction {
  if (err instanceof PairingError) {
    if (err.errorId === PairingStatus.InvalidPin) return { kind: "retry_pin" };
    if (err.errorId === PairingStatus.Timeout) {
      return { kind: "restart_pair", messageKey: "error.pairing_timeout" };
    }
    return {
      kind: "abort",
      messageKey: "error.pairing_rejected",
      tokens: { reason: describePairingError(err) },
    };
  }
  return { kind: "abort", messageKey: "error.generic" };
}

export function describePairingError(err: PairingError): string {
  const parts = [err.errorId, err.errorText].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.join(": ") : "unknown";
}

/** Concurrent callers share one in-flight run. */
export function singleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (!inFlight) {
      inFlight = task().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  };
}

/** Every id the already-paired TVs may be known by. `excludeDataId` is the device being repaired. */
export function existingCanonicalIds(
  devices: Array<{ dataId: string; canonicalId: string | null }>,
  excludeDataId: string | null,
): Set<string> {
  const ids = new Set<string>();
  for (const d of devices) {
    if (excludeDataId !== null && d.dataId === excludeDataId) continue;
    for (const id of [d.canonicalId, d.dataId]) {
      if (id) for (const alias of canonicalIdAliases(id)) ids.add(alias);
    }
  }
  return ids;
}

export function isAlreadyPaired(candidateAliases: string[], existing: Set<string>): boolean {
  return candidateAliases.some((id) => existing.has(id));
}
