"use strict";

import Homey from "homey";
import * as wol from "wol";

import { JointspaceApi } from "./jointspace-api";
import { StatePoller, StateChangeListener, StateChangeSource } from "./state-poller";
import { AmbilightConfigurations, ambilightModeFromConfiguration, AmbilightModeKey } from "./enums";
import { extractSystemMetadata, osHasAmbilightModeQuirk } from "./quirks";
import {
  AmbiHueState,
  AmbilightConfiguration,
  Application,
  ApplicationIntent,
  AudioData,
  CurrentActivity,
  JointspaceConfig,
  JointspaceCredentials,
  PowerState,
} from "./types";

const CAPABILITY_DEBOUNCE_MS = 100;
const INIT_OFF_FALLBACK_MS = 3_000;
const WOL_RETRY_DELAY_MS = 1_000;
const DEFAULT_VOLUME_MAX = 60;

interface DeviceData {
  id: string;
  mac?: string | null;
  credentials?: Partial<JointspaceCredentials>;
}

interface DeviceSettings {
  ipAddress: string;
  apiVersion: number;
  secure?: boolean;
  port?: number;
  volumeMax?: number;
  volumeMin?: number;
}

interface SimplifiedApplication {
  id: string;
  name: string;
  intent: ApplicationIntent;
}

interface PhilipsTvDriverLike {
  triggerApplicationOpenedTrigger(device: Homey.Device, args: { app: string }): Promise<unknown>;
  triggerAmbiHueChangedTrigger(device: Homey.Device, args: { enabled: boolean }): Promise<unknown>;
  triggerAmbilightChangedTrigger(device: Homey.Device, args: { enabled: boolean }): Promise<unknown>;
  triggerAmbilightModeChangedTrigger(device: Homey.Device, args: { mode: string }): Promise<unknown>;
}

const KEY_CAPABILITY_TO_TV_KEY: Record<string, string> = {
  key_stop: "Stop",
  key_play: "Play",
  key_pause: "Pause",
  key_play_pause: "PlayPause",
  key_online: "Online",
  key_record: "Record",
  key_rewind: "Rewind",
  key_fast_forward: "FastForward",
  key_toggle_ambilight: "AmbilightOnOff",
  key_source: "Source",
  key_toggle_subtitles: "Subtitle",
  key_teletext: "Teletext",
  key_viewmode: "Viewmode",
  key_watch_tv: "WatchTV",
  key_confirm: "Confirm",
  key_previous: "Previous",
  key_next: "Next",
  key_adjust: "Adjust",
  key_cursor_left: "CursorLeft",
  key_cursor_up: "CursorUp",
  key_cursor_right: "CursorRight",
  key_cursor_down: "CursorDown",
  key_info: "Info",
  key_digit_0: "Digit0",
  key_digit_1: "Digit1",
  key_digit_2: "Digit2",
  key_digit_3: "Digit3",
  key_digit_4: "Digit4",
  key_digit_5: "Digit5",
  key_digit_6: "Digit6",
  key_digit_7: "Digit7",
  key_digit_8: "Digit8",
  key_digit_9: "Digit9",
  key_dot: "Dot",
  key_options: "Options",
  key_back: "Back",
  key_home: "Home",
  key_find: "Find",
  key_red: "RedColour",
  key_green: "GreenColour",
  key_yellow: "YellowColour",
  key_blue: "BlueColour",
  // channel_up/down were declared in driver.compose but never wired up
  channel_up: "ChannelStepUp",
  channel_down: "ChannelStepDown",
};

const NEW_CAPABILITIES = ["current_application"] as const;
const REMOVED_CAPABILITIES = ["speaker_playing"] as const;

const STORE_OS_TYPE = "osType";
const STORE_NOTIFY_CHANGE_SUPPORTED = "notifyChangeSupported";
const STORE_LAST_AMBILIGHT_MODE = "lastSetAmbilightMode";

class PhilipsTvDevice extends Homey.Device implements StateChangeListener {
  private api!: JointspaceApi;
  private poller?: StatePoller;
  private applications: SimplifiedApplication[] | null = null;
  private deviceData!: DeviceData;
  private deviceSettings!: DeviceSettings;
  private initOffFallback?: NodeJS.Timeout;

