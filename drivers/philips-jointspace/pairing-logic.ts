/**
 * Pure decision logic for the pair flow. Kept free of Homey and network
 * imports so it can be unit-tested in CI (see tests/).
 */
import { PairingStatus } from "./enums";
import { HttpsUnavailableError, PairingError } from "./errors";
import { osRequiresHttpsForAuthenticatedEndpoints, TransportConfig } from "./quirks";

export interface TransportResolution {
  transport: TransportConfig;
  /**
   * True when the TV advertised HTTPS but HTTPS/1926 didn't answer and we
   * fell back to HTTP/1925. During pairing this means pair/request is a
   * best-effort attempt on HTTP; if it fails the user should power-cycle.
   */
  httpsUnavailable: boolean;
}

/**
 * Decide which transport to use once we know whether HTTPS/1926 answers.
 *
 *   - Not secured, or HTTPS answers: use the advertised transport.
 *   - MSAF (Android XTV): authenticated endpoints only exist on HTTPS, so
 *     falling back is pointless. Throw so the UI asks for a power-cycle.
 *   - Everything else (including digest_auth_pairing): fall back to
 *     HTTP/1925 and flag it. Some Saphi/Linux API-6.1 sets (issues #61,
 *     #67) refuse 1926 outright while serving the versioned API on 1925, so
 *     we try pair/request there before giving up.
 */
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
  /** Wrong PIN; keep the PIN screen open so the user can retry. */
  | { kind: "retry_pin" }
  /** The PIN on screen is no longer valid; start a new pair/request. */
  | { kind: "restart_pair"; messageKey: string }
  /** Pairing cannot continue; go back to discovery and show a message. */
  | { kind: "abort"; messageKey: string; tokens?: Record<string, string> };

/**
 * Map an error thrown by confirmPair (pair/grant) to what the pair UI
 * should do next. Previously every unrecognised error_id collapsed into a
 * generic message and a TIMEOUT silently restarted the flow, which looked
 * like "the TV keeps asking for a new PIN" (issue #66) with no clue why.
 */
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

/**
 * Wraps an async task so concurrent callers share one in-flight run.
 * Used for pair/request: every call makes the TV show a new PIN and
 * invalidates the previous one, so a duplicate start_pair view event must
 * not fire a second request while the first is still pending.
 */
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
