---
description: Welcome to the changelog overview for the Homey Philips TV app!
---

# Changelog

Here, you'll find a list of meaningful changes made to the app, with the most recent at the top. For the short user-facing summaries that show in the Homey App Store, see [`.homeychangelog.json`](https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/blob/beta/.homeychangelog.json) in the repo.

<details>

<summary>v3.7.0 - 2026-05</summary>

#### Improvements

* Diagnostic report now runs in the background. Progress streams to the settings page over realtime events, slow TVs no longer cause the report to time out, and the `notifyChange` long-poll gets a real 30 s window to confirm whether the TV supports it.

</details>

<details>

<summary>v3.6.0</summary>

#### Features

* App icons now show up next to each app in the **Open an application** Flow card autocomplete.
* New Flow cards: **Turn screen on**, **Turn screen off**, **A specific app was opened** (pre-filtered), **Screen turned on or off**, **Source changed**.
* `current_source` capability and **Source changed** trigger for TVs that expose `/sources/current`.

</details>

<details>

<summary>v3.5.2</summary>

#### Fixes

* Added missing argument labels to Flow actions so each field in the editor now shows a translated name (App, Source, Channel, …) instead of its internal id.

</details>

<details>

<summary>v3.5.0</summary>

#### Stability

* Major stability work on TVs running Philips' Restlet-based HTTPS server (mostly Android-XTV / MSAF firmware). The TV's HTTPS service used to "saturate and die" after a handful of requests; now it stays healthy through sustained polling. Background details for developers in [`docs/development/restlet-quirks.md`](../development/restlet-quirks.md).
* Devices stay marked **available** in Homey more consistently - explicit availability signals replace the previous heuristic that flipped on every transient `notifyChange` reset.

#### Features

* Verbose per-request and per-poll-cycle logging, gated by `env.DEBUG`. Bug reports can be diagnosed from the logs alone.
* Canonical device IDs: new pairings now use a TV-stable identifier (hardware serial or its encrypted form) instead of the SSDP USN or IP. Existing devices are migrated transparently in the background.

#### Fixes

* `screenstate` set requests use the correct `On`/`Off` values (some firmwares previously got `screenOn`/`screenOff`, which silently no-op'd).

</details>

<details>

<summary>v3.4.0</summary>

#### Features

* **Repair** flow: re-link an existing paired device to a TV at a new IP or with new credentials, without losing the device's identity in Homey (so Flows that reference the device keep working).
* Transport self-correction: if a TV advertises HTTPS support but its HTTPS server stops responding mid-session, the app falls back to HTTP/1925 within a minute instead of waiting for the hourly probe.
* **Probe by IP** mode added to the in-app diagnostic report, for "my TV won't pair" issues where there isn't a paired device yet.
* New developer scripts for authenticated probing from a workstation (`scripts/diagnose-auth.mjs`, `scripts/diagnose-curl.sh`).

</details>

<details>

<summary>v3.3.0</summary>

#### Features

* Diagnostic report generator in the app settings page. Probes every Jointspace endpoint the app uses, looks up the TV's MAC via ARP, and produces a Markdown report you can paste into a GitHub issue.

</details>

<details>

<summary>v3.2.0</summary>

#### Features

* Optional **screen on/off** toggle on TVs that support `/screenstate`. Lets you turn the screen off while audio keeps playing. Conditionally added per device - TVs that don't support it never see the toggle.

</details>

<details>

<summary>v3.1.1</summary>

#### Fixes

* Pairing on TVs that only expose the `/system` endpoint over HTTPS (some 8546-series models): `getSystem()` retries on HTTPS/1926 when the HTTP/1925 response is empty.
* `current_application` capability is cleared when the TV powers off, so Flow conditions like "current app is Netflix" don't keep matching after the TV is in standby.

</details>

<details>

<summary>v3.1.0</summary>

#### Features

* Channel switching: new **Switch to channel** Flow action with autocomplete from the TV's actual channel list.
* Proper source switching on legacy TVs: **Select a source** uses the real `/sources/current` endpoint first and only falls back to a Google Assistant search if that fails (Android TVs).
* Persistent per-device store caches `osType`, `notifyChange` support and the last-set Ambilight mode across restarts.
* Hourly system re-probe picks up firmware-level endpoint changes without a re-pair.

#### Stability

* New `CachedDigestAuth` cuts authenticated request volume roughly in half by caching the digest challenge between requests.
* Quieter offline logging: one line on the reachable → unreachable transition, one on recovery, silent in between.
* Ambilight-mode quirk on MSAF/Linux firmware: the locally-set mode is preferred over the TV-reported mode until the TV catches up.

</details>

<details>

<summary>v3.0.0 - major rewrite</summary>

#### Highlights

* Fixes the long-standing "app stops responding after a while" cluster. The pre-3.0 version imported `setTimeout` from `timers/promises` (the Promise variant) and then called it callback-style at three sites - all three silently no-op'd, which killed the `notifyChange` retry loop on the first non-`ECONNRESET` error and never restarted it.
* **mDNS discovery** added for modern Android Philips TVs (`_philipstv_s_rpc._tcp.local.`), merged with existing SSDP results.
* Working `channel_up` / `channel_down` keys (declared but never wired up in earlier versions).
* More reliable power-on: hits the standard `powerstate` endpoint first; the ChromeCast trick is reserved as fallback.
* More reliable Ambilight-off: sends an `OFF`-style configuration as a backstop for MSAF firmwares that ignore `ambilight/power`.
* Pairing UX: specific error messages instead of generic failures, with the IP-entry view as the right return view after a manual-IP failure.

#### Removed

* `speaker_playing` capability removed - it never reflected real TV state.

#### Requirements

* Requires Homey firmware **v12.2** or newer. (Internally bumped to v12.9 in 3.7 to align with Node 22.)

#### Under the hood

* Full TypeScript rewrite of the driver and supporting code.
* Self-signed HTTPS certificates handled via `httpsAgent { rejectUnauthorized: false }`.
* Pairing body shape switched to `{ access: { scope }, device }` (matches ha-philipsjs / pylips; some firmwares reject the previous shape).
* JSON sanitisation for known broken Philips responses (`{,`, `,,`, `,}`).
* Defensive try/catch on the six remaining command paths (cluster B in the v2.x crash logs).

</details>

<details>

<summary>v2.5.0 - 2023-02-19</summary>

#### Features

* Added more translations to the pairing process (`de`, `fr`, `it`, `sv`, `no`, `es`, `da`, `pl`)
* Improved feedback in the pairing process and handling of more edge-cases
* Added a new "Open Google Assistant with \[input]" action

</details>

<details>

<summary>v2.4.2 - 2023-02-15</summary>

#### Fixes

* Fix getting the installed apps from the device for some already installed devices

</details>

<details>

<summary>v2.4.1 - 2023-02-14</summary>

#### Features

* Refactor pairing and settings to homey compose

#### Fixes

* Fix flow card actions
* Fix flow card triggers
* Fix flow card actions autocomplete

</details>

<details>

<summary>v2.4.0 - 2023-02-13</summary>

#### Features

* Homey SDK v3 upgrade to support the latest Homey models
* New pairing views that follow Homey design standard
* Automatically resolve TV settings such as Jointspace version and authentication method
* Manually add device by ip
* Add device discovery to pairing
* Add translations for `de`, `fr`, `it`, `sv`, `no`, `es`, `da` and `pl`
* Add new `set_ambilight_mode` capability

#### Fixes

* Fix (some) pincode submit errors

</details>
