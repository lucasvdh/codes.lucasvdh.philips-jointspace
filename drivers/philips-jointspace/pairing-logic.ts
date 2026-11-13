// Kept free of Homey imports so it can be unit-tested.
import { PairingStatus } from "./enums";
import { HttpsUnavailableError, PairingError } from "./errors";
import { osRequiresHttpsForAuthenticatedEndpoints, TransportConfig } from "./quirks";

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
