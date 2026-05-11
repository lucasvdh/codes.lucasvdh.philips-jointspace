import type { SystemInfo } from "./types";

export interface SystemMetadata {
  osType: string | null;
  notifyChangeSupported: boolean;
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
 * The os_type field lives in two places depending on TV generation —
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

export function extractSystemMetadata(system: SystemInfo): SystemMetadata {
  return {
    osType: extractOsType(system),
    notifyChangeSupported: extractNotifyChangeSupport(system),
  };
}
