import { JointspaceApi, LogFn } from "./jointspace-api";
import {
  AmbiHueState,
  AmbilightConfiguration,
  AudioData,
  CurrentActivity,
  CurrentSource,
  NotifyChangeState,
  PowerState,
  ScreenState,
} from "./types";
import { OfflineError, ProtocolError } from "./errors";

export type StateChangeSource = "notify" | "poll";

export interface StateChangeListener {
  handlePowerStateChange(source: StateChangeSource, state: PowerState): void;
  handleAudioChange(source: StateChangeSource, state: AudioData): void;
  handleAmbiHueChange(source: StateChangeSource, state: AmbiHueState): void;
  handleAmbilightChange(source: StateChangeSource, state: AmbilightConfiguration): void;
  handleActivityChange(source: StateChangeSource, state: CurrentActivity): void;
  handleScreenStateChange(source: StateChangeSource, state: ScreenState): void;
  handleCurrentSourceChange(source: StateChangeSource, state: CurrentSource): void;
  onPollFailure(error: Error): void;
  onPollSuccess?(): void;
  // Optional hook called whenever notifyChange succeeds. Use it to assert
  // device availability — without it the device can sit on idle notify
  // long-polls between poll cycles with no signal back to Homey.
  onNotifyReachable?(): void;
  // Gate for runtime-optional capabilities: state-poller skips polling
  // endpoints whose corresponding capability isn't currently on the device
  // (probe-driven, see device.ts:applyCurrentSourceCapability). Return true
  // for capabilities not in the gate set (default-enabled).
  isCapabilityPresent?(capabilityId: string): boolean;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const POLL_REQUEST_SPACING_MS = 1_000;
const NOTIFY_RETRY_BACKOFF_MS = 60_000;

interface NotifyHandler {
  (source: StateChangeSource, value: unknown): void;
}

export interface StatePollerOptions {
  notifyChangeSupported: boolean;
  // Interval between full poll cycles. Default 10s. Set higher on
  // firmwares where HTTPS load needs to stay low — polling still runs as
  // a sync fallback for state notifyChange may miss, just less often.
  pollIntervalMs?: number;
}

export interface TimerHost {
  setTimeout(callback: () => void, ms: number): NodeJS.Timeout;
  clearTimeout(timer: NodeJS.Timeout): void;
}

export class StatePoller {
  private readonly notifyHandlers: Record<string, NotifyHandler>;
  private pollTimer?: NodeJS.Timeout;
  private notifyTimer?: NodeJS.Timeout;
  private lastState: NotifyChangeState = {};
  private stopped = false;
  private readonly notifyChangeSupported: boolean;
  private readonly pollIntervalMs: number;
  private offlineLogged = false;

  constructor(
    private readonly api: JointspaceApi,
    private readonly listener: StateChangeListener,
    private readonly log: LogFn,
    private readonly timers: TimerHost,
    options: StatePollerOptions = { notifyChangeSupported: true },
  ) {
    this.notifyChangeSupported = options.notifyChangeSupported;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.notifyHandlers = {
      "powerstate": (s, v) => this.listener.handlePowerStateChange(s, v as PowerState),
      "audio/volume": (s, v) => this.listener.handleAudioChange(s, v as AudioData),
      "activities/current": (s, v) => this.listener.handleActivityChange(s, v as CurrentActivity),
      "huelamp/power": (s, v) => this.listener.handleAmbiHueChange(s, v as AmbiHueState),
      "ambilight/currentconfiguration": (s, v) => this.listener.handleAmbilightChange(s, v as AmbilightConfiguration),
      "screenstate": (s, v) => this.listener.handleScreenStateChange(s, v as ScreenState),
      "sources/current": (s, v) => this.listener.handleCurrentSourceChange(s, v as CurrentSource),
    };
  }

  start(): void {
    this.stopped = false;
    if (this.notifyChangeSupported) {
      void this.runNotifyLoop();
    } else {
      this.log("notifyChange not supported on this TV; relying on poll only");
    }
    this.log(`polling every ${this.pollIntervalMs}ms`);
    // Run the first poll immediately so we have authoritative state before
    // waiting on notifyChange to deliver it (which we've seen drop events).
    void this.pollOnce().finally(() => this.scheduleNextPoll(this.pollIntervalMs));
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) this.timers.clearTimeout(this.pollTimer);
    if (this.notifyTimer) this.timers.clearTimeout(this.notifyTimer);
  }

