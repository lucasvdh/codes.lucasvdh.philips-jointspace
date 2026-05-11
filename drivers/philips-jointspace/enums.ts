import type { AmbilightConfiguration } from "./types";

export const PairingStatus = {
  Success: "SUCCESS",
  ConcurrentPairing: "CONCURRENT_PAIRING",
  InvalidPin: "INVALID_PIN",
  Timeout: "TIMEOUT",
} as const;

export type PairingStatus = (typeof PairingStatus)[keyof typeof PairingStatus];

export const AmbilightStyle = {
  FollowColor: "FOLLOW_COLOR",
  FollowVideo: "FOLLOW_VIDEO",
  FollowAudio: "FOLLOW_AUDIO",
} as const;

export type AmbilightStyle = (typeof AmbilightStyle)[keyof typeof AmbilightStyle];

export const AmbilightConfigurations = {
  color_hot_lava: { styleName: "FOLLOW_COLOR", isExpert: false, menuSetting: "HOT_LAVA", stringValue: "Hot Lava" },
  color_warm_white: { styleName: "FOLLOW_COLOR", isExpert: false, menuSetting: "ISF", stringValue: "Warm White" },
  color_cool_white: { styleName: "FOLLOW_COLOR", isExpert: false, menuSetting: "PTA_LOUNGE", stringValue: "Cool White" },
  color_fresh_nature: { styleName: "FOLLOW_COLOR", isExpert: false, menuSetting: "FRESH_NATURE", stringValue: "Fresh Nature" },
  color_deep_water: { styleName: "FOLLOW_COLOR", isExpert: false, menuSetting: "DEEP_WATER", stringValue: "Deep Water" },
  video_standard: { styleName: "FOLLOW_VIDEO", isExpert: false, menuSetting: "STANDARD", stringValue: "Standard" },
  video_natural: { styleName: "FOLLOW_VIDEO", isExpert: false, menuSetting: "NATURAL", stringValue: "Natural" },
  video_vivid: { styleName: "FOLLOW_VIDEO", isExpert: false, menuSetting: "VIVID", stringValue: "Vivid" },
  video_game: { styleName: "FOLLOW_VIDEO", isExpert: false, menuSetting: "GAME", stringValue: "Game" },
  video_comfort: { styleName: "FOLLOW_VIDEO", isExpert: false, menuSetting: "COMFORT", stringValue: "Comfort" },
  video_relax: { styleName: "FOLLOW_VIDEO", isExpert: false, menuSetting: "RELAX", stringValue: "Relax" },
  audio_adapt_brightness: { styleName: "FOLLOW_AUDIO", isExpert: false, menuSetting: "ENERGY_ADAPTIVE_BRIGHTNESS", stringValue: "Lumina" },
  audio_adapt_colors: { styleName: "FOLLOW_AUDIO", isExpert: false, menuSetting: "ENERGY_ADAPTIVE_COLORS", stringValue: "Colora" },
  audio_vu_meter: { styleName: "FOLLOW_AUDIO", isExpert: false, menuSetting: "VU_METER", stringValue: "Retro" },
  audio_spectrum: { styleName: "FOLLOW_AUDIO", isExpert: false, menuSetting: "SPECTRUM_ANALYZER", stringValue: "Spectrum" },
  audio_knight_rider_1: { styleName: "FOLLOW_AUDIO", isExpert: false, menuSetting: "KNIGHT_RIDER_CLOCKWISE", stringValue: "Knight rider Clockwise" },
  audio_knight_rider_2: { styleName: "FOLLOW_AUDIO", isExpert: false, menuSetting: "KNIGHT_RIDER_ALTERNATING", stringValue: "Scanner" },
  audio_flash: { styleName: "FOLLOW_AUDIO", isExpert: false, menuSetting: "RANDOM_PIXEL_FLASH", stringValue: "Rhythm" },
  audio_strobo: { styleName: "FOLLOW_AUDIO", isExpert: false, menuSetting: "STROBO", stringValue: "Strobo" },
  audio_party: { styleName: "FOLLOW_AUDIO", isExpert: false, menuSetting: "PARTY", stringValue: "Party" },
  audio_random: { styleName: "FOLLOW_AUDIO", isExpert: false, menuSetting: "MODE_RANDOM", stringValue: "Random" },
} as const satisfies Record<string, AmbilightConfiguration>;

export type AmbilightModeKey = keyof typeof AmbilightConfigurations;

export function ambilightModeFromConfiguration(config: AmbilightConfiguration): AmbilightModeKey | undefined {
  const target = JSON.stringify(config);
  for (const [key, value] of Object.entries(AmbilightConfigurations) as [AmbilightModeKey, AmbilightConfiguration][]) {
    if (JSON.stringify(value) === target) return key;
  }
  return undefined;
}

export const InputKey = {
  Standby: "Standby",
  Mute: "Mute",
  VolumeUp: "VolumeUp",
  VolumeDown: "VolumeDown",
  ChannelStepUp: "ChannelStepUp",
  ChannelStepDown: "ChannelStepDown",
  Play: "Play",
  Pause: "Pause",
  PlayPause: "PlayPause",
  Stop: "Stop",
  FastForward: "FastForward",
  Rewind: "Rewind",
  Next: "Next",
  Previous: "Previous",
  CursorUp: "CursorUp",
  CursorDown: "CursorDown",
  CursorLeft: "CursorLeft",
  CursorRight: "CursorRight",
  Confirm: "Confirm",
  Back: "Back",
  Find: "Find",
  RedColour: "RedColour",
  GreenColour: "GreenColour",
  YellowColour: "YellowColour",
  BlueColour: "BlueColour",
  Home: "Home",
  Options: "Options",
  Dot: "Dot",
  Digit0: "Digit0",
  Digit1: "Digit1",
  Digit2: "Digit2",
  Digit3: "Digit3",
  Digit4: "Digit4",
  Digit5: "Digit5",
  Digit6: "Digit6",
  Digit7: "Digit7",
  Digit8: "Digit8",
  Digit9: "Digit9",
  Info: "Info",
  Adjust: "Adjust",
  WatchTV: "WatchTV",
  Viewmode: "Viewmode",
  Teletext: "Teletext",
  Subtitle: "Subtitle",
  Source: "Source",
  AmbilightOnOff: "AmbilightOnOff",
  Record: "Record",
  Online: "Online",
} as const;

export type InputKey = (typeof InputKey)[keyof typeof InputKey];
