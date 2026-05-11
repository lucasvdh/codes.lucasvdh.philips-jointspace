"use strict";

import Homey from "homey";

import { JointspaceApi } from "./jointspace-api";
import { PairingStatus } from "./enums";
import {
  NotFoundError,
  OfflineError,
  PairingError,
  UnauthenticatedError,
} from "./errors";
import {
  JointspaceCredentials,
  PairDevice,
  PairingState,
  SystemInfo,
} from "./types";

interface DeviceDescriptor {
  name: string;
  data: {
    id: string;
    mac: string | null;
    credentials: Partial<JointspaceCredentials>;
  };
  settings: {
    ipAddress: string;
    apiVersion: number;
    secure: boolean;
    port: number;
  };
}

interface PairContext {
  ip: string | null;
  candidates: DeviceDescriptor[];
  selected: DeviceDescriptor | null;
  pairingApi: JointspaceApi | null;
  pairingState: PairingState | null;
}

const PAIR_DEVICE_INFO: PairDevice = {
  app_id: "gapp.id",
  app_name: "Homey Philips TV",
  device_name: "Homey",
  device_os: "Homey",
  id: "",
  type: "native",
};

class PhilipsTvDriver extends Homey.Driver {
  private applicationOpenedTrigger!: Homey.FlowCardTriggerDevice;
  private ambiHueChangedTrigger!: Homey.FlowCardTriggerDevice;
  private ambilightChangedTrigger!: Homey.FlowCardTriggerDevice;
  private ambilightModeChangedTrigger!: Homey.FlowCardTriggerDevice;

  async onInit(): Promise<void> {
    this.applicationOpenedTrigger = this.homey.flow.getDeviceTriggerCard("application_opened");
    this.ambiHueChangedTrigger = this.homey.flow.getDeviceTriggerCard("ambihue_changed");
    this.ambilightChangedTrigger = this.homey.flow.getDeviceTriggerCard("ambilight_changed");
    this.ambilightModeChangedTrigger = this.homey.flow.getDeviceTriggerCard("ambilight_mode_changed");
    this.log("Philips Jointspace driver initialised");
  }

  // --- trigger helpers exposed to PhilipsTvDevice -----------------------

  triggerApplicationOpenedTrigger(device: Homey.Device, args: { app: string }): Promise<void> {
    return this.applicationOpenedTrigger.trigger(device, args);
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

  // --- pairing ----------------------------------------------------------

  async onPair(session: Homey.Driver.PairSession): Promise<void> {
    const ctx: PairContext = {
      ip: null,
      candidates: [],
      selected: null,
      pairingApi: null,
      pairingState: null,
    };

    session.setHandler("showView", async (view: string) => {
      this.log("Show view", view);
      switch (view) {
        case "discover":
          await this.handleDiscoverView(session, ctx);
          break;
        case "check_ip":
          await this.handleCheckIpView(session, ctx);
          break;
        case "validate":
          await this.handleValidateView(session, ctx);
          break;
        case "start_pair":
          await this.handleStartPairView(session, ctx);
          break;
      }
    });

    session.setHandler("setTvIp", async (ip: string) => {
      ctx.ip = ip;
    });

    session.setHandler("getTvIp", async () => ctx.ip);

    session.setHandler("list_devices", async () => ctx.candidates);

    session.setHandler("list_devices_selection", async (devices: DeviceDescriptor[]) => {
      ctx.selected = devices[devices.length - 1] ?? null;
    });

    session.setHandler("pincode", async (digits: string[]) => {
      const pin = digits.join("");
      this.log("Pincode submitted");
      if (!ctx.selected || !ctx.pairingApi || !ctx.pairingState) {
        await session.showView("discover");
        return false;
      }
      try {
        const credentials = await ctx.pairingApi.confirmPair(ctx.pairingState, pin);
        ctx.selected.data.credentials = credentials;
        await session.showView("add_my_device");
        return true;
      } catch (err) {
        return this.handlePincodeError(err, session);
      }
    });

    session.setHandler("getDevice", async () => ctx.selected);
  }

  // --- pair view handlers ----------------------------------------------

  private async handleDiscoverView(session: Homey.Driver.PairSession, ctx: PairContext): Promise<void> {
    const discoveryStrategy = this.getDiscoveryStrategy();
    const results = Object.values(discoveryStrategy.getDiscoveryResults());
    const existingDeviceIds = new Set(this.getDevices().map((d) => d.getData().id as string));

    const probed = await Promise.allSettled(results.map((r) => this.deviceFromDiscoveryResult(r)));
    ctx.candidates = probed
      .filter(
        (p): p is PromiseFulfilledResult<DeviceDescriptor> =>
          p.status === "fulfilled" && p.value !== null,
      )
      .map((p) => p.value)
      .filter((d) => !existingDeviceIds.has(d.data.id));

    const hadDiscoveryResults = results.length > 0;

    if (ctx.candidates.length > 0) {
      await session.showView("list_devices");
    } else {
      await session.showView("add_by_ip");
      if (hadDiscoveryResults) {
        await session.emit("add_by_ip_hint", this.homey.__("pair.add_by_ip.no_new_devices_hint"));
      }
    }
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
      const isDuplicate = this.getDevices().some((d) => d.getData().id === candidate.data.id);
      if (isDuplicate) {
        await session.showView("add_by_ip");
        await session.emit("alert", this.homey.__("error.device_not_found"));
        return;
      }
      ctx.candidates = [candidate];
      await session.showView("list_devices");
    } catch (err) {
      await this.handleSystemInfoError(err, session);
    }
  }

