# Philips TV

Control and monitor Philips TVs from Homey using the Jointspace protocol.
Supports models from roughly 2014 onwards, including the 2016+ Android-based
sets that use HTTPS with digest authentication.

## Capabilities

- On/off (Wake-on-LAN for deep-off; powerstate endpoint otherwise)
- Volume up/down, mute, volume slider
- Ambilight on/off and 20+ ambilight modes (color follow, video follow, audio follow)
- AmbiHue on/off
- Channel up/down
- A full remote keypad (digits, cursor, colour keys, playback, options, source, ...)

## Flow cards

**Triggers**

- The TV was turned on / off
- An application was opened
- Ambilight changed
- Ambilight mode changed
- AmbiHue changed

**Actions**

- Open an application (autocomplete from the apps installed on the TV)
- Open Google Assistant
- Select a source
- Send any remote key
- Set ambilight on/off and ambilight mode
- Set AmbiHue on/off

## Pairing

Auto-discovery uses two mechanisms in parallel:

- SSDP (`MediaRenderer:3`) for older non-Android TVs
- mDNS (`_philipstv_s_rpc._tcp`) for modern Android TVs

If your TV isn't found automatically you can add it by IP. 2016+ Android TVs
will prompt for a pairing PIN displayed on the screen.

## Known limitations

- Channel switching by name and source switching as first-class actions are
  on the roadmap for v3.1. The current `Send any remote key` action can stand
  in via `ChannelStepUp` / `ChannelStepDown` and `Source`.
- Some ambilight modes are firmware-dependent and may not be available on
  every model.
- Power-on from a fully-off TV requires Wake-on-LAN to be enabled in the TV
  settings.

## Reporting issues

Please attach a diagnostic report when opening an issue. It captures
everything we need to triage in one paste.
See [DIAGNOSE.md](DIAGNOSE.md) for two ways to generate one (the
recommended path runs from inside the Homey app, no install required).

Community thread: <https://community.athom.com/t/philips-tv-testing/14064>

## Changelog

- **v3.0.0** - Major rewrite to TypeScript. Fixes the long-standing "app
  stops responding" cluster (background poller no longer dies on transient
  errors). Adds mDNS auto-discovery for Android TVs, channel up/down keys,
  more reliable power-on, working ambilight off on Android XTV firmware.
  Removes the unused `speaker_playing` capability. Requires Homey firmware
  12.2 or newer.
- **v2.5.0** - More pairing-process translations and a new `Open Google
  Assistant` action.
- **v2.4.0** - `set_ambilight_mode` action.
- **v2.3.0** - Translations for `de`, `fr`, `it`, `sv`, `no`, `es`, `da`, `pl`.
- **v2.2.0** - Automatic resolution of Jointspace version and authentication
  method during pairing.
- **v2.1.0** - Pairing views aligned with Homey design.
- **v2.0.0** - Homey SDK v3 upgrade.