  async onInit(): Promise<void> {
    this.deviceData = this.getData() as DeviceData;
    this.deviceSettings = this.getSettings() as DeviceSettings;
    this.applications = null;

    await this.migrateCapabilities();

    this.api = new JointspaceApi(this.buildApiConfig(), {
      log: (...args) => this.log(`[api]`, ...args),
    });

    this.registerCapabilityListeners();
    await this.setVolumeSliderBounds();

    // If we don't hear from the TV within INIT_OFF_FALLBACK_MS, assume it's
    // off. Cleared by the first powerstate notification.
    this.initOffFallback = setTimeout(() => {
      this.setCapabilityValue("onoff", false).catch(this.error.bind(this));
    }, INIT_OFF_FALLBACK_MS);

    const notifyChangeSupported = (this.getStoreValue(STORE_NOTIFY_CHANGE_SUPPORTED) as boolean | null) ?? true;
    this.poller = new StatePoller(
      this.api,
      this,
      (...args) => this.log(`[poller]`, ...args),
      { notifyChangeSupported },
    );
    void this.refreshSystemMetadata();
    this.poller.start();
    this.log("Initialised");
  }

  async onDeleted(): Promise<void> {
    this.poller?.stop();
    if (this.initOffFallback) clearTimeout(this.initOffFallback);
  }

  async onSettings({
    newSettings,
    changedKeys,
  }: {
    newSettings: Record<string, unknown>;
    oldSettings: Record<string, unknown>;
    changedKeys: string[];
  }): Promise<void> {
    this.deviceSettings = newSettings as unknown as DeviceSettings;
    if (changedKeys.includes("volumeMax") || changedKeys.includes("volumeMin")) {
      await this.setVolumeSliderBounds();
    }
    if (changedKeys.some((k) => k === "ipAddress" || k === "port" || k === "secure" || k === "apiVersion")) {
      this.api.updateConfig(this.buildApiConfig());
    }
  }

  // --- public surface used by app.ts flow listeners ----------------------

  getJointspaceClient(): JointspaceApi {
    return this.api;
  }

  async getApplications(): Promise<SimplifiedApplication[]> {
    if (this.applications) return this.applications;
    try {
      const raw = await this.api.getApplications();
      this.applications = raw.map((app: Application) => ({
        id: app.id,
        name: app.label,
        intent: app.intent,
      }));
      return this.applications;
    } catch (err) {
      this.error("getApplications failed", err);
      throw err;
    }
  }

  async openApplication(app: SimplifiedApplication): Promise<void> {
    try {
      await this.api.launchActivity(app.intent);
    } catch (err) {
      this.error(`openApplication(${app.name}) failed`, err);
      throw err;
    }
    await this.driverApi()
      .triggerApplicationOpenedTrigger(this, { app: app.name })
      .catch(this.error.bind(this));
  }

  async sendGoogleAssistantSearch(query: string): Promise<void> {
    const intent: ApplicationIntent = {
      extras: { query },
      action: "Intent {  act=android.intent.action.ASSIST cmp=com.google.android.katniss/com.google.android.apps.tvsearch.app.launch.trampoline.SearchActivityTrampoline flg=0x10200000 }",
      component: {
        packageName: "com.google.android.katniss",
        className: "com.google.android.apps.tvsearch.app.launch.trampoline.SearchActivityTrampoline",
      },
    };
    try {
      await this.api.launchActivity(intent);
    } catch (err) {
      this.error("sendGoogleAssistantSearch failed", err);
      throw err;
    }
  }

  async setAmbiHue(state: boolean): Promise<void> {
    try {
      await this.api.setAmbiHue(state);
    } catch (err) {
      this.error(`setAmbiHue(${state}) failed`, err);
      throw err;
    }
    await this.driverApi()
      .triggerAmbiHueChangedTrigger(this, { enabled: state })
      .catch(this.error.bind(this));
  }

  async setAmbilight(state: boolean): Promise<void> {
    try {
      await this.api.setAmbilight(state);
      await this.driverApi()
        .triggerAmbilightChangedTrigger(this, { enabled: state })
        .catch(this.error.bind(this));
    } catch (err) {
      this.log("setAmbilight failed", err);
      throw err;
    }
  }

