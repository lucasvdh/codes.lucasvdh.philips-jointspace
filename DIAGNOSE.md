# Generating a diagnostic report

When something doesn't work and you want to report it, please attach a
diagnostic report. It captures the TV's API capabilities, the app's
cached state, and the result of every probe we run, so we can triage
without a back-and-forth asking for details.

There are two ways to generate one. Pick whichever matches your situation.

## Option A: in the Homey app (recommended)

Use this when the TV is already paired with Homey, even if it's currently
misbehaving or marked unavailable.

1. Open the Homey mobile app or the web app.
2. Go to **More** → **Apps** → **Philips TV** → **Settings**.
3. If you have multiple Philips TVs, pick the one with the problem from
   the dropdown.
4. Click **Generate report**. It takes about five seconds.
5. Click **Copy to clipboard**.
6. Paste the report into a [new GitHub issue](https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues/new).

## Option B: standalone script (for pairing issues)

Use this when the TV won't pair at all, so option A isn't available yet.
You'll need Node.js 18 or newer installed on your computer. The computer
needs to be on the same Wi-Fi/LAN as the TV.

1. [Install Node.js](https://nodejs.org) if you don't have it. The LTS
   version is fine.
2. Download
   [`scripts/diagnose.mjs`](scripts/diagnose.mjs) from this repository.
3. Open a terminal in the folder where you saved it.
4. Run:
   ```
   node diagnose.mjs <your-tv-ip>
   ```
   For example: `node diagnose.mjs 192.168.1.42`
5. Copy the entire output and paste it into a
   [new GitHub issue](https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues/new).

You can also write it to a file with `node diagnose.mjs 192.168.1.42 > report.md`
and attach the file instead.

## What's in the report

- **Identification**: TV model, firmware version, API version, OS type
  (Android vs Saphi vs legacy), pairing type.
- **Device snapshot** (option A only): the settings and store values
  the app has cached, plus the current value of every capability.
- **Probe results**: each Jointspace endpoint we touch, with its HTTP
  status, response time and a preview of the body.
- **Discovery results** (option A only): how many TVs the SSDP and mDNS
  discovery strategies have currently found.
- **Raw JSON appendix**: a machine-parseable copy of everything above.

## Privacy

The report contains your TV's local IP address, MAC address and (on
some firmwares) an encrypted serial number. These are only useful on
your home network, so there's no security risk to sharing them publicly.
We left them in by default because they help us reproduce networking
edge cases. If you'd rather strip them, just edit the text after pasting.

The report does **not** include the pairing credentials (the digest
username / password your Homey uses to talk to the TV). Those stay
on your Homey.
