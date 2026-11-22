import { test, mock } from "node:test";
import assert from "node:assert/strict";

import { StatePoller, StateChangeListener, TimerHost } from "../drivers/philips-jointspace/state-poller";
import type { JointspaceApi } from "../drivers/philips-jointspace/jointspace-api";
import type { MenuCurrentResponse } from "../drivers/philips-jointspace/menu";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Runs short waits (request spacing) right away and keeps long ones (poll interval, back-off) for inspection. */
function fakeTimers() {
  const waits: number[] = [];
  const host: TimerHost = {
    setTimeout(callback: () => void, ms: number) {
      waits.push(ms);
      if (ms <= 1_000) setImmediate(callback);
      return {} as NodeJS.Timeout;
    },
    clearTimeout() {},
  };
  return { host, waits };
}

function listener(overrides: Partial<StateChangeListener> = {}): StateChangeListener {
  const noop = () => undefined;
  return {
    handlePowerStateChange: noop,
    handleAudioChange: noop,
    handleAmbiHueChange: noop,
    handleAmbilightChange: noop,
    handleActivityChange: noop,
    handleScreenStateChange: noop,
    handleCurrentSourceChange: noop,
    onPollFailure: noop,
    ...overrides,
  };
}

function api(overrides: Record<string, unknown>): JointspaceApi {
  const ok = async () => ({});
  return {
    getAudioData: ok,
    getAmbiHue: ok,
    getAmbilight: ok,
    getPowerState: ok,
    getCurrentSource: ok,
    getMenuCurrent: ok,
    notifyChange: async () => null,
    ...overrides,
  } as unknown as JointspaceApi;
}

test("an idle long-poll that the TV closes starts the next one right away", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const { host, waits } = fakeTimers();
  const logs: string[] = [];
  let calls = 0;
  let poller!: StatePoller;
  const tv = api({
    notifyChange: async () => {
      calls++;
      if (calls === 1) t.mock.timers.tick(61_000);
      else poller.stop();
      return null;
    },
  });
  poller = new StatePoller(tv, listener(), (...a) => logs.push(a.join(" ")), host, { notifyChangeSupported: true, debug: true });
  poller.start();
  await flush();
  await flush();

  assert.equal(calls, 2);
  assert.ok(!waits.includes(60_000), "no back-off after an idle reset");
  assert.ok(logs.some((l) => l.includes("no changes, TV ended the long-poll after 61s")));
});

test("a reset within 10s backs off for a minute instead of spinning", async (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  const { host, waits } = fakeTimers();
  const logs: string[] = [];
  let calls = 0;
  let poller!: StatePoller;
  const tv = api({
    notifyChange: async () => {
      calls++;
      if (calls > 1) poller.stop();
      return null;
    },
  });
  poller = new StatePoller(tv, listener(), (...a) => logs.push(a.join(" ")), host, { notifyChangeSupported: true });
  poller.start();
  await flush();
  await flush();

  assert.equal(calls, 1, "waits instead of polling again");
  assert.ok(waits.includes(60_000));
  assert.ok(logs.some((l) => l.includes("closed the connection after 0s without answering; retrying in 60s")));
  poller.stop();
});

test("the poll reads the settings menu only for the nodes the device asks for", async () => {
  const { host } = fakeTimers();
  const asked: number[][] = [];
  const received: MenuCurrentResponse[] = [];
  const response: MenuCurrentResponse = { values: [{ value: { Nodeid: 2131230838, data: { selected_item: 5 } } }] };
  const tv = api({
    getMenuCurrent: async (nodes: number[]) => {
      asked.push(nodes);
      return response;
    },
  });
  const poller = new StatePoller(
    tv,
    listener({ menuNodesToPoll: () => [2131230838, 2131230762], handleMenuValues: (_s, v) => received.push(v) }),
    () => undefined,
    host,
    { notifyChangeSupported: false },
  );
  poller.start();
  for (let i = 0; i < 20 && received.length === 0; i++) await flush();
  poller.stop();

  assert.deepEqual(asked, [[2131230838, 2131230762]]);
  assert.deepEqual(received, [response]);
});

test("the poll skips the settings menu when the device has no menu capabilities", async () => {
  const { host } = fakeTimers();
  let menuReads = 0;
  let pollDone = false;
  const tv = api({
    getMenuCurrent: async () => { menuReads++; return {}; },
    getCurrentSource: async () => { pollDone = true; return {}; },
  });
  const poller = new StatePoller(tv, listener({ menuNodesToPoll: () => [] }), () => undefined, host, {
    notifyChangeSupported: false,
  });
  poller.start();
  for (let i = 0; i < 20 && !pollDone; i++) await flush();
  await flush();
  poller.stop();

  assert.ok(pollDone);
  assert.equal(menuReads, 0);
});

test("capabilities that are gone are not polled", async () => {
  const { host } = fakeTimers();
  const polled: string[] = [];
  let pollDone = false;
  const track = (name: string) => async () => { polled.push(name); return {}; };
  const tv = api({
    getAudioData: track("audio"),
    getAmbiHue: track("ambihue"),
    getAmbilight: track("ambilight"),
    getPowerState: track("power"),
    getCurrentSource: async () => { pollDone = true; return {}; },
  });
  const present = new Set(["current_source"]);
  const poller = new StatePoller(tv, listener({ isCapabilityPresent: (id) => present.has(id) }), () => undefined, host, {
    notifyChangeSupported: false,
  });
  poller.start();
  for (let i = 0; i < 20 && !pollDone; i++) await flush();
  poller.stop();

  assert.deepEqual(polled, ["audio", "power"]);
});
