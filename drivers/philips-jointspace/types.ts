export type Protocol = "http" | "https";

export interface JointspaceCredentials {
  user: string;
  pass: string;
}

export interface JointspaceConfig {
  host: string;
  apiVersion: number;
  secured: boolean;
  port: number;
  credentials?: JointspaceCredentials;
}

export interface ApiVersion {
  Major: number;
  Minor?: number;
  Patch?: number;
}

export interface SystemFeatures {
  tvtype?: string;
  pairing_type?: "digest_auth_pairing" | "none" | string;
  secured_transport?: "true" | "false" | boolean;
  companion_screen?: "true" | "false" | boolean | string;
  os_type?: string;
}

export interface JsonFeatures {
  ambilight?: string[];
  applications?: string[];
  channels?: string[];
  inputkey?: string[];
  activities?: string[];
  recordings?: string[];
  menuitems?: string[];
  editfavorites?: string[];
  textentry?: string[];
  pointer?: string[];
  mappings?: string[];
}

export interface SystemFeaturing {
  jsonfeatures?: JsonFeatures;
  systemfeatures?: SystemFeatures;
}

export interface SystemInfo {
  name?: string;
  model?: string;
  serialnumber?: string;
  serialnumber_encrypted?: string;
  deviceid_encrypted?: string;
  softwareversion?: string;
  softwareversion_encrypted?: string;
  model_encrypted?: string;
  menulanguage?: string;
  country?: string;
  api_version: ApiVersion;
  featuring?: SystemFeaturing;
  notifyChange?: string;
  os_type?: string;
}

export interface PairDevice {
  app_id: string;
  app_name: string;
  device_name: string;
  device_os: string;
  id: string;
  type: string;
}

export interface PairRequestResponse {
  error_id: string;
  error_text?: string;
  auth_key: string;
  timestamp: number;
  timeout: number;
}

export interface PairGrantResponse {
  error_id: string;
  error_text?: string;
}

export interface PairingState {
  device: PairDevice;
  authKey: string;
  timestamp: number;
}

export interface ApplicationIntentComponent {
  packageName: string;
  className: string;
}

export interface ApplicationIntent {
  extras?: Record<string, unknown>;
  action?: string;
  component: ApplicationIntentComponent;
}

export interface Application {
  id: string;
  label: string;
  order?: number;
  type?: string;
  intent: ApplicationIntent;
}

export interface ApplicationsResponse {
  version?: number;
  applications: Application[];
}

export interface PowerState {
  powerstate: "On" | "Standby" | string;
}

export interface ScreenState {
  // The TV reports and accepts plain "On"/"Off". An older Philips doc
  // dump used "screenOn"/"screenOff" but no live firmware we've tested
  // actually uses those — sending them gets you a 200 with no state
  // change. Confirmed via scripts/debug-screenstate.mjs.
  screenstate: "On" | "Off" | string;
}

export interface AudioData {
  muted: boolean;
  current: number;
  min: number;
  max: number;
}

export interface AmbilightPowerState {
  power: "On" | "Off";
}

export interface AmbilightConfiguration {
  styleName: string;
  isExpert: boolean;
  menuSetting?: string;
  stringValue?: string;
  algorithm?: string;
}

export interface AmbiHueState {
  power: "On" | "Off";
}

export interface CurrentActivity {
  component: ApplicationIntentComponent;
}

export type NotifyChangeState = Record<string, unknown>;

export interface NotifyChangePayload {
  notification: NotifyChangeState;
}

export interface MenuItemsSettingUpdate {
  values: Array<{
    value: {
      Nodeid: number;
      Controllable?: string;
      Available?: string;
      data?: { value?: string | number | boolean };
    };
  }>;
}

export interface InputKeyDescriptor {
  inputName: string;
  friendlyName: Record<string, string>;
}

export interface Channel {
  ccid: number | string;
  preset?: string;
  name?: string;
  onid?: number;
  tsid?: number;
  sid?: number;
  serviceType?: string;
  type?: string;
  logoVersion?: number | string;
}

export interface ChannelList {
  id: string;
  version?: number | string;
  listType?: string;
  medium?: string;
  Channel?: Channel[];
}

export interface ChannelDbTvListMeta {
  id: string;
  version?: number | string;
  listType?: string;
  medium?: string;
}

export interface ChannelDbTv {
  channelLists?: ChannelDbTvListMeta[];
  favoriteLists?: ChannelDbTvListMeta[];
}

export interface LegacyChannelEntry {
  preset?: string;
  name?: string;
}

export type LegacyChannels = Record<string, LegacyChannelEntry>;

export interface Source {
  id: string;
  name?: string;
}

export type SourcesMap = Record<string, { name?: string }>;

export interface CurrentSource {
  id: string;
}
