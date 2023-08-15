---
description: Welcome to the feature page of the Homey Philips TV app!
---

# Features

This app was developed to bring your Philips TV into the smart home ecosystem of Homey. With this app, you can control your TV, automate it, and even have it trigger events in your home.&#x20;

This page will give you a detailed overview of all the features currently provided by the Homey Philips TV app, and how you can use them to create a smart and connected home. Whether you want to turn your TV on and off automatically, adjust the volume based on the time of day, or change the channel based on your mood, the Homey Philips TV app has got you covered.

## Flow cards

Flow cards are on of the core feature on which Homey relies. With Flow cards, Homey users can automate their home. A Flow is a series of _Flow cards_, which are evaluated and executed.&#x20;

A Flow consists of cards in three columns: _when_, _and_, _then_. The Homey Philips TV app provides Flow cards in each of these categories which are listed below. So, dive in and discover the full range of flow features available to you!

**Triggers**

These cards are used to trigger flows.

{% hint style="info" %}
When "**TV is turned on**" then "Dim the lights".
{% endhint %}

<table data-view="cards"><thead><tr><th></th><th></th></tr></thead><tbody><tr><td><strong>Turned on</strong></td><td>This is triggered when your TV powers on.</td></tr><tr><td><strong>Turned off</strong></td><td>This is triggered when your TV powers off.</td></tr><tr><td><strong>Volume changed</strong></td><td>This is triggered when the volume has changed.</td></tr><tr><td><strong>Started playing</strong></td><td>This is triggered when something starts playing.</td></tr><tr><td><strong>Stopped playing</strong></td><td>This is triggered when the playing stops.</td></tr><tr><td><strong>An app was opened</strong></td><td>This is triggered when an app was opened.</td></tr><tr><td><strong>AmbiHue on/off changed</strong></td><td>This is triggered when the Ambilight + Hue integration is turned on/off.</td></tr><tr><td><strong>Ambilight on/off changed</strong></td><td>This is triggered when Ambilight is turned on/off.</td></tr><tr><td><strong>Ambilight mode changed</strong></td><td>This is triggered when the Ambilight mode has changed.</td></tr></tbody></table>

#### Conditions

These cards are used in flows as a condition.

{% hint style="info" %}
When "Nobody home" and "**TV is turned on**" then "Turn off TV".
{% endhint %}

<table data-view="cards"><thead><tr><th></th><th></th></tr></thead><tbody><tr><td><strong>Is turned on</strong></td><td>Returns if the TV is powered on.</td></tr><tr><td><strong>Is playing</strong></td><td>Returns if something is playing on the TV.</td></tr><tr><td><strong>Ambilight mode</strong></td><td>Returns the current ambilight mode</td></tr><tr><td><strong>Current app</strong></td><td>Returns the current app opened on the TV.</td></tr></tbody></table>

#### Actions

These cards are used as an action in a flow.

{% hint style="info" %}
When "Someone arrives at home" then "**Turn on TV**" and "**Open app Spotify**".
{% endhint %}

<table data-view="cards"><thead><tr><th></th><th></th></tr></thead><tbody><tr><td><strong>Turn on</strong></td><td></td></tr><tr><td><strong>Turn off</strong></td><td></td></tr><tr><td><strong>Toggle on/off</strong></td><td></td></tr><tr><td><strong>Turn the volume up</strong></td><td></td></tr><tr><td><strong>Turn the volume down</strong></td><td></td></tr><tr><td><strong>Mute the volume</strong></td><td></td></tr><tr><td><strong>Unmute the volume</strong></td><td></td></tr><tr><td><strong>Toggle muted volume</strong></td><td></td></tr><tr><td><strong>One channel up</strong></td><td></td></tr><tr><td><strong>One channel down</strong></td><td></td></tr><tr><td><strong>Set volume to</strong></td><td></td></tr><tr><td><strong>Set relative volume</strong></td><td></td></tr><tr><td><strong>Next</strong></td><td></td></tr><tr><td><strong>Previous</strong></td><td></td></tr><tr><td><strong>Play</strong></td><td></td></tr><tr><td><strong>Pause</strong></td><td></td></tr><tr><td><strong>Toggle play/pause</strong></td><td></td></tr><tr><td><strong>Open app</strong></td><td>Open any app installed on the TV. Only works for Android TVs.</td></tr><tr><td><strong>Turn AmbiHue on/off</strong></td><td></td></tr><tr><td><strong>Turn Ambilight on/off</strong></td><td></td></tr><tr><td><strong>Select source</strong></td><td></td></tr><tr><td><strong>Send key</strong></td><td>Select any key on your remote and simulate a key press.</td></tr><tr><td><strong>Open Google Assistant</strong></td><td>Open Google Assitant with a question or action you want it to respond to.</td></tr></tbody></table>