  private async handleValidateView(session: Homey.Driver.PairSession, ctx: PairContext): Promise<void> {
    if (!ctx.selected) {
      await session.showView("discover");
      return;
    }
    if (ctx.selected.settings.secure) {
      this.log("Pairing device requires authentication");
      await session.showView("start_pair");
    } else {
      this.log("Pairing device does not require authentication");
      await session.showView("add_my_device");
    }
  }

  private async handleStartPairView(session: Homey.Driver.PairSession, ctx: PairContext): Promise<void> {
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
      { log: (...args) => this.log("[pair-api]", ...args) },
    );

    try {
      const system = await ctx.pairingApi.getSystem();
      const pairingType = this.pairingTypeFromSystem(system);
      if (pairingType === "digest_auth_pairing") {
        const device: PairDevice = { ...PAIR_DEVICE_INFO, id: JointspaceApi.generateDeviceId() };
        ctx.pairingState = await ctx.pairingApi.startPair(device);
        await session.showView("authenticate");
      } else if (pairingType === "none") {
        await session.showView("add_my_device");
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

  private async handlePincodeError(err: unknown, session: Homey.Driver.PairSession): Promise<boolean> {
    this.log("Pincode error", err);
    if (err instanceof PairingError) {
      if (err.errorId === PairingStatus.InvalidPin) {
        return false;
      }
      if (err.errorId === PairingStatus.Timeout) {
        await session.showView("start_pair");
        return false;
      }
    }
    await session.showView("discover");
    await session.emit("alert", this.homey.__("error.generic"));
    return false;
  }

  private async handleSystemInfoError(err: unknown, session: Homey.Driver.PairSession): Promise<void> {
    this.log("System info / pairing failure:", err);
    if (err instanceof NotFoundError) {
      await session.showView("add_by_ip");
      await session.emit("alert", this.homey.__("error.endpoint_not_found"));
      return;
    }
    if (err instanceof OfflineError) {
      await session.showView("discover");
      await session.emit("alert", this.homey.__("error.host_unreachable"));
      return;
    }
    if (err instanceof UnauthenticatedError) {
      await session.showView("discover");
      await session.emit("alert", this.homey.__("error.generic"));
      return;
    }
    await session.showView("discover");
    await session.emit("alert", this.homey.__("error.generic"));
  }

  // --- discovery / probing ---------------------------------------------

  private async deviceFromDiscoveryResult(result: { id: string; address: string }): Promise<DeviceDescriptor | null> {
    const base: DeviceDescriptor = {
      name: "Philips TV",
      data: { id: result.id, mac: null, credentials: {} },
      settings: { ipAddress: result.address, apiVersion: 1, secure: false, port: 1925 },
    };
    return this.deviceFromIp(result.address, base);
  }

  private async deviceFromIp(ip: string, base?: DeviceDescriptor): Promise<DeviceDescriptor> {
    const descriptor: DeviceDescriptor = base ?? {
      name: "Philips TV",
      data: { id: ip, mac: null, credentials: {} },
      settings: { ipAddress: ip, apiVersion: 1, secure: false, port: 1925 },
    };

    const api = new JointspaceApi(
      {
        host: ip,
        apiVersion: descriptor.settings.apiVersion,
        secured: descriptor.settings.secure,
        port: descriptor.settings.port,
      },
      { log: (...args) => this.log("[probe-api]", ...args) },
    );

    const system = await api.getSystem();
    if (system.name) descriptor.name = system.name;
    descriptor.settings.apiVersion = system.api_version?.Major ?? descriptor.settings.apiVersion;
    descriptor.settings.secure = this.securedTransportFromSystem(system);
    descriptor.settings.port = descriptor.settings.apiVersion < 6 ? 1925 : 1926;
    return descriptor;
  }

  private securedTransportFromSystem(system: SystemInfo): boolean {
    const value = system.featuring?.systemfeatures?.secured_transport;
    return value === true || value === "true";
  }

  private pairingTypeFromSystem(system: SystemInfo): string {
    const type = system.featuring?.systemfeatures?.pairing_type;
    if (typeof type === "string" && type.length > 0) return type;
    this.log("No pairing_type in system features; assuming no pairing required.");
    return "none";
  }
}

module.exports = PhilipsTvDriver;
