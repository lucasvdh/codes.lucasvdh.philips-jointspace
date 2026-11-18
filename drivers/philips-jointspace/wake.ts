import * as dgram from "node:dgram";
import * as os from "node:os";

import type { NetworkDevice } from "./types";

const MAC_PATTERN = /^([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})[:-]?([0-9a-f]{2})$/i;
const WOL_PORTS = [9, 7];

/** Returns "aa:bb:cc:dd:ee:ff", or null for anything that isn't a usable unicast MAC. */
export function normalizeMac(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(MAC_PATTERN);
  if (!match) return null;
  const mac = match.slice(1).join(":").toLowerCase();
  if (mac === "00:00:00:00:00:00" || mac === "ff:ff:ff:ff:ff:ff") return null;
  return mac;
}

export function createMagicPacket(mac: string): Buffer {
  const bytes = Buffer.from(mac.split(":").map((part) => parseInt(part, 16)));
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array<Buffer>(16).fill(bytes)]);
}

function ipToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

/**
 * Limited broadcast plus the directed broadcast of the local interface that
 * shares a subnet with the TV. Some TVs only react to the directed one, and
 * with both Ethernet and Wi-Fi up the limited broadcast may leave on the
 * wrong interface.
 */
export function broadcastAddresses(
  targetIp: string | undefined,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string[] {
  const addresses = new Set<string>(["255.255.255.255"]);
  const target = targetIp ? ipToInt(targetIp) : null;
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      const address = ipToInt(info.address);
      const netmask = ipToInt(info.netmask);
      if (address === null || netmask === null) continue;
      if (target !== null && (address & netmask) !== (target & netmask)) continue;
      addresses.add(intToIp(((address & netmask) | ~netmask) >>> 0));
    }
  }
  return [...addresses];
}

/** Sends a magic packet for every MAC to every broadcast address and WOL port. Never throws. */
export async function sendMagicPackets(
  macs: string[],
  targetIp: string | undefined,
  log: (...args: unknown[]) => void,
): Promise<void> {
  const addresses = broadcastAddresses(targetIp);
  let socket: dgram.Socket;
  try {
    socket = dgram.createSocket("udp4");
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(() => {
        socket.off("error", reject);
        socket.setBroadcast(true);
        resolve();
      });
    });
  } catch (err) {
    log("WOL socket failed:", (err as Error).message);
    return;
  }
  socket.on("error", (err) => log("WOL socket error:", err.message));

  const sends: Promise<void>[] = [];
  for (const mac of macs) {
    const packet = createMagicPacket(mac);
    for (const address of addresses) {
      for (const port of WOL_PORTS) {
        sends.push(
          new Promise<void>((resolve) => {
            socket.send(packet, port, address, (err) => {
              if (err) log(`WOL to ${address}:${port} failed:`, err.message);
              resolve();
            });
          }),
        );
      }
    }
  }
  await Promise.all(sends);
  socket.close();
  log(`WOL sent for ${macs.join(", ")} to ${addresses.join(", ")}`);
}

export interface WakeInfo {
  macs: string[];
  /** From network/devices: true if an interface has wake-on-lan enabled, null if unknown. */
  wakeOnLanEnabled: boolean | null;
}

const ARP_TIMEOUT_MS = 5_000;
const MAX_STORED_MACS = 4;

/** Call only while the TV answers: ARP needs it awake and network/devices is an API call. */
export async function resolveWakeInfo(
  getArpMac: () => Promise<unknown>,
  getNetworkDevices: () => Promise<NetworkDevice[]>,
  log: (...args: unknown[]) => void,
): Promise<WakeInfo> {
  const macs: string[] = [];
  let wakeOnLanEnabled: boolean | null = null;

  try {
    const arpMac = normalizeMac(await withTimeout(getArpMac(), ARP_TIMEOUT_MS, "ARP lookup"));
    if (arpMac) macs.push(arpMac);
  } catch (err) {
    log("ARP lookup failed:", (err as Error).message);
  }

  try {
    const devices = await getNetworkDevices();
    if (devices.length > 0) {
      const enabled = devices.filter((d) => d["wake-on-lan"] === "Enabled");
      wakeOnLanEnabled = enabled.length > 0;
      // With WOL disabled on every interface, packets still can't hurt.
      for (const device of enabled.length > 0 ? enabled : devices) {
        const mac = normalizeMac(device.mac);
        if (mac) macs.push(mac);
      }
    }
  } catch (err) {
    log("network/devices failed:", (err as Error).message);
  }

  return { macs: mergeMacs(macs, []), wakeOnLanEnabled };
}

/** Newest first, deduplicated, capped; keeps MACs of an interface the TV isn't using right now. */
export function mergeMacs(fresh: unknown[], previous: unknown[]): string[] {
  const out: string[] = [];
  for (const value of [...fresh, ...previous]) {
    const mac = normalizeMac(value);
    if (mac && !out.includes(mac)) out.push(mac);
  }
  return out.slice(0, MAX_STORED_MACS);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export type WakeOutcome = "already-reachable" | "woke" | "power-on-failed" | "no-answer" | "cancelled";

export interface WakeLoopDeps {
  /** Resolves the TV's powerstate, or null when it doesn't answer. */
  probe: () => Promise<string | null>;
  powerOn: () => Promise<void>;
  sendWake: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  isCancelled: () => boolean;
  attempts: number;
  intervalMs: number;
}

/** Repeats WOL until the API answers, then switches the TV on if it isn't already. */
export async function wakeUntilReachable(deps: WakeLoopDeps): Promise<{ outcome: WakeOutcome; attempt: number }> {
  for (let attempt = 1; attempt <= deps.attempts; attempt++) {
    if (deps.isCancelled()) return { outcome: "cancelled", attempt };
    const powerstate = await deps.probe();
    if (deps.isCancelled()) return { outcome: "cancelled", attempt };
    if (powerstate !== null) {
      if (powerstate !== "On") {
        try {
          await deps.powerOn();
        } catch {
          return { outcome: "power-on-failed", attempt };
        }
      }
      return { outcome: attempt === 1 ? "already-reachable" : "woke", attempt };
    }
    await deps.sendWake();
    await deps.sleep(deps.intervalMs);
  }
  return { outcome: "no-answer", attempt: deps.attempts };
}
