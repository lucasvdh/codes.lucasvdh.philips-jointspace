"use strict";

import Homey from "homey";
import * as wol from "wol";

import { JointspaceApi } from "./jointspace-api";
import { StatePoller, StateChangeListener, StateChangeSource } from "./state-poller";
import { AmbilightConfigurations, ambilightModeFromConfiguration, AmbilightModeKey } from "./enums";
import { extractSystemMetadata, extractTransportConfig, osHasAmbilightModeQuirk, osPollIntervalMs, osRequiresHttpsForAuthenticatedEndpoints } from "./quirks";
import {
  AmbiHueState,
  AmbilightConfiguration,
  Application,
  ApplicationIntent,
  AudioData,
  CurrentActivity,
  CurrentSource,
  JointspaceConfig,
  JointspaceCredentials,
  PowerState,
  ScreenState,
} from "./types";
import { NotFoundError } from "./errors";

const CAPABILITY_DEBOUNCE_MS = 100;
const INIT_OFF_FALLBACK_MS = 3_000;
const WOL_RETRY_DELAY_MS = 1_000;
const DEFAULT_VOLUME_MAX = 60;
const SYSTEM_REPROBE_INTERVAL_MS = 60 * 60 * 1000;

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

interface SimplifiedChannel {
  id: string;
  name: string;
  ccid: number | string;
  preset?: string;
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
const STORE_PAIRING_TYPE = "pairingType";
const STORE_LAST_AMBILIGHT_MODE = "lastSetAmbilightMode";
const STORE_SCREEN_STATE_SUPPORTED = "screenStateSupported";
const STORE_CURRENT_SOURCE_SUPPORTED = "currentSourceSupported";
const STORE_CREDENTIALS = "credentials";

const CAPABILITY_SCREEN_ON = "screen_on";
const CAPABILITY_CURRENT_SOURCE = "current_source";

class PhilipsTvDevice extends Homey.Device implements StateChangeListener {
  private api!: JointspaceApi;
  private poller?: StatePoller;
  private applications: SimplifiedApplication[] | null = null;
  private channels: SimplifiedChannel[] | null = null;
  private channelListId: string = "alltv";
  private deviceData!: DeviceData;
  private deviceSettings!: DeviceSettings;
  private initOffFallback?: NodeJS.Timeout;
  private systemReprobeTimer?: NodeJS.Timeout;
  private wolRetryTimer?: NodeJS.Timeout;
  private consecutivePollFailures = 0;
  private failureTriggeredRefresh = false;
  private screenOnListenerRegistered = false;

  async onInit(): Promise<void> {
    this.deviceData = this.getData() as DeviceData;
    this.deviceSettings = this.getSettings() as DeviceSettings;
    this.applications = null;

    await this.migrateCapabilities();
    await this.migrateCredentialsToStore();

    this.api = new JointspaceApi(this.buildApiConfig(), {
      log: (...args) => this.log(`[api]`, ...args),
    });

    this.registerCapabilityListeners();
    await this.applyScreenStateCapability();
    await this.applyCurrentSourceCapability();
    await this.setVolumeSliderBounds();

    // If we don't hear from the TV within INIT_OFF_FALLBACK_MS, assume it's
    // off. Cleared by the first powerstate notification.
    this.initOffFallback = this.homey.setTimeout(() => {
      this.setCapabilityValue("onoff", false).catch(this.error.bind(this));
    }, INIT_OFF_FALLBACK_MS);

    // Wait for the transport-verify to complete before constructing the
    // poller — refreshSystemMetadata writes osType to store, which decides
    // whether the poller runs in notify-only mode (MSAF) or full polling.
    // Without this, notifyChange returns fast, triggers handleActivityChange,
    // which fires getApplications on HTTPS/1926 in parallel with the verify
    // probe. On TVs with flaky HTTPS that second concurrent connection hangs
    // until the axios timeout. Capped at 8s so a fully offline TV doesn't
    // block startup either.
    await Promise.race([
      this.refreshSystemMetadata(),
      new Promise<void>((resolve) => this.homey.setTimeout(resolve, 8000)),
    ]);

    // Re-apply optional capabilities now that refreshSystemMetadata has had
    // a chance to write fresh probe results. The earlier calls (before the
    // race) catch existing devices on the stale flag; this second pass
    // covers freshly-paired devices whose flag was null at first apply.
    // Both calls are idempotent.
    await this.applyScreenStateCapability();
    await this.applyCurrentSourceCapability();

    const notifyChangeSupported = (this.getStoreValue(STORE_NOTIFY_CHANGE_SUPPORTED) as boolean | null) ?? true;
    const osType = this.getStoreValue(STORE_OS_TYPE) as string | null;
    const pollIntervalMs = osPollIntervalMs(osType);
    this.poller = new StatePoller(
      this.api,
      this,
      (...args) => this.log(`[poller]`, ...args),
      this.homey,
      { notifyChangeSupported, pollIntervalMs },
    );

    this.scheduleSystemReprobe();
    this.poller.start();
    this.log("Initialised");
  }

