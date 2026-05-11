"use strict";

import Homey from "homey";

interface ApplicationDescriptor {
  id: string;
  name: string;
  intent: unknown;
}

interface KeyDescriptor {
  inputName: string;
  friendlyName: Record<string, string>;
}

interface JointspaceClientLike {
  sendKey(key: string): Promise<unknown>;
  getPossibleKeys(): KeyDescriptor[];
}

interface PhilipsTvDeviceLike {
  openApplication(app: ApplicationDescriptor): Promise<unknown>;
  sendGoogleAssistantSearch(query: string): Promise<unknown>;
  setAmbiHue(state: boolean): Promise<unknown>;
  setAmbilight(state: boolean): Promise<unknown>;
  setAmbilightMode(mode: string): Promise<unknown>;
  getApplications(): Promise<ApplicationDescriptor[]>;
  getJointspaceClient(): JointspaceClientLike;
}

interface AutocompleteResult {
  id: string;
  name: string;
}

interface KeyAutocompleteResult extends AutocompleteResult {
  key: string;
}

class PhilipsTV extends Homey.App {
  async onInit(): Promise<void> {
    this.log("Philips TV app is running...");
    this.registerFlowListeners();
  }

  private registerFlowListeners(): void {
    this.homey.flow
      .getActionCard("open_application")
      .registerRunListener(async ({ device, app }: { device: PhilipsTvDeviceLike; app: ApplicationDescriptor }) =>
        device.openApplication(app)
      )
      .registerArgumentAutocompleteListener("app", this.onFlowApplicationAutocomplete.bind(this));

    this.homey.flow
      .getActionCard("open_google_assistant")
      .registerRunListener(async ({ device, input }: { device: PhilipsTvDeviceLike; input: string }) =>
        device.sendGoogleAssistantSearch(input)
      );

    this.homey.flow
      .getActionCard("select_source")
      .registerRunListener(async ({ device, source }: { device: PhilipsTvDeviceLike; source: string }) =>
        device.sendGoogleAssistantSearch(source)
      );

    this.homey.flow
      .getActionCard("send_key")
      .registerRunListener(async ({ device, option }: { device: PhilipsTvDeviceLike; option: KeyAutocompleteResult }) =>
        device.getJointspaceClient().sendKey(option.key)
      )
      .registerArgumentAutocompleteListener("option", this.onFlowKeyAutocomplete.bind(this));

    this.homey.flow
      .getActionCard("set_ambihue")
      .registerRunListener(async ({ device, state }: { device: PhilipsTvDeviceLike; state: string }) =>
        device.setAmbiHue(state === "on")
      );

    this.homey.flow
      .getActionCard("set_ambilight")
      .registerRunListener(async ({ device, state }: { device: PhilipsTvDeviceLike; state: string }) =>
        device.setAmbilight(state === "on")
      );

    this.homey.flow
      .getActionCard("set_ambilight_mode")
      .registerRunListener(async ({ device, mode }: { device: PhilipsTvDeviceLike; mode: string }) =>
        device.setAmbilightMode(mode)
      );

    this.log("Initialized flow");
  }

  private async onFlowApplicationAutocomplete(
    query: string,
    { device }: { device: PhilipsTvDeviceLike }
  ): Promise<AutocompleteResult[]> {
    const applications = await device.getApplications();
    return applications.filter((app) => app.name.toLowerCase().includes(query.toLowerCase()));
  }

  private async onFlowKeyAutocomplete(
    query: string,
    { device }: { device: PhilipsTvDeviceLike }
  ): Promise<KeyAutocompleteResult[]> {
    const client = device.getJointspaceClient();
    return client
      .getPossibleKeys()
      .map((key) => ({
        id: key.inputName,
        key: key.inputName,
        name: this.translateKey(key.friendlyName),
      }))
      .filter((result) => result.name.toLowerCase().includes(query.toLowerCase()));
  }

  private translateKey(i18n: Record<string, string>): string {
    const lang = this.homey.i18n.getLanguage();
    return i18n[lang] ?? i18n["en"] ?? "Untranslated";
  }
}

module.exports = PhilipsTV;
