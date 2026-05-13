"use strict";

import Homey from "homey";

interface ApplicationDescriptor {
  id: string;
  name: string;
  intent: unknown;
  // Optional data URI (`data:image/png;base64,…`) shown in the Flow
  // editor's autocomplete dropdown. Populated lazily as the device
  // background-fetches icons after the first getApplications().
  image?: string;
}

interface KeyDescriptor {
  inputName: string;
  friendlyName: Record<string, string>;
}

interface JointspaceClientLike {
  sendKey(key: string): Promise<unknown>;
  getPossibleKeys(): KeyDescriptor[];
}

interface ChannelDescriptor {
  id: string;
  name: string;
  ccid: number | string;
  preset?: string;
}

interface PhilipsTvDeviceLike {
  openApplication(app: ApplicationDescriptor): Promise<unknown>;
  sendGoogleAssistantSearch(query: string): Promise<unknown>;
  selectSource(label: string): Promise<unknown>;
  setAmbiHue(state: boolean): Promise<unknown>;
  setAmbilight(state: boolean): Promise<unknown>;
  setAmbilightMode(mode: string): Promise<unknown>;
  setScreen(state: boolean): Promise<unknown>;
  getApplications(): Promise<ApplicationDescriptor[]>;
  getChannels(): Promise<ChannelDescriptor[]>;
  setChannel(channel: ChannelDescriptor): Promise<unknown>;
  getJointspaceClient(): JointspaceClientLike;
  getCapabilityValue(id: string): unknown;
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

    // Specific-app trigger: only fires when the user-selected app matches
    // the one that was just opened. State (the actually-opened app) is
    // supplied by device.handleActivityChange via the driver trigger call.
    this.homey.flow
      .getDeviceTriggerCard("specific_application_opened")
      .registerRunListener(
        async (
          args: { app: ApplicationDescriptor },
          state: { id: string; name: string },
        ) => {
          // Match by id (immutable) with name as fallback in case Homey
          // strips unknown fields from the stored autocomplete result.
          const match = args.app?.id === state?.id || args.app?.name === state?.name;
          this.log(
            `[trigger:specific_application_opened] args.app=${JSON.stringify(args.app)} state=${JSON.stringify(state)} match=${match}`,
          );
          return match;
        },
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
        device.selectSource(source)
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

    this.homey.flow
      .getActionCard("set_channel")
      .registerRunListener(async ({ device, channel }: { device: PhilipsTvDeviceLike; channel: ChannelDescriptor }) =>
        device.setChannel(channel)
      )
      .registerArgumentAutocompleteListener("channel", this.onFlowChannelAutocomplete.bind(this));

    this.homey.flow
      .getActionCard("screen_turn_off")
      .registerRunListener(async ({ device }: { device: PhilipsTvDeviceLike }) =>
        device.setScreen(false)
      );

    this.homey.flow
      .getActionCard("screen_turn_on")
      .registerRunListener(async ({ device }: { device: PhilipsTvDeviceLike }) =>
        device.setScreen(true)
      );

    // Conditions: each takes the device + an arg, and reads device state.
    this.homey.flow
      .getConditionCard("screen_is_on")
      .registerRunListener(async ({ device }: { device: PhilipsTvDeviceLike }) =>
        device.getCapabilityValue("screen_on") === true
      );

    this.homey.flow
      .getConditionCard("current_application_is")
      .registerRunListener(
        async ({ device, app }: { device: PhilipsTvDeviceLike; app: ApplicationDescriptor }) => {
          // Capability stores the human-readable name; match against that
          // primarily. Fall back to id-based check if a flow author later
          // wants to compare by id (autocomplete passes the full object).
          const current = device.getCapabilityValue("current_application") as string | null;
          return current === app?.name;
        },
      )
      .registerArgumentAutocompleteListener("app", this.onFlowApplicationAutocomplete.bind(this));

    this.homey.flow
      .getConditionCard("current_source_is")
      .registerRunListener(async ({ device, source }: { device: PhilipsTvDeviceLike; source: string }) => {
        const current = device.getCapabilityValue("current_source") as string | null;
        return current === source;
      });

    this.log("Initialized flow");
  }

  private async onFlowChannelAutocomplete(
    query: string,
    { device }: { device: PhilipsTvDeviceLike }
  ): Promise<ChannelDescriptor[]> {
    const channels = await device.getChannels();
    const q = query.toLowerCase();
    return channels.filter((c) => c.name.toLowerCase().includes(q) || (c.preset ?? "").toLowerCase().includes(q));
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