  async onDeleted(): Promise<void> {
    this.teardown();
  }

  async onUninit(): Promise<void> {
    this.teardown();
  }

  private teardown(): void {
    this.poller?.stop();
    if (this.initOffFallback) this.homey.clearTimeout(this.initOffFallback);
    if (this.systemReprobeTimer) this.homey.clearTimeout(this.systemReprobeTimer);
    if (this.wolRetryTimer) this.homey.clearTimeout(this.wolRetryTimer);
    this.initOffFallback = undefined;
    this.systemReprobeTimer = undefined;
    this.wolRetryTimer = undefined;
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
      // Settings just changed (likely from a Repair, or a manual edit).
      // Re-run the transport verify against the new target so we self-correct
      // if the advertised transport turns out to be flaky on this TV.
      // Without this, a wrong transport sits broken until the hourly probe.
      void this.refreshSystemMetadata();
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

  /**
   * Source-select with dual strategy: try the proper /sources/current
   * endpoint first (legacy TVs honour this), fall back to a Google
   * Assistant search by name for Android TVs where /sources is not
   * exposed.
   *
   * `label` comes from the action dropdown ("HDMI 1", "HDMI 2", ...).
   * We derive the legacy source ID by lowercasing and stripping spaces:
   * "HDMI 1" -> "hdmi1".
   */
  async selectSource(label: string): Promise<void> {
    const sourceId = label.toLowerCase().replace(/\s+/g, "");
    try {
      await this.api.setSource(sourceId);
      this.log(`Switched source to ${label} via /sources/current`);
      return;
    } catch (err) {
      this.log(`/sources/current failed for ${label}, falling back to GA search:`, (err as Error).message);
    }
    await this.sendGoogleAssistantSearch(label);
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

  async getChannels(): Promise<SimplifiedChannel[]> {
    if (this.channels) return this.channels;
    try {
      const apiVersion = Number(this.deviceSettings.apiVersion) || 1;
      if (apiVersion >= 5) {
        await this.discoverPreferredChannelListId();
        const list = await this.api.getChannelList(this.channelListId);
        this.channels = (list.Channel ?? []).map((c) => ({
          id: String(c.ccid),
          name: c.name ?? c.preset ?? `Channel ${c.ccid}`,
          ccid: c.ccid,
          preset: c.preset,
        }));
      } else {
        const legacy = await this.api.getLegacyChannels();
        this.channels = Object.entries(legacy).map(([id, entry]) => ({
          id,
          name: entry.name ?? entry.preset ?? `Channel ${id}`,
          ccid: id,
          preset: entry.preset,
        }));
      }
      return this.channels;
    } catch (err) {
      this.error("getChannels failed", err);
      throw err;
    }
  }

  async setChannel(channel: SimplifiedChannel): Promise<void> {
    try {
      await this.api.setChannel(channel.ccid, this.channelListId);
    } catch (err) {
      this.error(`setChannel(${channel.name}) failed`, err);
      throw err;
    }
  }

  /**
   * v6+ TVs expose multiple channel lists (alltv, allsat, allcable). Pick
   * the first one advertised under channelLists so the autocomplete and
   * setChannel use the same list.
   */
  private async discoverPreferredChannelListId(): Promise<void> {
    try {
      const db = await this.api.getChannelLists();
      const first = db.channelLists?.[0]?.id;
      if (first) this.channelListId = first;
    } catch (err) {
      this.log("Could not enumerate channel lists, defaulting to 'alltv':", (err as Error).message);
    }
  }

  // --- StateChangeListener implementation --------------------------------

  handlePowerStateChange(source: StateChangeSource, state: PowerState): void {
    if (this.initOffFallback) {
      this.homey.clearTimeout(this.initOffFallback);
      this.initOffFallback = undefined;
    }
    const on = state.powerstate === "On";
    const wasOn = this.getCapabilityValue("onoff") as boolean | null;
    if (wasOn !== on) {
      this.log(`Power state -> ${on} (${source})`);
      this.setCapabilityValue("onoff", on).catch(this.error.bind(this));
      // When the TV turns off, the previously-running app is no longer
      // active - reset the capability so flows checking "current app is X"
      // don't misfire on a stale value.
      if (!on && this.getCapabilityValue("current_application") !== null) {
        this.setCapabilityValue("current_application", null).catch(this.error.bind(this));
      }
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
    // updates when the TV is *known* off — speaker switches (TV / audio
    // system) change the reported volume independently. powerOn === null
    // means "not yet observed" (first poll before notify lands), so we
    // accept the update there instead of dropping it.
    if (!muted && powerOn !== false && currentVolume !== state.current) {
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

  handleScreenStateChange(source: StateChangeSource, state: ScreenState): void {
    if (!this.hasCapability(CAPABILITY_SCREEN_ON)) return;
    const on = state.screenstate === "screenOn";
    if (this.getCapabilityValue(CAPABILITY_SCREEN_ON) !== on) {
      this.log(`Screen state -> ${on ? "on" : "off"} (${source})`);
      this.setCapabilityValue(CAPABILITY_SCREEN_ON, on).catch(this.error.bind(this));
    }
  }

  handleCurrentSourceChange(source: StateChangeSource, state: CurrentSource): void {
    if (!this.hasCapability("current_source")) return;
    const id = state?.id ?? null;
    const previous = this.getCapabilityValue("current_source") as string | null;
    if (previous === id) return;
    this.log(`Source ${previous ?? "?"} -> ${id ?? "unknown"} (${source})`);
    this.setCapabilityValue("current_source", id).catch(this.error.bind(this));
  }

  onPollFailure(error: Error): void {
    this.consecutivePollFailures += 1;
    if (this.getCapabilityValue("onoff")) {
      this.log("Poll failed; marking TV off:", error.message);
      this.setCapabilityValue("onoff", false).catch(this.error.bind(this));
    }
    // After 3 consecutive failures, mark the device unavailable in Homey
    // so the UI shows a clear "TV unreachable" state. Without this, Homey's
    // own heuristic may silently mark the device unavailable based on
    // capability-update timing — confusing because we don't know why.
    if (this.consecutivePollFailures === 3) {
      this.log("3 consecutive poll failures; setting device unavailable");
      this.setUnavailable(`TV unreachable: ${error.message}`).catch(this.error.bind(this));
    }
    // If polls keep failing while we think the advertised transport is fine,
    // the TV's HTTPS service may have died mid-session. Trigger one
    // refreshSystemMetadata so verifyAdvertisedTransport can flip us back to
    // HTTP/1925 quickly instead of waiting for the hourly probe. Gate this
    // with a flag so we only fire once per failure run.
    if (this.consecutivePollFailures === 5 && !this.failureTriggeredRefresh) {
      this.failureTriggeredRefresh = true;
      this.log(`${this.consecutivePollFailures} consecutive poll failures; re-verifying transport`);
      void this.refreshSystemMetadata();
    }
  }

  onPollSuccess(): void {
    if (this.consecutivePollFailures > 0) {
      this.log(`Poll recovered after ${this.consecutivePollFailures} failure(s)`);
      this.consecutivePollFailures = 0;
      this.failureTriggeredRefresh = false;
    }
    // Reaffirm availability on every successful poll. Cheap to call when
    // already available; restores availability if Homey's own heuristic
    // marked the device unavailable (e.g. after a notifyChange ProtocolError
    // long-hang that Homey treats as a disconnect signal).
    this.setAvailable().catch(this.error.bind(this));
  }

  onNotifyReachable(): void {
    // Notify long-poll succeeded — TV is responding on HTTP/1925. Reaffirm
    // availability so a slow poll interval (60s on MSAF) doesn't leave
    // Homey thinking the device is gone between polls.
    this.setAvailable().catch(this.error.bind(this));
  }

  isCapabilityPresent(capabilityId: string): boolean {
    return this.hasCapability(capabilityId);
  }

  // --- internals --------------------------------------------------------

  private buildApiConfig(): JointspaceConfig {
    const credentials = this.readCredentials();
    const apiVersion = Number(this.deviceSettings.apiVersion) || 1;
    return {
      host: this.deviceSettings.ipAddress,
      apiVersion,
      secured: this.deviceSettings.secure ?? false,
      port: this.deviceSettings.port ?? JointspaceApi.portForApiVersion(apiVersion),
      credentials,
    };
  }

  /**
   * Prefer credentials from store (writable, can be replaced via Repair).
   * Fall back to data (immutable, set at pair time) for devices that
   * haven't been through the data→store migration yet.
   */
  private readCredentials(): JointspaceCredentials | undefined {
    const stored = this.getStoreValue(STORE_CREDENTIALS) as Partial<JointspaceCredentials> | null;
    if (stored?.user && stored?.pass) return { user: stored.user, pass: stored.pass };
    const fromData = this.deviceData.credentials;
    if (fromData?.user && fromData?.pass) return { user: fromData.user, pass: fromData.pass };
    return undefined;
  }

  /**
   * One-time migration: copy credentials from immutable data into the
   * mutable store, so the Repair flow can replace them later.
   */
  /**
   * Mirror of driver.ts verifyAdvertisedTransport: when the TV advertises
   * secured_transport=true, confirm HTTPS/1926 actually answers. If it
   * doesn't, downgrade settings to HTTP/1925 so all subsequent authenticated
   * calls go to the working transport. Without this, devices on TVs whose
   * HTTPS is dead (e.g. only one network interface serves it) keep timing
   * out on every poll cycle even though HTTP/1925 works fine.
   *
   * Fast-path: if getSystem just succeeded via HTTPS we don't probe again —
   * a second concurrent HTTPS request to a fragile TV often hangs even
   * when the first one worked.
   *
   * MSAF exception: on Android-XTV firmware HTTP/1925 only serves /system
   * (everything else 404s), so falling back there is worse than useless.
   * Keep the broken HTTPS setting; subsequent calls will fail with a
   * connection-timed-out error which at least matches reality and prompts
   * the user to power-cycle the TV.
   */
  private async verifyAdvertisedTransport(
    transport: { apiVersion: number; secured: boolean; port: number },
    osType: string | null,
  ): Promise<{ apiVersion: number; secured: boolean; port: number }> {
    if (!transport.secured) return transport;
    const lastSystemTransport = this.api.getLastSystemTransport();
    if (lastSystemTransport?.protocol === "https" && lastSystemTransport.port === transport.port) {
      return transport;
    }
    if (await this.api.verifyHttpsResponds()) return transport;
    if (osRequiresHttpsForAuthenticatedEndpoints(osType)) {
      this.log(`HTTPS/${transport.port} doesn't respond and osType=${osType} only serves authenticated endpoints over HTTPS; keeping current transport so failures surface clearly instead of as misleading 404s.`);
      return transport;
    }
    this.log(`HTTPS/${transport.port} doesn't respond despite advertised secured_transport=true; falling back to HTTP/1925`);
    return { apiVersion: transport.apiVersion, secured: false, port: 1925 };
  }

  private async migrateCredentialsToStore(): Promise<void> {
    if (this.getStoreValue(STORE_CREDENTIALS)) return;
    const dc = this.deviceData.credentials;
    if (!dc?.user || !dc?.pass) return;
    try {
      await this.setStoreValue(STORE_CREDENTIALS, { user: dc.user, pass: dc.pass });
    } catch (err) {
      this.error("Failed to migrate credentials to store:", err);
    }
  }

  private driverApi(): PhilipsTvDriverLike {
    return this.driver as unknown as PhilipsTvDriverLike;
  }

  /**
   * Best-effort probe to refresh cached system state. Runs at every onInit
   * and once an hour after that. Updates two layers:
   *   - store: osType + notifyChange-support flag (used by quirks + poller)
   *   - settings: apiVersion / secured / port (so firmware updates that
   *     change endpoints are picked up without a re-pair)
   * If the TV is unreachable we keep using whatever was cached during the
   * last successful pair/probe.
   */
  private async refreshSystemMetadata(): Promise<void> {
    try {
      const system = await this.api.getSystem();
      const { osType, notifyChangeSupported, pairingType } = extractSystemMetadata(system);
      await this.setStoreValue(STORE_OS_TYPE, osType);
      await this.setStoreValue(STORE_NOTIFY_CHANGE_SUPPORTED, notifyChangeSupported);
      await this.setStoreValue(STORE_PAIRING_TYPE, pairingType);

      await this.probeScreenStateSupport();
      await this.probeCurrentSourceSupport();

      const advertised = extractTransportConfig(system);
      const transport = await this.verifyAdvertisedTransport(advertised, osType);
      const settingsUpdate: Partial<DeviceSettings> = {};
      if (transport.apiVersion !== this.deviceSettings.apiVersion) settingsUpdate.apiVersion = transport.apiVersion;
      if (transport.secured !== this.deviceSettings.secure) settingsUpdate.secure = transport.secured;
      if (transport.port !== this.deviceSettings.port) settingsUpdate.port = transport.port;
      if (Object.keys(settingsUpdate).length > 0) {
        this.log("Transport changed, updating settings:", settingsUpdate);
        await this.setSettings(settingsUpdate);
        this.deviceSettings = { ...this.deviceSettings, ...settingsUpdate };
        this.api.updateConfig(this.buildApiConfig());
      }
    } catch (err) {
      this.log("refreshSystemMetadata failed (TV likely offline):", (err as Error).message);
    }
  }

  private scheduleSystemReprobe(): void {
    this.systemReprobeTimer = this.homey.setTimeout(() => {
      void this.refreshSystemMetadata()
        .then(() => this.applyScreenStateCapability())
        .then(() => this.applyCurrentSourceCapability())
        .finally(() => this.scheduleSystemReprobe());
    }, SYSTEM_REPROBE_INTERVAL_MS);
  }

  /**
   * Probes GET /screenstate to decide whether this TV exposes the
   * screen-only-off mode. Only writes the store flag; the capability
   * itself is added/removed by applyScreenStateCapability(). Called from
   * refreshSystemMetadata so the result lands alongside osType /
   * notifyChange support.
   */
  private async probeScreenStateSupport(): Promise<void> {
    // Always probe — we don't have an official endpoints-per-firmware matrix,
    // and a firmware update could add the endpoint later. A failure here is
    // cheap (single HTTPS call, ~10s timeout worst case) and recorded so
    // the hourly reprobe doesn't waste effort.
    try {
      const state = await this.api.getScreenState();
      const supported = typeof state?.screenstate === "string" && state.screenstate.length > 0;
      await this.setStoreValue(STORE_SCREEN_STATE_SUPPORTED, supported);
      if (supported && this.hasCapability(CAPABILITY_SCREEN_ON)) {
        const on = state.screenstate === "screenOn";
        if (this.getCapabilityValue(CAPABILITY_SCREEN_ON) !== on) {
          await this.setCapabilityValue(CAPABILITY_SCREEN_ON, on);
        }
      }
    } catch {
      // 404 / 503 here is the normal "screen state not supported" signal.
      // Stay silent; hourly probe would otherwise spam logs.
      await this.setStoreValue(STORE_SCREEN_STATE_SUPPORTED, false);
    }
  }

  /**
   * Add or remove the screen_on capability based on the cached probe
   * result, and ensure the listener is registered while the capability
   * is present. Capability listeners are per-instance and don't survive
   * an app restart, so we must register once per onInit. The flag guards
   * against double-registration when this is also called from the hourly
   * probe.
   */
  private async applyScreenStateCapability(): Promise<void> {
    const supported = (this.getStoreValue(STORE_SCREEN_STATE_SUPPORTED) as boolean | null) ?? false;
    const present = this.hasCapability(CAPABILITY_SCREEN_ON);
    if (supported && !present) {
      await this.addCapability(CAPABILITY_SCREEN_ON).catch((err: Error) =>
        this.error(`addCapability(${CAPABILITY_SCREEN_ON}) failed:`, err),
      );
    } else if (!supported && present) {
      await this.removeCapability(CAPABILITY_SCREEN_ON).catch((err: Error) =>
        this.error(`removeCapability(${CAPABILITY_SCREEN_ON}) failed:`, err),
      );
      this.screenOnListenerRegistered = false;
      return;
    }
    if (this.hasCapability(CAPABILITY_SCREEN_ON) && !this.screenOnListenerRegistered) {
      this.registerCapabilityListener(CAPABILITY_SCREEN_ON, (value: boolean) =>
        this.onCapabilityScreenOnSet(value),
      );
      this.screenOnListenerRegistered = true;
    }
  }

  private async onCapabilityScreenOnSet(value: boolean): Promise<void> {
    try {
      await this.api.setScreenState(value ? "screenOn" : "screenOff");
    } catch (err) {
      this.error(`setScreenState(${value}) failed`, err);
      throw err;
    }
  }

  /**
   * Mirror of probeScreenStateSupport for /sources/current. Some firmwares
   * (notably MSAF_*) 404 on this endpoint — no point adding a capability the
   * TV can never fill. The probe runs at every refreshSystemMetadata so a
   * firmware update that adds the endpoint is picked up within the hourly
   * reprobe window.
   */
  private async probeCurrentSourceSupport(): Promise<void> {
    try {
      const value = await this.api.getCurrentSource();
      const supported = typeof value?.id === "string" && value.id.length > 0;
      await this.setStoreValue(STORE_CURRENT_SOURCE_SUPPORTED, supported);
    } catch (err) {
      // 404 = endpoint genuinely not on this firmware — record as
      // unsupported. Any other error (offline, parse error, timeout) is
      // transient or unrelated; keep the previous flag so we don't tear
      // down a working capability because the TV happened to be off.
      if (err instanceof NotFoundError) {
        await this.setStoreValue(STORE_CURRENT_SOURCE_SUPPORTED, false);
      }
    }
  }

  /**
   * Add or remove the current_source capability based on the cached probe
   * result. No listener (read-only state capability) so simpler than
   * applyScreenStateCapability.
   */
  private async applyCurrentSourceCapability(): Promise<void> {
    const supported = (this.getStoreValue(STORE_CURRENT_SOURCE_SUPPORTED) as boolean | null) ?? false;
    const present = this.hasCapability(CAPABILITY_CURRENT_SOURCE);
    if (supported && !present) {
      await this.addCapability(CAPABILITY_CURRENT_SOURCE).catch((err: Error) =>
        this.error(`addCapability(${CAPABILITY_CURRENT_SOURCE}) failed:`, err),
      );
    } else if (!supported && present) {
      await this.removeCapability(CAPABILITY_CURRENT_SOURCE).catch((err: Error) =>
        this.error(`removeCapability(${CAPABILITY_CURRENT_SOURCE}) failed:`, err),
      );
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
      if (this.wolRetryTimer) this.homey.clearTimeout(this.wolRetryTimer);
      this.wolRetryTimer = this.homey.setTimeout(() => {
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
    // path that was used before - POST to HueLamp/power doesn't actuate
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
