import type { SystemInfo } from "./types";

export interface SystemMetadata {
  osType: string | null;
  notifyChangeSupported: boolean;
  pairingType: string | null;
}

/**
 * Android-XTV firmware (os_type starting with "MSAF_") and Saphi/Linux
 * firmware both have a known bug where ambilight/currentconfiguration
 * doesn't reflect the new mode after a set. We cache the locally-set
 * mode and prefer it over the TV-reported one until the user changes
 * mode again.
 */
export function osHasAmbilightModeQuirk(osType: string | null): boolean {
  if (!osType) return false;
  if (osType.startsWith("MSAF_")) return true;
  if (osType === "Linux") return true;
  return false;
}

/**
 * On Android-XTV firmware (MSAF_*) authenticated endpoints only exist on
 * HTTPS/1926. HTTP/1925 serves /system unauthenticated and returns 404 for
 * anything else. So when HTTPS/1926 dies (Restlet "CPU consumption bug"
 * force-closes connections until the FD pool is exhausted) we must NOT
 * silently fall back to HTTP/1925 — that just turns 20s timeouts into 404s.
 * Better to surface a clear error so the user knows to power-cycle the TV.
 */
export function osRequiresHttpsForAuthenticatedEndpoints(osType: string | null): boolean {
  if (!osType) return false;
  return osType.startsWith("MSAF_");
}

/**
 * How often the state poller should run a full HTTPS poll cycle.
 *
 * Polling acts as a sync fallback for state changes notifyChange might miss
 * (we've seen ambilight changes not come through notify on MSAF). Default
 * is 10s for any firmware we don't have specific knowledge about. On MSAF
 * we slow it down to 60s — the Restlet HTTPS server tolerates load poorly
 * (see docs/development/restlet-quirks.md), so we minimise the call rate
 * while keeping a sync safety net.
 */
export function osPollIntervalMs(osType: string | null): number {
  // TODO: revisit. Keeping 10s everywhere temporarily while we debug
  // notifyChange reliability. Once notify is proven sufficient we can
  // lengthen the MSAF interval (60s tested stable previously).
  if (osType?.startsWith("MSAF_")) return 10_000;
  return 10_000;
}

/**
 * The os_type field lives in two places depending on TV generation -
 * Android puts it at the root; Saphi nests it under
 * featuring.systemfeatures. Return whichever is present.
 */
export function extractOsType(system: SystemInfo): string | null {
  if (system.os_type) return system.os_type;
  const nested = system.featuring?.systemfeatures?.os_type;
  return nested ?? null;
}

/**
 * `system.notifyChange === "http"` is the announce-feature mechanism
 * Philips uses to advertise that the TV serves a long-poll endpoint.
 * On older / non-Android TVs it's missing, and we shouldn't waste
 * resources retrying a notifyChange loop that always 404s.
 */
export function extractNotifyChangeSupport(system: SystemInfo): boolean {
  return system.notifyChange === "http";
}

export function extractPairingType(system: SystemInfo): string | null {
  const value = system.featuring?.systemfeatures?.pairing_type;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function extractSystemMetadata(system: SystemInfo): SystemMetadata {
  return {
    osType: extractOsType(system),
    notifyChangeSupported: extractNotifyChangeSupport(system),
    pairingType: extractPairingType(system),
  };
}

export function extractSecuredTransport(system: SystemInfo): boolean {
  const value = system.featuring?.systemfeatures?.secured_transport;
  return value === true || value === "true";
}

export interface TransportConfig {
  apiVersion: number;
  secured: boolean;
  port: number;
}

export function extractTransportConfig(system: SystemInfo): TransportConfig {
  const apiVersion = system.api_version?.Major ?? 1;
  const secured = extractSecuredTransport(system);
  const port = apiVersion < 6 ? 1925 : 1926;
  return { apiVersion, secured, port };
}