  async setAmbilightMode(mode: string): Promise<void> {
    const configuration = AmbilightConfigurations[mode as AmbilightModeKey];
    if (!configuration) {
      this.log("Unknown ambilight mode requested:", mode);
      return;
    }
    try {
      await this.api.setAmbilightConfiguration(configuration);
      await this.setStoreValue(STORE_LAST_AMBILIGHT_MODE, mode).catch(this.error.bind(this));
      await this.driverApi()
        .triggerAmbilightModeChangedTrigger(this, { mode })
        .catch(this.error.bind(this));
    } catch (err) {
      this.log("setAmbilightMode failed", err);
    }
  }

  // --- StateChangeListener implementation --------------------------------

  handlePowerStateChange(source: StateChangeSource, state: PowerState): void {
    if (this.initOffFallback) {
      clearTimeout(this.initOffFallback);
      this.initOffFallback = undefined;
    }
    const on = state.powerstate === "On";
    if (this.getCapabilityValue("onoff") !== on) {
      this.log(`Power state -> ${on} (${source})`);
      this.setCapabilityValue("onoff", on).catch(this.error.bind(this));
    }
  }

  handleAudioChange(source: StateChangeSource, state: AudioData): void {
    const muted = state.muted === true;
    const currentVolume = this.getCapabilityValue("volume_set") as number | null;
    const powerOn = this.getCapabilityValue("onoff") as boolean | null;

    if (this.getCapabilityValue("volume_mute") !== muted) {
      this.log(`Mute -> ${muted} (${source})`);
      this.setCapabilityValue("volume_mute", muted).catch(this.error.bind(this));
    }

    // When muted, the TV reports volume 0. We need the pre-mute level to
    // restore it on unmute, so skip volume updates while muted. We also skip
    // updates when the TV is off — speaker switches (TV / audio system)
    // change the reported volume independently.
    if (!muted && powerOn && currentVolume !== state.current) {
      this.log(`Volume ${currentVolume} -> ${state.current} (${source})`);
      this.setCapabilityValue("volume_set", state.current).catch(this.error.bind(this));
    }
  }

  handleAmbiHueChange(source: StateChangeSource, state: AmbiHueState): void {
    const enabled = state.power === "On";
    if (this.getCapabilityValue("ambihue_onoff") !== enabled) {
      this.log(`AmbiHue -> ${enabled} (${source})`);
      this.setCapabilityValue("ambihue_onoff", enabled).catch(this.error.bind(this));
      void this.driverApi()
        .triggerAmbiHueChangedTrigger(this, { enabled })
        .catch(this.error.bind(this));
    }
  }

  handleAmbilightChange(source: StateChangeSource, state: AmbilightConfiguration): void {
    const enabled = state.styleName !== "OFF";
    const currentEnabled = this.getCapabilityValue("ambilight_onoff") as boolean | null;
    if (currentEnabled !== enabled) {
      this.log(`Ambilight -> ${enabled} (${source})`);
      this.setCapabilityValue("ambilight_onoff", enabled).catch(this.error.bind(this));
      void this.driverApi()
        .triggerAmbilightChangedTrigger(this, { enabled })
        .catch(this.error.bind(this));
    }

    const reportedMode = ambilightModeFromConfiguration(state);
    const newMode = this.applyAmbilightModeQuirk(reportedMode);
    const currentMode = this.getCapabilityValue("ambilight_mode") as string | null;
    if (newMode && newMode !== currentMode) {
      this.log(`Ambilight mode ${currentMode ?? "?"} -> ${newMode} (${source})`);
      this.setCapabilityValue("ambilight_mode", newMode).catch(this.error.bind(this));
      void this.driverApi()
        .triggerAmbilightModeChangedTrigger(this, { mode: newMode })
        .catch(this.error.bind(this));
    }
  }

