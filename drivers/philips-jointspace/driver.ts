"use strict";

import Homey from "homey";

import { JointspaceApi } from "./jointspace-api";
import { PairingStatus } from "./enums";
import {
  ForbiddenError,
  HttpsUnavailableError,
  InvalidResponseError,
  NotFoundError,
  OfflineError,
  PairingError,
  ProtocolError,
  UnauthenticatedError,
} from "./errors";
import {
  JointspaceCredentials,
  PairDevice,
  PairingState,
} from "./types";
import { canonicalIdAliases, extractCanonicalId, extractPairingType } from "./quirks";
import {
  classifyPinError,
  describePairingError,
  existingCanonicalIds,
  isAlreadyPaired,
  PAIR_DEVICE_INFO,
  probeTransport,
  singleFlight,
} from "./pairing-logic";
import { activityLog, PAIRING_SCOPE } from "./activity-log";
import { resolveWakeInfo } from "./wake";

interface DiscoveryHint {
  usn?: string;
  mdnsName?: string;
}

interface DeviceDescriptor {
  name: string;
  // Only the identity: Homey hides already-paired devices by comparing data.
  data: { id: string };
  settings: {
    ipAddress: string;
    apiVersion: number;
    secure: boolean;
    port: number;
  };
  // Carried separately because it controls whether the user needs to PIN-pair,
  // independent of which transport (HTTP/HTTPS) the TV serves on.
  pairingType?: string;
  httpsUnavailable?: boolean;
  store: { wakeMacs: string[]; credentials?: JointspaceCredentials };
  // Ids this TV may already be paired under; data.id plus the USN form.
  aliases: string[];
}

interface PairContext {
  ip: string | null;
  candidates: DeviceDescriptor[];
  selected: DeviceDescriptor | null;
  pairingApi: JointspaceApi | null;
  pairingState: PairingState | null;
  // Repair may rediscover the device it repairs; dedup must not hide it.
  repairing: Homey.Device | null;
}

class PhilipsTvDriver extends Homey.Driver {
  private applicationOpenedTrigger!: Homey.FlowCardTriggerDevice;
  private specificApplicationOpenedTrigger!: Homey.FlowCardTriggerDevice;
  private ambiHueChangedTrigger!: Homey.FlowCardTriggerDevice;
  private ambilightChangedTrigger!: Homey.FlowCardTriggerDevice;
  private ambilightModeChangedTrigger!: Homey.FlowCardTriggerDevice;
  private pictureStyleChangedTrigger!: Homey.FlowCardTriggerDevice;
  private screenChangedTrigger!: Homey.FlowCardTriggerDevice;
  private currentSourceChangedTrigger!: Homey.FlowCardTriggerDevice;

  async onInit(): Promise<void> {
    this.applicationOpenedTrigger = this.homey.flow.getDeviceTriggerCard("application_opened");
    this.specificApplicationOpenedTrigger = this.homey.flow.getDeviceTriggerCard("specific_application_opened");
    this.ambiHueChangedTrigger = this.homey.flow.getDeviceTriggerCard("ambihue_changed");
    this.ambilightChangedTrigger = this.homey.flow.getDeviceTriggerCard("ambilight_changed");
    this.ambilightModeChangedTrigger = this.homey.flow.getDeviceTriggerCard("ambilight_mode_changed");
    this.pictureStyleChangedTrigger = this.homey.flow.getDeviceTriggerCard("picture_style_changed");
    this.screenChangedTrigger = this.homey.flow.getDeviceTriggerCard("screen_changed");
    this.currentSourceChangedTrigger = this.homey.flow.getDeviceTriggerCard("current_source_changed");
    this.log("Philips Jointspace driver initialised");
  }

  // --- trigger helpers exposed to PhilipsTvDevice -----------------------

  triggerApplicationOpenedTrigger(device: Homey.Device, args: { app: string }): Promise<void> {
    return this.applicationOpenedTrigger.trigger(device, args);
  }

  /**
   * Fires whenever an app is opened. The Flow editor's runListener filters
   * on the user-selected `app` arg so only flows targeting this specific
   * app actually trigger. State carries `{ id, name }` of the app that
   * just opened.
   */
  triggerSpecificApplicationOpenedTrigger(
    device: Homey.Device,
    state: { id: string; name: string },
  ): Promise<void> {
    return this.specificApplicationOpenedTrigger.trigger(device, {}, state);
  }

  triggerAmbiHueChangedTrigger(device: Homey.Device, args: { enabled: boolean }): Promise<void> {
    return this.ambiHueChangedTrigger.trigger(device, args);
  }

