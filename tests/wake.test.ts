import { test } from "node:test";
import assert from "node:assert/strict";
import type { NetworkInterfaceInfo } from "node:os";

import {
  broadcastAddresses,
  createMagicPacket,
  mergeMacs,
  normalizeMac,
  resolveWakeInfo,
  wakeUntilReachable,
  WakeLoopDeps,
} from "../drivers/philips-jointspace/wake";

const noop = () => {};

test("normalizeMac accepts common notations and rejects junk", () => {
  assert.equal(normalizeMac("34:F1:50:D7:BF:6E"), "34:f1:50:d7:bf:6e");
  assert.equal(normalizeMac("34-f1-50-d7-bf-6e"), "34:f1:50:d7:bf:6e");
  assert.equal(normalizeMac("34f150d7bf6e"), "34:f1:50:d7:bf:6e");
  assert.equal(normalizeMac(" 34:f1:50:d7:bf:6e "), "34:f1:50:d7:bf:6e");
  assert.equal(normalizeMac(""), null);
  assert.equal(normalizeMac("00:00:00:00:00:00"), null);
  assert.equal(normalizeMac("ff:ff:ff:ff:ff:ff"), null);
  assert.equal(normalizeMac("(incomplete)"), null);
  assert.equal(normalizeMac(undefined), null);
});

test("magic packet is 6x 0xff followed by the MAC 16 times", () => {
  const packet = createMagicPacket("34:f1:50:d7:bf:6e");
  assert.equal(packet.length, 102);
  assert.deepEqual([...packet.subarray(0, 6)], Array(6).fill(0xff));
  for (let i = 0; i < 16; i++) {
    assert.deepEqual([...packet.subarray(6 + i * 6, 12 + i * 6)], [0x34, 0xf1, 0x50, 0xd7, 0xbf, 0x6e]);
  }
});

function iface(address: string, netmask: string, internal = false): NetworkInterfaceInfo {
  return { address, netmask, family: "IPv4", mac: "00:00:00:00:00:00", internal, cidr: null };
}

test("broadcastAddresses adds the directed broadcast of the interface on the TV's subnet", () => {
  const interfaces = {
    lo: [iface("127.0.0.1", "255.0.0.0", true)],
    eth0: [iface("192.168.1.10", "255.255.255.0")],
    wlan0: [iface("10.0.0.5", "255.255.0.0")],
  };
  assert.deepEqual(broadcastAddresses("192.168.1.201", interfaces), ["255.255.255.255", "192.168.1.255"]);
  assert.deepEqual(broadcastAddresses(undefined, interfaces), ["255.255.255.255", "192.168.1.255", "10.0.255.255"]);
  assert.deepEqual(broadcastAddresses("172.16.0.2", interfaces), ["255.255.255.255"]);
});

test("mergeMacs keeps newest first, dedupes, drops junk and caps the list", () => {
  assert.deepEqual(mergeMacs(["AA:BB:CC:DD:EE:01"], ["aa:bb:cc:dd:ee:02", "aa:bb:cc:dd:ee:01", null]), [
    "aa:bb:cc:dd:ee:01",
    "aa:bb:cc:dd:ee:02",
  ]);
  const many = ["01", "02", "03", "04", "05"].map((n) => `aa:bb:cc:dd:ee:${n}`);
  assert.equal(mergeMacs(many, []).length, 4);
});

test("resolveWakeInfo combines ARP with WOL-enabled interfaces from network/devices", async () => {
  const info = await resolveWakeInfo(
    async () => "34:F1:50:D7:BF:6E",
    async () => [
      { type: "Wifi", mac: "34:f1:50:d7:bf:6e", "wake-on-lan": "Enabled" },
      { type: "Ethernet", mac: "34:f1:50:d7:bf:6f", "wake-on-lan": "Disabled" },
    ],
    noop,
  );
  assert.deepEqual(info, { macs: ["34:f1:50:d7:bf:6e"], wakeOnLanEnabled: true });
});

test("resolveWakeInfo reports WOL disabled but still keeps the MACs", async () => {
  const info = await resolveWakeInfo(
    async () => "",
    async () => [{ type: "Ethernet", mac: "34:f1:50:d7:bf:6f", "wake-on-lan": "Disabled" }],
    noop,
  );
  assert.deepEqual(info, { macs: ["34:f1:50:d7:bf:6f"], wakeOnLanEnabled: false });
});

test("resolveWakeInfo survives failing ARP and API calls", async () => {
  const info = await resolveWakeInfo(
    async () => {
      throw new Error("ping failed");
    },
    async () => {
      throw new Error("HTTP 401");
    },
    noop,
  );
  assert.deepEqual(info, { macs: [], wakeOnLanEnabled: null });
});

function loop(answers: (string | null)[], overrides: Partial<WakeLoopDeps> = {}) {
  const calls: string[] = [];
  let i = 0;
  const deps: WakeLoopDeps = {
    probe: async () => {
      calls.push("probe");
      return answers[Math.min(i++, answers.length - 1)];
    },
    powerOn: async () => {
      calls.push("powerOn");
    },
    sendWake: async () => {
      calls.push("wake");
    },
    sleep: async () => {},
    isCancelled: () => false,
    attempts: 5,
    intervalMs: 0,
    ...overrides,
  };
  return { calls, run: () => wakeUntilReachable(deps) };
}

test("wake loop: TV already on needs nothing", async () => {
  const { calls, run } = loop(["On"]);
  assert.deepEqual(await run(), { outcome: "already-reachable", attempt: 1 });
  assert.deepEqual(calls, ["probe"]);
});

test("wake loop: TV in network standby only needs powerstate On", async () => {
  const { calls, run } = loop(["Standby"]);
  assert.deepEqual(await run(), { outcome: "already-reachable", attempt: 1 });
  assert.deepEqual(calls, ["probe", "powerOn"]);
});

test("wake loop: sends WOL until the TV answers, then powers it on", async () => {
  const { calls, run } = loop([null, null, "StandbyKeep"]);
  assert.deepEqual(await run(), { outcome: "woke", attempt: 3 });
  assert.deepEqual(calls, ["probe", "wake", "probe", "wake", "probe", "powerOn"]);
});

test("wake loop: gives up after the configured attempts", async () => {
  const { calls, run } = loop([null], { attempts: 3 });
  assert.deepEqual(await run(), { outcome: "no-answer", attempt: 3 });
  assert.equal(calls.filter((c) => c === "wake").length, 3);
});

test("wake loop: stops when a newer on/off command cancels it", async () => {
  let cancelled = false;
  const { calls, run } = loop([null], {
    sendWake: async () => {
      calls.push("wake");
      cancelled = true;
    },
    isCancelled: () => cancelled,
  });
  assert.deepEqual(await run(), { outcome: "cancelled", attempt: 2 });
  assert.deepEqual(calls, ["probe", "wake"]);
});

test("wake loop: reports a failing powerstate On", async () => {
  const { run } = loop(["Standby"], {
    powerOn: async () => {
      throw new Error("HTTP 500");
    },
  });
  assert.deepEqual(await run(), { outcome: "power-on-failed", attempt: 1 });
});
