---
description: Welcome to the feature page of the Homey Philips TV app!
---

# Features

This app was developed to bring your Philips TV into the smart home ecosystem of Homey. With this app, you can control your TV, automate it, and have it trigger events in your home.

Below is the current set of Flow cards, capabilities and integrations the app exposes. If you're looking for the pairing walkthrough, see the [Pairing guide](../guides/pairing.md).

## Flow cards

Flow cards are the core building block of Homey automation. A Flow consists of cards in three columns: _when_, _and_, _then_. The Philips TV app provides Flow **triggers** ("when") and **actions** ("then"). Conditions ("and") are provided automatically by Homey from the device's capabilities - see [Capabilities](#capabilities) below for the full list of state you can test in a Flow.

### Triggers

These cards fire when something changes on the TV.

{% hint style="info" %}
When "**An app was opened**" then "Dim the lights".
{% endhint %}

<table data-view="cards"><thead><tr><th></th><th></th></tr></thead><tbody><tr><td><strong>An app was opened</strong></td><td>Fires whenever a new app comes to the foreground. The opened app's name is exposed as a Flow token.</td></tr><tr><td><strong>A specific app was opened</strong></td><td>Same as above but pre-filtered, so the Flow only runs when the chosen app opens.</td></tr><tr><td><strong>AmbiHue changed</strong></td><td>Fires when the Ambilight + Hue integration is switched on or off.</td></tr><tr><td><strong>Ambilight changed</strong></td><td>Fires when Ambilight itself is switched on or off.</td></tr><tr><td><strong>Ambilight mode changed</strong></td><td>Fires when the Ambilight mode changes (Standard, Lounge, Game, …).</td></tr><tr><td><strong>Source changed</strong></td><td>Fires when the current input source changes (HDMI 1, HDMI 2, …). On supported TVs only.</td></tr><tr><td><strong>Screen turned on or off</strong></td><td>Fires when the screen-off state changes - this is independent of the TV's main power on supported models. On supported TVs only.</td></tr></tbody></table>

### Actions

These cards change something on the TV.

{% hint style="info" %}
When "Someone arrives at home" then "**Turn on**" and "**Open application Spotify**".
{% endhint %}

<table data-view="cards"><thead><tr><th></th><th></th></tr></thead><tbody><tr><td><strong>Open an application</strong></td><td>Open any installed app on the TV. The autocomplete is filled from the TV's actual app list, so each TV shows its own installed apps.</td></tr><tr><td><strong>Open Google Assistant</strong></td><td>Open Google Assistant with a query or command. Android TVs only.</td></tr><tr><td><strong>Select a source</strong></td><td>Switch to an input source (HDMI 1, HDMI 2, …). Uses the proper source endpoint on legacy TVs and falls back to a Google Assistant search on Android TVs that don't expose <code>/sources</code>.</td></tr><tr><td><strong>Send a key</strong></td><td>Simulate any remote-control key press.</td></tr><tr><td><strong>Set AmbiHue state</strong></td><td>Turn Ambilight + Hue on or off.</td></tr><tr><td><strong>Turn Ambilight on/off</strong></td><td>Switch Ambilight itself on or off.</td></tr><tr><td><strong>Set Ambilight mode</strong></td><td>Switch Ambilight between Standard, Lounge, Game and other modes.</td></tr><tr><td><strong>Switch to channel</strong></td><td>Switch to a specific channel. The autocomplete is filled from the TV's channel list.</td></tr><tr><td><strong>Turn the screen on</strong></td><td>Turn the screen on while audio keeps playing. On supported TVs only.</td></tr><tr><td><strong>Turn the screen off</strong></td><td>Turn the screen off while audio keeps playing. On supported TVs only.</td></tr></tbody></table>

{% hint style="info" %}
Common operations like power on/off, mute, volume up/down, channel up/down and the media-transport keys (play, pause, stop, next, previous, fast-forward, rewind) are exposed as <a href="#capabilities">capabilities</a> rather than dedicated Flow actions. You can use them in a Flow via the device's auto-generated "Turn this device on/off" / "Set capability" cards.
{% endhint %}

## Capabilities

Capabilities are what Homey uses to represent the state of the TV. They show up automatically in the Flow editor as "when capability changes" triggers and "set capability" actions, and the Homey UI uses them to draw controls on the device card.

### State

<table data-view="cards"><thead><tr><th></th><th></th></tr></thead><tbody><tr><td><strong>On / off</strong></td><td>Power state. Powering on uses Wake-on-LAN when the MAC is known; otherwise the standard power endpoint.</td></tr><tr><td><strong>Volume</strong></td><td>Numeric slider plus volume-up / volume-down / mute toggles.</td></tr><tr><td><strong>Ambilight on/off</strong></td><td>Read and write.</td></tr><tr><td><strong>AmbiHue on/off</strong></td><td>Read and write.</td></tr><tr><td><strong>Ambilight mode</strong></td><td>Read and write the active mode.</td></tr><tr><td><strong>Current app</strong></td><td>Read-only; reflects the foreground app's name. Cleared when the TV goes into standby.</td></tr><tr><td><strong>Current source</strong></td><td>Read-only; reflects the current input source. On supported TVs only.</td></tr><tr><td><strong>Screen on/off</strong></td><td>Toggle the screen independently of TV power. On supported TVs only.</td></tr></tbody></table>

### Remote-control keys

Every key on a Philips remote is exposed as a capability (`key_play`, `key_pause`, `key_stop`, the four arrows, the digit keys 0–9, the colour keys, `key_home`, `key_back`, `key_options`, …). They appear in the Flow editor as one card per key, so any remote action you can do by hand you can do from a Flow.

If you need a key that isn't exposed as a dedicated capability, the **Send a key** Flow action lets you pick any TV key from the full list.

## Discovery and pairing

The app discovers Philips TVs on your network via two protocols:

- **SSDP** for older models that announce themselves as a UPnP `MediaRenderer:3`
- **mDNS** (`_philipstv_s_rpc._tcp`) for modern Android-based Philips TVs

Both lists are merged and deduplicated by IP before being shown. If discovery doesn't find your TV, the pairing wizard lets you add it by IP address as a fallback.

When pairing succeeds the app stores a TV-stable canonical identifier (hardware serial, the encrypted serial blob exposed by newer firmwares, the SSDP USN UUID, or as a last resort the mDNS service name) - never the IP address. This means later DHCP changes don't create duplicate devices, and the **Repair** flow can re-link an existing device to a TV at a new IP without losing your Flow references.

## Diagnostics

The app's settings page hosts a diagnostic-report generator that probes every Jointspace endpoint the app uses, captures a snapshot of device state and produces a Markdown report you can paste into a GitHub issue. Reports run in the background with live progress updates and a 120-second watchdog, so even slow or partially-unreachable TVs produce a usable report.

There's also an "Probe by IP" mode for situations where the TV refuses to pair: it runs the unauthenticated subset of probes (just the `/system` endpoint on HTTP and HTTPS) against an IP address you type in.
