# Generating a diagnostic report

When something doesn't work and you want to report it, please attach a
diagnostic report. It captures the TV's API capabilities, the app's
cached state, and the result of every probe we run, so we can triage
without a back-and-forth asking for details.

There are two ways to generate one. Pick whichever matches your situation.

## Option A: in the Homey app (recommended)

Open the Homey mobile or web app, go to
**More** → **Apps** → **Philips TV** → **Settings**. There are two tabs:

**Paired device**: use this when the TV is paired with Homey, even if it's
currently misbehaving or marked unavailable.

1. Pick the TV from the dropdown.
2. Click **Generate report**. Takes about five seconds.
3. Click **Copy to clipboard** and paste into a
   [new GitHub issue](https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues/new).

**By IP address**: use this when the TV won't pair or wasn't discovered,
so there's nothing to pick from the dropdown. Only the unauthenticated
endpoints are probed; the report is shorter but still tells us whether
your TV speaks Jointspace and which API version it advertises.

1. Switch to the **By IP address** tab.
2. Enter the TV's IP address.
3. Click **Probe IP**, then **Copy to clipboard** and paste into a
   [new GitHub issue](https://github.com/lucasvdh/codes.lucasvdh.philips-jointspace/issues/new).

## Option B: standalone script (no Homey required)

Use this if you can't get to the Homey app for some reason, or if you want
to probe a TV that Homey can't reach but your computer can.
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

## Known TV firmware limitations

These are not bugs in the app and we cannot fix them from our side.
They show up in reports of "device temporarily unavailable", flaky
control, or pair / repair failures.

### 2018-era Android TVs (MSAF) serve only a subset of endpoints over HTTP/1925

On firmwares like TPM191E or similar 2018+ Android stacks, port 1925
only exposes `/system` and `/notifychange`. Everything else
(`powerstate`, `audio/volume`, `applications`, `sources`,
`channeldb/tv`, `pair/request`, ...) lives behind HTTPS on port 1926.
This is documented across multiple third-party Jointspace projects
(see [pylips issue #24](https://github.com/eslavnov/pylips/issues/24)).

On non-MSAF firmwares the app will fall back from a dead HTTPS service
to HTTP/1925, where most endpoints still answer. On MSAF the app
**does not fall back** - HTTP/1925 there would only produce 404s for
every authenticated endpoint, which is worse than an honest "TV
unreachable". When HTTPS is dead on MSAF the device is marked
unreachable until HTTPS recovers (typically after a TV reboot - see
the next section).

### HTTPS server "force-close" cascade on Restlet firmware

On Android-XTV (MSAF\_\*) firmware the HTTPS server uses a patched
Restlet NIO stack that force-closes any connection it can't drain - a
Philips workaround for an upstream Restlet CPU-consumption bug. Each
force-closed connection leaks a file descriptor on the TV; after ~15
the HTTPS accept-queue saturates and **HTTPS/1926 stops accepting any
new connections until the TV is power-cycled**.

Symptoms:

- Commands time out after ~10–20 seconds with `OfflineError: TV
  connection timed out` while HTTP/1925 (status / notify) still
  responds.
- The TV's official remote app eventually breaks too if the cascade
  fully fills the FD pool.
- A reboot fixes it for a while, then the cascade rebuilds.

The trigger that the app was unknowingly hitting before v3.5.0: Philips'
Restlet binds the digest auth challenge state to the TCP socket. The
401-challenge + auth-retry handshake **must** travel over a single
socket; otherwise the second request lands on a fresh TCP session for
which Restlet has no challenge state and RSTs it within ~64 ms -
each RST leaking another FD. This isn't documented in the
jointspace / reverse-engineering community as far as we've found.

From v3.5.0 onwards the app reuses one TCP socket per digest sequence
and serialises HTTPS requests, which avoids triggering the bug.
Earlier versions of the TS rewrite did not, which is why the cascade
showed up much more in those releases. If your firmware has the
underlying CPU-consumption regression you can still see the cascade
from other clients (official remote, third-party libs that don't
pool sockets) - power-cycle the TV to recover.

If you're on the latest version and still seeing the cascade - i.e.
HTTPS becomes unreachable within minutes of the app starting - please
file a report. The diagnostic tooling for this lives in
[`docs/development/restlet-quirks.md`](docs/development/restlet-quirks.md):
the `scripts/xtv-status.sh` script (requires `adb connect <tv-ip>:5555`)
reports the live socket state and any `FZAmit: Closing the connection
forcefully` lines from the TV's logcat. Attach its output to your
issue.

### Ethernet is often more reliable than Wi-Fi

For some Philips firmwares the HTTPS service only binds correctly to
the Ethernet interface, or behaves more stably there than on Wi-Fi.
If your TV supports both and you're seeing intermittent control over
Wi-Fi, try connecting it to your network with a cable; the difference
can be significant.

### Concurrent pairing attempts can lock up the HTTPS service

Repeatedly sending `pair/request` to the TV in quick succession
(more than the TV's pair-session limit, usually 60 seconds apart) can
deadlock the HTTPS daemon on some firmwares. If you've been retrying
pairing several times and the TV's HTTPS is now stuck, power-cycle
the TV to clear the pair sessions and try again.
