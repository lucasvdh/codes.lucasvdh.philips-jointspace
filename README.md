# Philips TV

_This is a work in progress_

This app adds support for Philips TV's that support the Jointspace protocol. Supported models range from ~2014 up to 2019.

Some Flow card actions that are available:
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

#### Known issues
There are still some unresolved issues in the pairing process which is required for ~2016+ models. I'm still looking into these, if you're experiencing pairing issues yourself please see the following forum topic:

https://community.athom.com/t/philips-tv-testing/14064

#### Changelog

##### v0.3.3 Improve test script edge-cases
New
- :art: Extend pairing test script with all variations on pairing

##### v0.3.2 Fix power on behaviour
Fixes
- :bug: Fix power on capability never getting positive result

##### v0.3.1 Bug fix
Fixes
- :bug: Fix incorrect variable rename

##### v0.3.0 New Flow cards
New
- :rainbow: Added open app flow card action
- :rainbow: Added send key flow card action
- :art: Added method to jointspace client to fetch list of possible keys (temporary fix)

##### v0.2.0 Better pairing, background monitor and TV type selection
New
- :memo: Add more pairing and error translations 
- :art: Improve pairing flow 
- :rainbow: Added port selection based on tv type in pairing 
- :rainbow: Customer pincode view
- :rainbow: Background monitor that keeps local state on Homey up to date with TV

##### v0.1.5 Bug fixes
Fixes
- :bug: Fix device timeout client initialization

##### v0.1.4 Pairing fixes and ambilight support
New
- :rainbow: Initial commit for ambilight and ambilight+hue capabilities 
- :memo: Add more error messages

Fixes
- :bug: Fixed more pairing edge cases, now also takes timeout into account

##### v0.1.3 Bug fixes and test script
New
- :art: Refactor getting of mac address to `network/devices` call
- :art: Added dev dependancy
- :green_heart: Added pairing test script

Fixes
- :bug: Fix bug in pairing process for tv which do not have the `notifychange` endpoint
- :bug: Fixed issue where init of client would fail without credentials 

##### v0.1.1 Pairing restyle
New
- :rainbow: Temporary placeholder images
- :rainbow: Add driver image
- :rainbow: Add pairing page for verifying mac address and WOL capability
- :rainbow: New separate style file for pairing pages
- :art: Refactor ip address and api version to device settings
- :art: Restyle pairing start page and add descriptions of values
- :art: Add device settings configuration
- :arrow_up: Increase app version
- :memo: Add more translations for pairing process

Fixes
- :bug: Remove unused and missing require statements
- :fire: Removed obsolete dependancies

##### v0.1.0 Initial version
Initial version of the app which can turn TV on and off and supports pairing.