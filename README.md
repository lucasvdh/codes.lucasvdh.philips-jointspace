# Philips TV

_This is a work in progress_

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

Some Flow card actions that will soon be available:
- Turn ambilight on/off
- Turn ambilight + Hue on/off
- Turn screen off

---

## Known issues
There are still some unresolved issues in the pairing process which is required for ~2016+ models. 
I'm still looking into these.

Another issue that I'm working on is that the app doesn't update the device's state after a while. 
Because of this Flow card triggers like "Turned on/off" don't always work.

If you're experiencing pairing issues or other bugs, please see the following forum topic:

https://community.athom.com/t/philips-tv-testing/14064

## Changelog

- **v0.3.3** - Improve test script edge-cases
- **v0.3.2** - Fix power on behaviour
- **v0.3.1** - Bug fixes
- **v0.3.0** - New Flow cards
- **v0.2.0** - Better pairing, background monitor and TV type selection
- **v0.1.5** - Bug fixes
- **v0.1.4** - Pairing fixes and ambilight support
- **v0.1.3** - Bug fixes and test script
- **v0.1.1** - Pairing restyle
- **v0.1.0** - Initial version