  private async runNotifyLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const state = await this.api.notifyChange(this.lastState);
        this.noteReachable();
        if (state) {
          this.lastState = state;
          this.parseNotifyState(state);
        }
      } catch (err) {
        if (err instanceof ProtocolError) {
          // TV closed the lingering connection - that's normal, loop again.
          continue;
        }
        if (err instanceof OfflineError) {
          this.noteUnreachable(err);
          await this.delay(NOTIFY_RETRY_BACKOFF_MS);
          continue;
        }
        // Unexpected error - log with detail, back off and retry.
        this.log("notifyChange failed", err);
        await this.delay(NOTIFY_RETRY_BACKOFF_MS);
      }
    }
  }

  private noteUnreachable(err: Error): void {
    if (this.offlineLogged) return;
    this.offlineLogged = true;
    this.log(`TV unreachable, polling continues in background: ${err.message}`);
  }

  private noteReachable(): void {
    this.listener.onNotifyReachable?.();
    if (!this.offlineLogged) return;
    this.offlineLogged = false;
    this.log("TV reachable again");
  }

  private parseNotifyState(state: NotifyChangeState): void {
    const allKeys = Object.keys(state);
    const handled: string[] = [];
    const unhandled: string[] = [];
    for (const key of allKeys) {
      if (state[key] === undefined || state[key] === null) continue;
      if (this.notifyHandlers[key]) {
        handled.push(key);
      } else {
        unhandled.push(key);
      }
    }
    this.log(`notifyChange returned: handled=[${handled.join(",")}] unhandled=[${unhandled.join(",")}]`);
    // Per-key value dump — lets us see *what* the TV is reporting, not just
    // that something was reported. Critical for diagnosing missing-update
    // bugs (e.g. ambilight changes that never come through notify).
    for (const path of handled) {
      this.log(`  notify[${path}] = ${this.summarise(state[path])}`);
    }
    for (const path of unhandled) {
      this.log(`  notify[${path}] (unhandled) = ${this.summarise(state[path])}`);
    }
    for (const path of handled) {
      this.notifyHandlers[path]("notify", state[path]);
    }
  }

  private summarise(value: unknown): string {
    try {
      const json = JSON.stringify(value);
      return json.length > 200 ? `${json.slice(0, 200)}…` : json;
    } catch {
      return String(value);
    }
  }

  private scheduleNextPoll(delayMs: number): void {
    if (this.stopped) return;
    this.pollTimer = this.timers.setTimeout(() => {
      void this.pollOnce().finally(() => this.scheduleNextPoll(this.pollIntervalMs));
    }, delayMs);
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped) return;

    const steps: Array<{ name: string; run: () => Promise<unknown>; apply: (value: unknown) => void; gateCapability?: string }> = [
      { name: "audio/volume",                   run: () => this.api.getAudioData(),     apply: (v) => this.listener.handleAudioChange("poll", v as AudioData) },
      { name: "HueLamp/power",                  run: () => this.api.getAmbiHue(),       apply: (v) => this.listener.handleAmbiHueChange("poll", v as AmbiHueState) },
      { name: "ambilight/currentconfiguration", run: () => this.api.getAmbilight(),     apply: (v) => this.listener.handleAmbilightChange("poll", v as AmbilightConfiguration) },
      { name: "powerstate",                     run: () => this.api.getPowerState(),    apply: (v) => this.listener.handlePowerStateChange("poll", v as PowerState) },
      { name: "sources/current",                run: () => this.api.getCurrentSource(), apply: (v) => this.listener.handleCurrentSourceChange("poll", v as CurrentSource), gateCapability: "current_source" },
    ];

    let anySucceeded = false;
    let transportError: Error | undefined;

    for (let i = 0; i < steps.length; i++) {
      if (this.stopped) return;
      const step = steps[i];
      if (step.gateCapability && this.listener.isCapabilityPresent?.(step.gateCapability) === false) {
        // Capability isn't on this device (probe said unsupported). Skip
        // the API call entirely — no useful state can land here.
        continue;
      }
      try {
        const value = await step.run();
        this.log(`  poll[${step.name}] = ${this.summarise(value)}`);
        step.apply(value);
        anySucceeded = true;
      } catch (err) {
        if (err instanceof OfflineError) {
          // Connectivity error — bail; no point hammering an unreachable TV.
          transportError = err;
          break;
        }
        // NotFoundError / parse error / etc.: endpoint isn't available on
        // this firmware. Skip and continue with the remaining steps.
        this.log(`  poll[${step.name}] skipped: ${(err as Error).message}`);
      }
      if (i < steps.length - 1) await this.delay(POLL_REQUEST_SPACING_MS);
    }

    if (anySucceeded) {
      this.noteReachable();
      this.listener.onPollSuccess?.();
    }
    if (transportError) {
      this.noteUnreachable(transportError);
      this.listener.onPollFailure(transportError);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.notifyTimer = this.timers.setTimeout(() => resolve(), ms);
    });
  }
}