  /**
   * On MSAF/Linux firmware the TV doesn't echo back the new mode after a set,
   * so the reported mode lags behind reality. If we have a locally cached
   * "last set" mode and we know this TV has the quirk, prefer the local value.
   * The cache is cleared the next time the user changes mode or when the TV
   * reports the same mode the user set (firmware caught up).
   */
  private applyAmbilightModeQuirk(reportedMode: AmbilightModeKey | undefined): AmbilightModeKey | undefined {
    const osType = this.getStoreValue(STORE_OS_TYPE) as string | null;
    if (!osHasAmbilightModeQuirk(osType)) return reportedMode;
    const cached = this.getStoreValue(STORE_LAST_AMBILIGHT_MODE) as AmbilightModeKey | null;
    if (!cached) return reportedMode;
    if (reportedMode === cached) {
      // Firmware caught up; clear the cache so we trust TV reports again.
      void this.setStoreValue(STORE_LAST_AMBILIGHT_MODE, null).catch(this.error.bind(this));
      return reportedMode;
    }
    return cached;
  }

  handleActivityChange(source: StateChangeSource, state: CurrentActivity): void {
    void this.getApplications()
      .then((apps) => {
        const current = apps.find(
          (a) =>
            a.intent.component.packageName === state.component.packageName &&
            a.intent.component.className === state.component.className,
        );
        const currentName = (this.getCapabilityValue("current_application") as string | null) ?? null;
        if (current) {
          if (currentName !== current.name) {
            this.log(`App ${currentName ?? "?"} -> ${current.name} (${source})`);
            this.setCapabilityValue("current_application", current.name).catch(this.error.bind(this));
            void this.driverApi()
              .triggerApplicationOpenedTrigger(this, { app: current.name })
              .catch(this.error.bind(this));
          }
        } else if (currentName !== null) {
          this.log(`App ${currentName} -> unknown (${source})`);
          this.setCapabilityValue("current_application", null).catch(this.error.bind(this));
          void this.driverApi()
            .triggerApplicationOpenedTrigger(this, { app: "" })
            .catch(this.error.bind(this));
        }
      })
      .catch(this.error.bind(this));
  }

  onPollFailure(error: Error): void {
    if (this.getCapabilityValue("onoff")) {
      this.log("Poll failed; marking TV off:", error.message);
      this.setCapabilityValue("onoff", false).catch(this.error.bind(this));
    }
  }

  // --- internals --------------------------------------------------------

  private buildApiConfig(): JointspaceConfig {
    const credentials =
      this.deviceData.credentials?.user && this.deviceData.credentials?.pass
        ? { user: this.deviceData.credentials.user, pass: this.deviceData.credentials.pass }
        : undefined;
    const apiVersion = Number(this.deviceSettings.apiVersion) || 1;
    return {
      host: this.deviceSettings.ipAddress,
      apiVersion,
      secured: this.deviceSettings.secure ?? false,
      port: this.deviceSettings.port ?? JointspaceApi.portForApiVersion(apiVersion),
      credentials,
    };
  }

  private driverApi(): PhilipsTvDriverLike {
    return this.driver as unknown as PhilipsTvDriverLike;
  }

  /**
   * Best-effort probe to refresh osType / notifyChange-support cache. Runs
   * in the background at every onInit — if the TV is unreachable we just
   * keep using whatever was cached during the last successful pair/probe.
   */
  private async refreshSystemMetadata(): Promise<void> {
    try {
      const system = await this.api.getSystem();
      const { osType, notifyChangeSupported } = extractSystemMetadata(system);
      await this.setStoreValue(STORE_OS_TYPE, osType);
      await this.setStoreValue(STORE_NOTIFY_CHANGE_SUPPORTED, notifyChangeSupported);
    } catch (err) {
      this.log("refreshSystemMetadata failed (TV likely offline):", (err as Error).message);
    }
  }

  private async migrateCapabilities(): Promise<void> {
    for (const capability of NEW_CAPABILITIES) {
      if (!this.hasCapability(capability)) {
        await this.addCapability(capability).catch((err: Error) =>
          this.error(`Failed to add capability ${capability}:`, err),
        );
      }
    }
    for (const capability of REMOVED_CAPABILITIES) {
      if (this.hasCapability(capability)) {
        await this.removeCapability(capability).catch((err: Error) =>
          this.error(`Failed to remove capability ${capability}:`, err),
        );
      }
    }
  }

