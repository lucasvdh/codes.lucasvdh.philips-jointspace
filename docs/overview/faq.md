---
description: Welcome to the FAQ section for the Homey Philips TV app!
---

# FAQ

Here, you'll find answers to the most commonly asked questions about the app and how it works. Whether you're a new user or have been using the app for a while, this page is a great resource to get the information you need.&#x20;

If you can't find the answer you're looking for, feel free to submit a support ticket for further assistance.

<table data-card-size="large" data-view="cards"><thead><tr><th></th><th data-type="content-ref"></th><th data-hidden data-card-cover data-type="files"></th><th data-hidden data-card-target data-type="content-ref"></th></tr></thead><tbody><tr><td>Submit a support ticket on Github</td><td><a href="https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues/new?assignees=lucasvdh&#x26;labels=question&#x26;template=question.md&#x26;title=%5BQuestion%5D+">https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues/new?assignees=lucasvdh&#x26;labels=question&#x26;template=question.md&#x26;title=%5BQuestion%5D+</a></td><td><a href="../.gitbook/assets/github.png">github.png</a></td><td><a href="https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues/new?assignees=lucasvdh&#x26;labels=question&#x26;template=question.md&#x26;title=%5BQuestion%5D+">https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues/new?assignees=lucasvdh&#x26;labels=question&#x26;template=question.md&#x26;title=%5BQuestion%5D+</a></td></tr></tbody></table>

## Overview