  triggerAmbilightChangedTrigger(device: Homey.Device, args: { enabled: boolean }): Promise<void> {
    return this.ambilightChangedTrigger.trigger(device, args);
  }

  triggerAmbilightModeChangedTrigger(device: Homey.Device, args: { mode: string }): Promise<void> {
    return this.ambilightModeChangedTrigger.trigger(device, args);
  }

  triggerPictureStyleChangedTrigger(device: Homey.Device, args: { style: string }): Promise<void> {
    return this.pictureStyleChangedTrigger.trigger(device, args);
  }

  triggerScreenChangedTrigger(device: Homey.Device, args: { enabled: boolean }): Promise<void> {
    return this.screenChangedTrigger.trigger(device, args);
  }

  triggerCurrentSourceChangedTrigger(device: Homey.Device, args: { source: string }): Promise<void> {
    return this.currentSourceChangedTrigger.trigger(device, args);
  }

  // --- pairing ----------------------------------------------------------

  private trace(...args: unknown[]): void {
    this.log(...args);
    activityLog.add(PAIRING_SCOPE, ...args);
  }

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    const ctx = this.createPairContext();
    this.trace("--- pair session started ---");
    this.registerSharedPairHandlers(session, ctx, async (credentials) => {
      this.trace("Pairing succeeded");
      if (ctx.selected && credentials) ctx.selected.store.credentials = { user: credentials.user, pass: credentials.pass };
      await session.showView("add_my_device");
    });
    session.setHandler("getDevice", async () => {
      if (!ctx.selected) return null;
      const { name, data, settings, store } = ctx.selected;
      return { name, data, settings, store };
    });
    session.setHandler("createDeviceFailed", async (message: string) => {
      const store = ctx.selected ? { ...ctx.selected.store, credentials: ctx.selected.store.credentials ? "<redacted>" : undefined } : null;
      this.trace(`createDevice failed: ${message}`, JSON.stringify({ data: ctx.selected?.data, store }));
    });
  }

  /**
   * Repair flow: same probing/pairing dance as onPair, but at the end we
   * write the new transport settings and credentials onto the existing
   * device instead of creating a new one. data.id stays untouched, so any
   * flows that reference this device keep working.
   *
   * Triggered from the device's overflow menu → Repair in the Homey UI.
   */
  async onRepair(session: Homey.Driver.PairSession, device: Homey.Device): Promise<void> {
    const ctx = this.createPairContext(device);
    this.trace("--- repair session started ---");
    this.registerSharedPairHandlers(session, ctx, async (credentials) => {
      this.trace("Repair succeeded");
      if (!ctx.selected) return;
      await this.applyRepairToDevice(device, ctx.selected, credentials);
      await session.showView("repair_done");
    });
  }

  private createPairContext(repairing: Homey.Device | null = null): PairContext {
    return {
      repairing,
      ip: null,
      candidates: [],
      selected: null,
      pairingApi: null,
      pairingState: null,
    };
  }

  private registerSharedPairHandlers(
    session: Homey.Driver.PairSession,
    ctx: PairContext,
    onPairingComplete: (credentials: JointspaceCredentials | null) => Promise<void>,
  ): void {
    // Each pair/request invalidates the PIN already on screen (#66).
    const startPairOnce = singleFlight(() => this.handleStartPairView(session, ctx, onPairingComplete));

    session.setHandler("showView", async (view: string) => {
      this.trace("Show view", view);
      switch (view) {
        case "discover":
          await this.handleDiscoverView(session, ctx);
          break;
        case "check_ip":
          await this.handleCheckIpView(session, ctx);
          break;
        case "validate":
          await this.handleValidateView(session, ctx, onPairingComplete);
          break;
        case "start_pair":
          await startPairOnce();
          break;
      }
    });

    session.setHandler("setTvIp", async (ip: string) => {
      this.trace("IP entered", ip);
      ctx.ip = ip;
    });
    session.setHandler("getTvIp", async () => ctx.ip);
    session.setHandler("list_devices", async () => ctx.candidates);
    session.setHandler("list_devices_selection", async (devices: DeviceDescriptor[]) => {
      ctx.selected = devices[devices.length - 1] ?? null;
      this.trace("Device selected", ctx.selected?.name, ctx.selected?.settings, `pairingType=${ctx.selected?.pairingType}`, `httpsUnavailable=${ctx.selected?.httpsUnavailable}`);
    });

    session.setHandler("pincode", async (digits: string[]) => {
      const pin = digits.join("");
      this.trace("Pincode submitted");
      if (!ctx.selected || !ctx.pairingApi || !ctx.pairingState) {
        await session.showView("discover");
        return false;
      }
      try {
        const credentials = await ctx.pairingApi.confirmPair(ctx.pairingState, pin);
        await onPairingComplete(credentials);
        return true;
      } catch (err) {
        return this.handlePincodeError(err, session, ctx);
      }
    });
  }

  private async applyRepairToDevice(
    device: Homey.Device,
    descriptor: DeviceDescriptor,
    credentials: JointspaceCredentials | null,
  ): Promise<void> {
    const { settings } = descriptor;
    await device.setStoreValue("credentials", credentials ? { user: credentials.user, pass: credentials.pass } : null);
    await device.setStoreValue("osType", null);
    await device.setStoreValue("notifyChangeSupported", null);
    await device.setStoreValue("pairingType", descriptor.pairingType ?? null);
    await device.setStoreValue("screenStateSupported", null);
    await device.setStoreValue("lastSetAmbilightMode", null);
    // Reset so refreshSystemMetadata re-probes against the (possibly new) TV
    // and stores its canonical id. Avoids dedup carrying over from the old TV
    // when Repair re-points the device.
    await device.setStoreValue("canonicalId", null);
    // Repair may point at a different TV; drop the old TV's MACs.
    await device.setStoreValue("wakeMacs", descriptor.store.wakeMacs);
    await device.setStoreValue("wakeOnLanEnabled", null);

    await device.setSettings({
      ipAddress: settings.ipAddress,
      apiVersion: settings.apiVersion,
      secure: settings.secure,
      port: settings.port,
    });
    this.log(`Repair applied to device ${device.getName()}: new IP ${settings.ipAddress}, port ${settings.port}, secure ${settings.secure}`);
    // setSettings doesn't call onSettings, so the running device has to be told.
    await (device as Homey.Device & { applyRepair?: () => Promise<void> }).applyRepair?.()
      .catch((err: Error) => this.error("applyRepair failed:", err));
  }

  // --- pair view handlers ----------------------------------------------

  private async handleDiscoverView(session: Homey.Driver.PairSession, ctx: PairContext): Promise<void> {
    type Tagged = { id: string; address: string; source: "ssdp" | "mdns" };
    const ssdpResults: Tagged[] = (Object.values(
      this.getDiscoveryStrategy().getDiscoveryResults(),
    ) as Array<{ id: string; address: string }>).map((r) => ({ ...r, source: "ssdp" }));
    const mdnsResults: Tagged[] = (Object.values(
      this.homey.discovery.getStrategy("philips-tv-mdns").getDiscoveryResults(),
    ) as Array<{ id: string; address: string }>).map((r) => ({ ...r, source: "mdns" }));
    // SSDP first: when the same TV appears in both, the IP-based dedup keeps
    // the SSDP entry, which gives us a real USN (and thus a uuid fallback)
    // versus mDNS's name-only id.
    const merged = this.mergeDiscoveryResults([...ssdpResults, ...mdnsResults]);
    const existingIds = this.collectExistingCanonicalIds(ctx.repairing);

    const probed = await Promise.allSettled(merged.map((r) => this.deviceFromDiscoveryResult(r)));
    ctx.candidates = probed
      .filter(
        (p): p is PromiseFulfilledResult<DeviceDescriptor> =>
          p.status === "fulfilled" && p.value !== null,
      )
      .map((p) => p.value)
      .filter((d) => !this.isAlreadyPaired(d, existingIds));

    const hadDiscoveryResults = merged.length > 0;

    if (ctx.candidates.length > 0) {
      await session.showView("list_devices");
    } else {
      await session.showView("add_by_ip");
      if (hadDiscoveryResults) {
        await session.emit("add_by_ip_hint", this.homey.__("pair.add_by_ip.no_new_devices_hint"));
      }
    }
  }

  private mergeDiscoveryResults<T extends { id: string; address: string }>(results: T[]): T[] {
    // SSDP and mDNS can report the same TV. Deduplicate on IP address since
    // the strategy-specific id (USN vs mDNS service name) differs.
    const seen = new Set<string>();
    const out: T[] = [];
    for (const r of results) {
      if (seen.has(r.address)) continue;
      seen.add(r.address);
      out.push(r);
    }
    return out;
  }

  /** Every id an already-paired TV may be known by, for deduplication during pair. */
  private collectExistingCanonicalIds(exclude: Homey.Device | null): Set<string> {
    const devices = this.getDevices().map((d) => ({
      dataId: d.getData().id as string,
      canonicalId: d.getStoreValue("canonicalId") as string | null,
    }));
    return existingCanonicalIds(devices, exclude ? (exclude.getData().id as string) : null);
  }

  private isAlreadyPaired(candidate: DeviceDescriptor, existingIds: Set<string>): boolean {
    return isAlreadyPaired(candidate.aliases, existingIds);
  }

  private async handleCheckIpView(session: Homey.Driver.PairSession, ctx: PairContext): Promise<void> {
    ctx.candidates = [];
    if (!ctx.ip) {
      await session.showView("add_by_ip");
      await session.emit("alert", this.homey.__("error.provide_the_ip_address"));
      return;
    }

    try {
      const candidate = await this.deviceFromIp(ctx.ip);
      const existingIds = this.collectExistingCanonicalIds(ctx.repairing);
      if (this.isAlreadyPaired(candidate, existingIds)) {
        await session.showView("add_by_ip");
        await session.emit("alert", this.homey.__("error.device_not_found"));
        return;
      }
      ctx.candidates = [candidate];
      await session.showView("list_devices");
    } catch (err) {
      await this.handleSystemInfoError(err, session, "add_by_ip");
    }
  }

  private async handleValidateView(
    session: Homey.Driver.PairSession,
    ctx: PairContext,
    onPairingComplete: (credentials: JointspaceCredentials | null) => Promise<void>,
  ): Promise<void> {
    if (!ctx.selected) {
      await session.showView("discover");
      return;
    }
    // Whether the TV needs PIN-pairing is independent of which transport it
    // serves on. Look at pairing_type explicitly; some firmwares advertise
    // secured_transport=true but pairing_type=none (or vice versa), and our
    // own transport-verification fallback flips `secure` to false on TVs
    // that don't actually respond on HTTPS/1926.
    const pairingType = ctx.selected.pairingType ?? "none";
    if (pairingType === "digest_auth_pairing") {
      this.trace("Pairing device requires authentication");
      await session.showView("start_pair");
    } else {
      this.trace(`Pairing device does not require authentication (pairing_type=${pairingType})`);
      await onPairingComplete(null);
    }
  }

  private async handleStartPairView(
    session: Homey.Driver.PairSession,
    ctx: PairContext,
    onPairingComplete: (credentials: JointspaceCredentials | null) => Promise<void>,
  ): Promise<void> {
    if (!ctx.selected) {
      await session.showView("discover");
      return;
    }

    ctx.pairingApi = new JointspaceApi(
      {
        host: ctx.selected.settings.ipAddress,
        apiVersion: ctx.selected.settings.apiVersion,
        secured: ctx.selected.settings.secure,
        port: ctx.selected.settings.port,
      },
      { log: (...args) => this.trace("[pair-api]", ...args), debug: true },
    );

    try {
      const system = await ctx.pairingApi.getSystem();
      const pairingType = extractPairingType(system) ?? "none";
      this.trace(`start_pair: pairing_type=${pairingType}`, ctx.selected.settings);
      if (pairingType === "digest_auth_pairing") {
        const device: PairDevice = { ...PAIR_DEVICE_INFO, id: JointspaceApi.generateDeviceId() };
        ctx.pairingState = await this.requestPairing(ctx.pairingApi, device, ctx.selected);
        this.trace("pair/request accepted, PIN should be on the TV");
        await session.showView("authenticate");
      } else if (pairingType === "none") {
        await onPairingComplete(null);
      } else {
        await session.showView("discover");
        await session.emit("alert", this.homey.__("error.unknown_pairing_type", { pairingType }));
      }
    } catch (err) {
      if (err instanceof PairingError && err.errorId === PairingStatus.ConcurrentPairing) {
        await session.showView("discover");
        await session.emit("alert", this.homey.__("error.concurrent_pairing"));
        return;
      }
      await this.handleSystemInfoError(err, session);
    }
  }

  /** On the HTTP fallback, a failed pair/request means the TV needs HTTPS: ask for a power-cycle. */
  private async requestPairing(
    api: JointspaceApi,
    device: PairDevice,
    selected: DeviceDescriptor,
  ): Promise<PairingState> {
    try {
      return await api.startPair(device);
    } catch (err) {
      if (selected.httpsUnavailable && !(err instanceof PairingError)) {
        this.trace(`pair/request over HTTP/1925 fallback failed (${(err as Error).message}); HTTPS/1926 is required`);
        throw new HttpsUnavailableError(
          `pair/request failed on HTTP/1925 and HTTPS/1926 is not responding: ${(err as Error).message}`,
        );
      }
      throw err;
    }
  }

  private async handlePincodeError(
    err: unknown,
    session: Homey.Driver.PairSession,
    ctx: PairContext,
  ): Promise<boolean> {
    const action = classifyPinError(err);
    const detail = err instanceof PairingError ? describePairingError(err) : (err as Error)?.message;
    this.trace(`Pincode error (${action.kind}): ${detail}`);
    switch (action.kind) {
      case "retry_pin":
        return false;
      case "restart_pair":
        ctx.pairingState = null;
        await session.showView("start_pair");
        await session.emit("alert", this.homey.__(action.messageKey));
        return false;
      case "abort":
        await session.showView("discover");
        await session.emit("alert", this.homey.__(action.messageKey, action.tokens));
        return false;
    }
  }

  private async handleSystemInfoError(
    err: unknown,
    session: Homey.Driver.PairSession,
    returnView: "discover" | "add_by_ip" = "discover",
  ): Promise<void> {
    const messageKey = this.localeKeyForError(err);
    this.trace("System info / pairing failure:", err, `-> shown to user: ${messageKey}`);
    await session.showView(returnView);
    await session.emit("alert", this.homey.__(messageKey));
  }

  private localeKeyForError(err: unknown): string {
    if (err instanceof HttpsUnavailableError) return "error.https_unavailable_for_pair";
    if (err instanceof ForbiddenError) return "error.api_forbidden";
    if (err instanceof NotFoundError) return "error.endpoint_not_found";
    if (err instanceof OfflineError) return "error.host_unreachable";
    if (err instanceof InvalidResponseError) return "error.invalid_response";
    if (err instanceof ProtocolError) return "error.protocol_error";
    if (err instanceof UnauthenticatedError) return "error.generic";
    return "error.generic";
  }

  // --- discovery / probing ---------------------------------------------

  private async deviceFromDiscoveryResult(result: { id: string; address: string; source: "ssdp" | "mdns" }): Promise<DeviceDescriptor | null> {
    const hint: DiscoveryHint =
      result.source === "ssdp" ? { usn: result.id } : { mdnsName: result.id };
    return this.deviceFromIp(result.address, hint);
  }

  private async deviceFromIp(ip: string, hint?: DiscoveryHint): Promise<DeviceDescriptor> {
    const descriptor: DeviceDescriptor = {
      name: "Philips TV",
      // Placeholder; replaced with the canonical id after we've called
      // getSystem() and know the serial / can fall back to USN.
      data: { id: ip },
      settings: { ipAddress: ip, apiVersion: 1, secure: false, port: 1925 },
      store: { wakeMacs: [] },
      aliases: [],
    };

    const probe = await probeTransport(ip, (...args) => this.trace("[probe-api]", ...args), true);
    this.trace(
      `${ip}: /system via ${probe.systemTransport?.protocol}/${probe.systemTransport?.port}`,
      `advertised=${JSON.stringify(probe.advertised)} os=${probe.osType} pairingType=${probe.pairingType}`,
      `httpsResponds=${probe.httpsResponds}`,
      probe.resolutionError ?? `-> ${JSON.stringify(probe.resolution)}`,
    );
    if (probe.resolutionError) throw probe.resolutionError;
    const { system } = probe;
    const { transport: verified, httpsUnavailable } = probe.resolution!;
    if (system.name) descriptor.name = system.name;
    descriptor.pairingType = probe.pairingType;
    descriptor.settings.apiVersion = verified.apiVersion;
    descriptor.settings.secure = verified.secured;
    descriptor.settings.port = verified.port;
    descriptor.httpsUnavailable = httpsUnavailable;
    descriptor.data.id = extractCanonicalId(system, {
      usn: hint?.usn,
      mdnsName: hint?.mdnsName,
      ip,
    });
    descriptor.aliases = [descriptor.data.id, ...(hint?.usn ? canonicalIdAliases(hint.usn) : [])];
    // network/devices needs credentials on some TVs; the device fills it in after pairing.
    const wake = await resolveWakeInfo(
      () => this.homey.arp.getMAC(ip),
      async () => [],
      (...args) => this.trace("[wake]", ...args),
    );
    descriptor.store.wakeMacs = wake.macs;
    return descriptor;
  }
}

module.exports = PhilipsTvDriver;
