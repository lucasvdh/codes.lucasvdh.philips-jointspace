import * as crypto from "crypto";

import { JOINTSPACE_SHARED_KEY } from "./shared-key";
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
 * silently fall back to HTTP/1925 - that just turns 20s timeouts into 404s.
 * Better to surface a clear error so the user knows to power-cycle the TV.
 */
export function osRequiresHttpsForAuthenticatedEndpoints(osType: string | null): boolean {
  if (!osType) return false;
  return osType.startsWith("MSAF_");
}

// Saphi ("Linux") has no Google Assistant (#69). Older Android firmwares may not report os_type.
export function osSupportsGoogleAssistant(osType: string | null): boolean {
  return osType !== "Linux";
}

/**
 * How often the state poller should run a full HTTPS poll cycle.
 *
 * Polling acts as a sync fallback for state changes notifyChange might miss
 * (we've seen ambilight changes not come through notify on MSAF). Default
 * is 10s for any firmware we don't have specific knowledge about. On MSAF
 * we slow it down to 60s - the Restlet HTTPS server tolerates load poorly
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

/**
 * Optional capabilities and whether /system's jsonfeatures says the TV has the
 * feature behind them. null when the TV doesn't report jsonfeatures at all.
 */
export function featureCapabilities(system: SystemInfo): Record<string, boolean | null> {
  const features = system.featuring?.jsonfeatures;
  const has = (list: string[] | undefined, item?: string): boolean | null => {
    if (!features) return null;
    if (!Array.isArray(list)) return false;
    return item ? list.includes(item) : list.length > 0;
  };
  const ambilight = has(features?.ambilight, "Ambilight");
  return {
    ambilight_onoff: ambilight,
    ambilight_mode: ambilight,
    key_toggle_ambilight: ambilight,
    ambihue_onoff: has(features?.ambilight, "Hue"),
    key_record: has(features?.recordings),
    current_application: has(features?.applications),
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

// The port follows the transport, not the API version: secured API-5 TVs serve HTTPS on 1926 (#63).
export function extractTransportConfig(system: SystemInfo): TransportConfig {
  const apiVersion = system.api_version?.Major ?? 1;
  const secured = extractSecuredTransport(system);
  const port = secured ? 1926 : 1925;
  return { apiVersion, secured, port };
}

/**
 * Build the canonical, immutable identifier used as Homey's `data.id`.
 * Preference order is most-stable first: hardware serial, then the UUID
 * embedded in the SSDP USN, then the mDNS service name. IP is a last
 * resort because DHCP leases rotate.
 *
 * The prefixes (`serial-`, `uuid-`, `mdns-`, `ip-`) keep schemes from
 * colliding when one TV is reachable via multiple fallbacks.
 */
export function extractCanonicalId(
  system: SystemInfo,
  fallback: { usn?: string; mdnsName?: string; ip: string },
): string {
  if (system.serialnumber) return `serial-${system.serialnumber}`;
  // Some firmwares pick a random IV per response, so only the plaintext is stable.
  const serial = decryptSystemField(system.serialnumber_encrypted);
  if (serial) return `serial-${serial}`;
  const deviceId = decryptSystemField(system.deviceid_encrypted);
  if (deviceId) return `deviceid-${deviceId}`;
  if (fallback.usn) {
    const fromUsn = legacyUsnToCanonicalId(fallback.usn);
    if (fromUsn) return fromUsn;
  }
  if (fallback.mdnsName) return `mdns-${fallback.mdnsName}`;
  return `ip-${fallback.ip}`;
}

/** Decrypts a `*_encrypted` /system field: AES-128-CBC, IV in the first 16 bytes. */
export function decryptSystemField(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value.trim(), "base64");
    if (raw.length < 32 || raw.length % 16 !== 0) return null;
    const decipher = crypto.createDecipheriv("aes-128-cbc", JOINTSPACE_SHARED_KEY.subarray(0, 16), raw.subarray(0, 16));
    const plain = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]).toString("utf8").trim();
    return plain && /^[\x20-\x7e]+$/.test(plain) ? plain : null;
  } catch {
    return null;
  }
}

/**
 * Every id a stored `data.id` or canonical id may also be known by. Ids from
 * before 3.8.4 hold the ciphertext (`enc-serial-`, `enc-device-`) or an SSDP USN.
 */
export function canonicalIdAliases(id: string): string[] {
  const aliases = [id];
  const fromUsn = legacyUsnToCanonicalId(id);
  if (fromUsn) aliases.push(fromUsn);
  if (id.startsWith("enc-serial-")) {
    const serial = decryptSystemField(id.slice("enc-serial-".length));
    if (serial) aliases.push(`serial-${serial}`);
  }
  if (id.startsWith("enc-device-")) {
    const deviceId = decryptSystemField(id.slice("enc-device-".length));
    if (deviceId) aliases.push(`deviceid-${deviceId}`);
  }
  return aliases;
}

/** Whether a stored canonical id should be recomputed: ciphertext ids aren't stable on every TV. */
export function isUnstableCanonicalId(id: string): boolean {
  return id.startsWith("enc-serial-") || id.startsWith("enc-device-");
}

/**
 * Extract the uuid-form canonical id from a legacy SSDP-USN-shaped
 * `data.id` (e.g. `uuid:1c-aa-bb::urn:schemas-upnp-org:device:MediaRenderer:3`).
 * Returns null if the input isn't a USN. Used during pairing to dedupe a
 * freshly probed candidate against already-paired devices whose data.id
 * predates the canonical-id scheme.
 */
export function legacyUsnToCanonicalId(usn: string): string | null {
  const m = usn.match(/uuid:([0-9a-f-]+)/i);
  return m ? `uuid-${m[1]}` : null;
}
