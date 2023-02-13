# FAQ

## Is this an official app?

This Homey Philips App is in no way affiliated to Philips or TP Vision.

It has been made thanks to the effort of a lot of people reverse engineering the Jointspace API.

## How does the app work?

The Philips TV Homey app uses the Jointspace API to control your TV.

## Will this app work with my TV?

Most Philips TVs will be supported by this app. It has been confirmed to work on models from \~2014 up until 2022.

## How can I verify myself if my TV is supported by this app?

If you want to verify for yourself if this app will work with your TV, you can check if the Jointspace API is enabled for your device.

Go to the following url in your browser:

```uri
http://192.168.1.10:1925/system
```

{% hint style="info" %}
Change the IP `192.168.1.10` to the IP address your TV.
{% endhint %}

{% hint style="info" %}
Please note that for this to work the device which you are using to test this should be on the same network as your TV.
{% endhint %}

If this gives you a JSON response like the one below, you're in luck and the app will most likely work for you!

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

## Incorrect pincode?

If you are you experiencing issues while trying to pair your TV with a pincode this will most likely be a bug or a missing edge-case. There is however a change that your TV is not supported.

Due to the fact of how this app was made, by reverse engineering the Jointspace API, it's difficult to take every model TV into account. There may be some Philips TV models which this app does support.&#x20;

Because there is no official documentation and nobody in the community has been able to get into contact with developers at TP Vision (Producer of Philips TVs) it's not likely that there will ever be a fix.

That said, if you [are able to verify that your TV supports the Jointspace API](faq.md#how-can-i-verify-myself-if-my-tv-is-supported-by-this-app), please submit a bug report on Github.

<table data-view="cards"><thead><tr><th></th><th data-type="content-ref"></th><th data-hidden data-card-target data-type="content-ref"></th><th data-hidden data-card-cover data-type="files"></th></tr></thead><tbody><tr><td>Open new issue on Github</td><td><a href="https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues">https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues</a></td><td><a href="https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues">https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues</a></td><td><a href="../.gitbook/assets/github.png">github.png</a></td></tr></tbody></table>
