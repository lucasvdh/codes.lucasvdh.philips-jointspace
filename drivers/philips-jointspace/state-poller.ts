import { setTimeout as sleep } from "timers/promises";

import { JointspaceApi, LogFn } from "./jointspace-api";
import {
  AmbiHueState,
  AmbilightConfiguration,
  AudioData,
  CurrentActivity,
  NotifyChangeState,
  PowerState,
} from "./types";
import { OfflineError, ProtocolError } from "./errors";

export type StateChangeSource = "notify" | "poll";

export interface StateChangeListener {
  handlePowerStateChange(source: StateChangeSource, state: PowerState): void;
  handleAudioChange(source: StateChangeSource, state: AudioData): void;
  handleAmbiHueChange(source: StateChangeSource, state: AmbiHueState): void;
  handleAmbilightChange(source: StateChangeSource, state: AmbilightConfiguration): void;
  handleActivityChange(source: StateChangeSource, state: CurrentActivity): void;
  onPollFailure(error: Error): void;
}

const POLL_INTERVAL_MS = 10_000;
const POLL_REQUEST_SPACING_MS = 1_000;
const NOTIFY_RETRY_BACKOFF_MS = 60_000;

interface NotifyHandler {
  (source: StateChangeSource, value: unknown): void;
}

export interface StatePollerOptions {
  notifyChangeSupported: boolean;
}

export class StatePoller {
  private readonly notifyHandlers: Record<string, NotifyHandler>;
  private pollTimer?: NodeJS.Timeout;
  private notifyTimer?: NodeJS.Timeout;
  private lastState: NotifyChangeState = {};
  private stopped = false;
  private readonly notifyChangeSupported: boolean;
  private offlineLogged = false;

  constructor(
    private readonly api: JointspaceApi,
    private readonly listener: StateChangeListener,
    private readonly log: LogFn,
    options: StatePollerOptions = { notifyChangeSupported: true },
  ) {
    this.notifyChangeSupported = options.notifyChangeSupported;
    this.notifyHandlers = {
      "powerstate": (s, v) => this.listener.handlePowerStateChange(s, v as PowerState),
      "audio/volume": (s, v) => this.listener.handleAudioChange(s, v as AudioData),
      "activities/current": (s, v) => this.listener.handleActivityChange(s, v as CurrentActivity),
      "huelamp/power": (s, v) => this.listener.handleAmbiHueChange(s, v as AmbiHueState),
      "ambilight/currentconfiguration": (s, v) => this.listener.handleAmbilightChange(s, v as AmbilightConfiguration),
    };
  }

  start(): void {
    this.stopped = false;
    if (this.notifyChangeSupported) {
      void this.runNotifyLoop();
    } else {
      this.log("notifyChange not supported on this TV; relying on poll only");
    }
    this.scheduleNextPoll(POLL_INTERVAL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
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
          // TV closed the lingering connection — that's normal, loop again.
          continue;
        }
        if (err instanceof OfflineError) {
          this.noteUnreachable(err);
          await this.delay(NOTIFY_RETRY_BACKOFF_MS);
          continue;
        }
        // Unexpected error — log with detail, back off and retry.
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
    if (!this.offlineLogged) return;
    this.offlineLogged = false;
    this.log("TV reachable again");
  }

  private parseNotifyState(state: NotifyChangeState): void {
    for (const [path, handler] of Object.entries(this.notifyHandlers)) {
      const value = state[path];
      if (value !== undefined && value !== null) {
        handler("notify", value);
      }
    }
  }

  private scheduleNextPoll(delayMs: number): void {
    if (this.stopped) return;
    this.pollTimer = setTimeout(() => {
      void this.pollOnce().finally(() => this.scheduleNextPoll(POLL_INTERVAL_MS));
    }, delayMs);
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped) return;
    try {
      const audio = await this.api.getAudioData();
      this.listener.handleAudioChange("poll", audio);
      await sleep(POLL_REQUEST_SPACING_MS);

      const ambiHue = await this.api.getAmbiHue();
      this.listener.handleAmbiHueChange("poll", ambiHue);
      await sleep(POLL_REQUEST_SPACING_MS);

      const ambilight = await this.api.getAmbilight();
      this.listener.handleAmbilightChange("poll", ambilight);
      await sleep(POLL_REQUEST_SPACING_MS);

      const power = await this.api.getPowerState();
      this.listener.handlePowerStateChange("poll", power);
      this.noteReachable();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error instanceof OfflineError) this.noteUnreachable(error);
      this.listener.onPollFailure(error);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.notifyTimer = setTimeout(() => resolve(), ms);
    });
  }
}