  private registerCapabilityListeners(): void {
    this.registerMultipleCapabilityListener(
      Object.keys(KEY_CAPABILITY_TO_TV_KEY),
      async (capabilityValues: Record<string, unknown>) => {
        const [capability] = Object.keys(capabilityValues);
        const tvKey = KEY_CAPABILITY_TO_TV_KEY[capability];
        if (!tvKey) return;
        await this.sendKey(tvKey);
      },
      CAPABILITY_DEBOUNCE_MS,
    );

    this.registerCapabilityListener("onoff", (value: boolean) => this.onCapabilityOnOffSet(value));
    this.registerCapabilityListener("ambilight_mode", (value: string) => this.setAmbilightMode(value));
    this.registerCapabilityListener("ambilight_onoff", (value: boolean) => this.setAmbilight(value));
    this.registerCapabilityListener("ambihue_onoff", (value: boolean) => this.onCapabilityAmbiHueOnOffSet(value));
    this.registerCapabilityListener("speaker_next", () => this.sendKey("Next"));
    this.registerCapabilityListener("speaker_prev", () => this.sendKey("Previous"));
    this.registerCapabilityListener("volume_up", () => this.sendKey("VolumeUp"));
    this.registerCapabilityListener("volume_down", () => this.sendKey("VolumeDown"));
    this.registerCapabilityListener("volume_mute", async (value: boolean) => {
      const fallback = Math.round(this.getVolumeMax() / 2);
      const currentVolume = (this.getCapabilityValue("volume_set") as number | null) ?? fallback;
      try {
        await this.api.setVolume(currentVolume, value);
      } catch (err) {
        this.error(`volume_mute(${value}) failed`, err);
        throw err;
      }
    });
    this.registerCapabilityListener("volume_set", (value: number) => {
      const clamped = Math.min(Math.max(Math.round(value), 0), this.getVolumeMax());
      return this.setVolume(clamped);
    });
  }

  private async setVolumeSliderBounds(): Promise<void> {
    await this.setCapabilityOptions("volume_set", {
      min: this.deviceSettings.volumeMin ?? 0,
      max: this.getVolumeMax(),
      step: 1,
    });
  }

  private getVolumeMax(): number {
    const raw = Number(this.deviceSettings.volumeMax);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VOLUME_MAX;
  }

  private async onCapabilityOnOffSet(value: boolean): Promise<void> {
    this.log(`Powering ${value ? "on" : "off"}`);
    if (value && this.deviceData.mac) {
      const mac = this.deviceData.mac;
      wol.wake(mac).catch((err: Error) => this.log("WOL failed:", err.message));
      // Second magic packet in case the first dropped on the wire.
      setTimeout(() => {
        wol.wake(mac).catch((err: Error) => this.log("WOL retry failed:", err.message));
      }, WOL_RETRY_DELAY_MS);
    }
    try {
      await this.api.setPowerState(value);
      this.log(`Successfully sent power ${value ? "on" : "off"}`);
    } catch (err) {
      this.log("setPowerState failed", err);
    }
  }

  private async onCapabilityAmbiHueOnOffSet(value: boolean): Promise<void> {
    // Some firmwares expect the AmbiHue toggle as a menu setting update
    // rather than the HueLamp/power endpoint. Keep the legacy menu-item
    // path that was used before — POST to HueLamp/power doesn't actuate
    // on every model.
    try {
      await this.api.setSetting({
        values: [
          {
            value: {
              Nodeid: 2131230774,
              Controllable: "true",
              Available: "true",
              data: { value: value ? "true" : "false" },
            },
          },
        ],
      });
    } catch (err) {
      this.error(`ambihue_onoff(${value}) failed`, err);
      throw err;
    }
  }

  private async sendKey(key: string): Promise<void> {
    try {
      await this.api.sendKey(key);
    } catch (err) {
      this.error(`sendKey(${key}) failed:`, err);
    }
  }

  private async setVolume(volume: number, mute = false): Promise<void> {
    try {
      await this.api.setVolume(volume, mute);
    } catch (err) {
      this.error(`setVolume(${volume}) failed:`, err);
    }
  }
}

module.exports = PhilipsTvDevice;