* [Is this an official app?](faq.md#is-this-an-official-app)
* [How does the app work?](faq.md#how-does-the-app-work)
* [Will this app work with my TV?](faq.md#will-this-app-work-with-my-tv)
* [How can I verify if my TV is supported by this app?](faq.md#how-can-i-verify-if-my-tv-is-supported-by-this-app)
* [Why am I getting an incorrect pincode error?](faq.md#why-am-i-getting-an-incorrect-pincode-error)
* [Why is my TV not turning on?](faq.md#why-is-my-tv-not-turning-on)
* [My TV's IP changed and the device shows as unavailable](faq.md#my-tvs-ip-changed-and-the-device-shows-as-unavailable)
* [How do I report a problem?](faq.md#how-do-i-report-a-problem)



### Is this an official app?

No, the Philips TV app for Homey is not an official app and is in no way affiliated with Philips or TP Vision.&#x20;

It has been created through the dedicated efforts of a group of people who reverse engineered the Jointspace API. While we strive to offer a high-quality and functional app, we want to emphasize that it is not endorsed or supported by Philips or TP Vision.



### How does the app work?

The Homey Philips TV app operates through the use of the Jointspace API. The Jointspace API is a set of programming interfaces that allow developers to communicate with and control certain features of Philips Smart TVs.&#x20;

The Homey Philips TV app takes advantage of this API to provide users with a seamless integration between their Philips TV and the Homey platform. The Jointspace API is essential to the functioning of the Homey Philips TV app.



### Will this app work with my TV?

Most Philips TVs will be supported by this app. It has been confirmed to work on most models manufactured between \~2014 and 2025, both Saphi-based and Android-XTV (MSAF) firmwares.



### How can I verify if my TV is supported by this app?

To verify if your TV is supported by the Homey Philips TV app, you can check if the Jointspace API is enabled for your device. To do this, follow these steps:

1. Open a web browser on a device that is on the same network as your TV.
2. Go to the following url: `http://192.168.1.10:1925/system`
3. Verify if you get a JSON response

{% hint style="info" %}
Change the IP `192.168.1.10` to the IP address your TV.
{% endhint %}

If the page returns a JSON response like the one below, it means that the Jointspace API is enabled for your device and the app will likely work for you.

<details>

<summary>JSON Response Example</summary>

```json
{
  "notifyChange": "http",
  "menulanguage": "English",
  "name": "Philips TV",
  "country": "Netherlands",
  "serialnumber_encrypted": "eW91IGZvdW5kIG1lIQ==\n",
  "softwareversion_encrypted": "cXVpdGUgdGhlIG5vc2V5IG9uZSBhcmVuJ3QgeW91Pw==\n",
  "model_encrypted": "b2sgYWxtb3N0IGRvbmU=\n",
  "deviceid_encrypted": "ZmluYWwgb25lIQ==\n",
  "nettvversion": "8.0.2",
  "epgsource": "one",
  "api_version": {
    "Major": 6,
    "Minor": 1,
    "Patch": 0
  },
  ...
}
```

</details>



### Why am I getting an incorrect pincode error?

Pincode pairing issues can be a frustrating experience when using the Homey Philips TV app. The app was created through reverse engineering the Jointspace API, which can make it challenging to account for every model of Philips TV. While the app has been confirmed to work on many models manufactured between \~2014 and 2022, there may still be some models that it does not support.

Unfortunately, due to the lack of official documentation and the difficulty of getting in touch with TP Vision (the producer of Philips TVs), it is unlikely that these issues will ever be resolved. If you are experiencing problems while trying to pair your TV with a pincode, it is possible that you may have encountered a bug, but it is also possible that your TV is simply not supported by the app.

In either case, we apologize for any inconvenience and encourage you to reach out for further assistance if you are having difficulty.

If you [are able to verify that your TV supports the Jointspace API](faq.md#how-can-i-verify-myself-if-my-tv-is-supported-by-this-app), please submit a bug report on Github.

<table data-card-size="large" data-view="cards"><thead><tr><th></th><th data-type="content-ref"></th><th data-hidden data-card-target data-type="content-ref"></th><th data-hidden data-card-cover data-type="files"></th></tr></thead><tbody><tr><td>Submit a bug report on Github</td><td><a href="https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues">https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues</a></td><td><a href="https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues">https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues</a></td><td><a href="../.gitbook/assets/github.png">github.png</a></td></tr></tbody></table>



### Why is my TV not turning on?

The app first calls the standard `powerstate` endpoint to wake the TV. If that fails (because the TV has dropped its network stack to save power), it falls back to the ChromeCast trick. On TVs where Wake-on-LAN is supported and the MAC address is known, a magic packet is also sent.

In **deep sleep**, however, the TV may not be reachable over the network at all - none of the above can reach it. There is no permanent app-side solution for this; the TV has to keep its network stack alive.

#### Option 1 - Turn the screen off instead of the TV (recommended on supported models)

On TVs that expose the screen-off feature, the app exposes a separate **Screen on/off** capability and matching Flow actions. The TV stays fully online (so all other commands keep working) but the screen is off and consumes much less power than playback. This is the most reliable way to "switch the TV off" from a Flow without losing control of it.

#### Option 2 - Wakelock (Android TVs only)

The other workaround is installing the [Wakelock Revamp](https://github.com/d4rken-org/wakelock-revamp/releases/) app, which prevents the TV from going into deep sleep.

If you're not familiar with adb, you can install the Wakelock app with a USB drive:

1. [Download The Wakelock app from Github](https://github.com/d4rken-org/wakelock-revamp/releases/)
2. Store it on a thumb drive
3. Plug the thumb drive into your TV
4. Using a file manager app on your TV, open the `.apk` file

{% hint style="danger" %}
Wakelock keeps your TV reachable but increases standby power consumption.
{% endhint %}

### My TV's IP changed and the device shows as unavailable

If your TV got a new IP from your router, you don't need to remove and re-pair the device - that would lose all your Flow references. Use the **Repair** option instead:

1. Open the device in the Homey app.
2. Tap the overflow menu (three dots) → **Repair**.
3. The wizard runs the same discovery / IP-entry / authentication steps as a fresh pair, but applies the new IP and credentials to the existing device. Flows that reference the device keep working.

### How do I report a problem?

The app's settings page (in the Homey app, under **Settings → Apps → Philips TV**) has a built-in **Diagnostic report** generator. Pick your TV from the list, click **Generate report**, and paste the output into a new [GitHub issue](https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues). If the TV isn't paired yet, switch to the **By IP address** tab and run a probe against the TV's IP.

The report runs in the background with live progress updates, so even slow or partially-unreachable TVs eventually produce a usable report. Credentials and other secrets are automatically redacted.
