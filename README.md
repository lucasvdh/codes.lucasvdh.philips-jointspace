# Philips TV

This app adds support for Philips TV's models ranging from ~2014 up to 2019 using the Jointspace protocol. 
Older models might need to manually enable this.

Some Flow card actions that are currently available:
- Turn on/off (device must have WOL enabled to turn on after long period of time)
- Set volume
- Mute/unmute volume
- Send a key (send any key from your remote to the TV)
- Open an app (only available from Android TV models)

Some Flow card triggers that will soon be available:
- Turned on/off
- Volume changed
- Open application changed
- The ambilight mode was changed

Some Flow card actions that will soon be available:
- Turn ambilight on/off
- Turn ambilight mode to "Video standard"
- Turn ambilight + Hue on/off
- Turn screen off

---

## Known issues
There are still some unresolved issues in the pairing process which is required for ~2016+ models. 
The latest JointspaceClient fix should resolve some of these.

If you're experiencing pairing issues or other bugs, please see the following forum topic:

https://community.athom.com/t/philips-tv-testing/14064

## Changelog

- **v2.4.0** - Add new `set_ambilight_mode` capability
- **v2.3.0** - Add translations for `de`, `fr`, `it`, `sv`, `no`, `es`, `da` and `pl`
- **v2.2.1** - Fix (some) pincode submit errors
- **v2.2.0** - Automatically resolving TV settings such as Jointspace version and authentication method
- **v2.1.0** - New pairing views that follow Homey design standard
- **v2.0.0** - Homey SDK v3 upgrade to support the latest Homey models