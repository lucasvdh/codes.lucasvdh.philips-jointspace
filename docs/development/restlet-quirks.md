# Philips Restlet HTTPS quirks

This page documents firmware-level bugs in Philips' Jointspace HTTPS server
that this app has to work around. Read this before changing anything in
`jointspace-api.ts`, `cached-digest.ts`, or `state-poller.ts`, the obvious
"clean" approach will almost always make these TVs unreachable.

## TL;DR

- Philips' Jointspace server uses an old, patched Restlet NIO stack.
- It is **fragile** about HTTPS connection lifecycle: violate its assumptions
  and the entire HTTPS server saturates and dies until reboot.
- Use **`keepAlive: true, maxSockets: 1`** on the HTTPS agent. **Don't** send
  `Connection: close`. Serialise outgoing HTTPS requests through the mutex.
- On Android-XTV (`os_type` starting with `MSAF_`), avoid HTTPS polling and
  the `/screenstate` probe, `notifyChange` on HTTP/1925 covers state updates.

## The bugs

### 1. Digest auth nonce is bound to the TCP session

The TV's Restlet binds the digest auth challenge state to the **socket**, not
to the credentials. Doing the standard 401-challenge → auth-retry handshake
over **two separate TCP connections** causes the second request to be
RST-ed within 64 ms.

```
client A → TV: GET /6/applications                    (no auth)
TV → client A: 401 Unauthorized, WWW-Authenticate: Digest realm=… nonce=…
client A closes
client B → TV: GET /6/applications  Authorization: Digest …  ← TV: TCP RST
```

The pre-TS version of this app used `needle`, which by default reuses the
TCP socket for the auth retry. The TS port replaced that with axios, whose
default agent has `keepAlive: false`, every request opens a fresh socket.
Combined with `Connection: close`, that's two sockets for one digest
sequence and the TV refuses the second one.

**Fix:** `new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 1 })`.
This makes axios reuse the same TCP socket across sequential requests on
the same host. The HTTPS mutex (see below) serialises calls, so
`maxSockets: 1` doesn't actually limit throughput, it just prevents axios
from opening parallel sockets.

**Don't** add a `Connection: close` header. It forces socket close after
the 401, which re-introduces the two-socket case for the auth retry. (We
tried this, it produced exactly the symptom above.)

### 2. Restlet's `InboundWay.onFill` CPU-consumption loop

The TV's logcat contains lines like:

```
FZAmit: Closing the connection forcefully to fix Restlet CPU Consumption bug/192.168.1.x:NNNNN
```

This is a Philips-patched-in workaround (by an engineer named Amit) for an
upstream Restlet bug in `org.restlet.ext.nio.internal.way.InboundWay.onFill`
where the NIO read loop can spin on partial reads. The workaround
**force-closes the connection from the TV side**. Each force-closed
connection lingers in `CLOSE_WAIT` on the TV; after ~15 the HTTPS
accept-queue saturates and the entire HTTPS server stops accepting new
connections until the TV is rebooted.

Empirically, the workaround triggers on connections that **don't** use
keep-alive (so the same `keepAlive: true` setting fixes both bugs). It's
also triggered by clients with idle sockets that aren't actively reading;
keeping requests serial and short avoids that.

### 3. MSAF firmware: HTTP/1925 has only `/system`

On Android-XTV firmware (`os_type` like `MSAF_2018_O`), the unauthenticated
HTTP listener on port 1925 serves **only** `/system`. Every other path
returns 404. Authenticated endpoints (`/6/audio/volume`,
`/6/applications`, …) exist exclusively on HTTPS/1926.

This matters because our `verifyAdvertisedTransport` historically fell back
from a dead HTTPS server to HTTP/1925, turning 20 s timeouts into
404s, which is worse, not better. The MSAF branch in
`verifyAdvertisedTransport` (see `quirks.ts:osRequiresHttpsForAuthenticatedEndpoints`)
keeps `secure: true, port: 1926` even when HTTPS is unresponsive, so the
user sees an honest "TV unreachable" instead of confusing 404s.

### 4. notifyChange is not a complete substitute for polling

`notifyChange` (HTTP/1925 long-poll) returns a stream of state updates.
Empirically, on MSAF firmware **it doesn't fire for most state changes**.
Field observation from a live session: after the first cycle (which
returns powerstate + activities/current + several unhandled keys like
`context`, `network/devices`, `system/epgsource`), every subsequent
notify-cycle on MSAF returned **only `activities/current`**. Volume,
mute, ambilight, ambihue, screenstate changes never came through.

So treating notify as authoritative and disabling the poll cycle leaves
the entire device state stale except for the currently-running app.

The poller therefore stays on, on every firmware. Notify is the
fast-path for app-switch events; polling is the consistency net for
everything else (`osPollIntervalMs` decides cadence, currently 10 s
everywhere, with a TODO to lengthen MSAF once we've verified what's
truly notify-only).

`parseNotifyState` logs every notify cycle's handled/unhandled keys plus
the payload values, so you can audit exactly what the TV is telling us:

```
[poller] notifyChange returned: handled=[activities/current] unhandled=[]
[poller]   notify[activities/current] = {"component":{"packageName":"org.droidtv.playtv",…}}
```

If a state update you expected isn't in `handled=[…]`, the TV isn't
notifying about it on this firmware, polling will catch up within the
poll interval. `pollOnce` logs each fetched value too:

```
[poller]   poll[audio/volume] = {"muted":false,"current":31,"min":0,"max":60}
[poller]   poll[ambilight/currentconfiguration] = {"styleName":"FOLLOW_VIDEO",…}
```

### 5. Capability handler gates can swallow updates during startup

When a `handleXChange` handler depends on the value of another capability
(e.g. volume updates depend on `onoff` being truthy, see
`handleAudioChange`), be careful with the early-init window where the
gating capability is `null` (not-yet-observed). Treat `null` as "accept
the update" and only skip on confirmed-false. Otherwise the first poll's
authoritative reading gets dropped and the capability holds an outdated
default (`0` for numeric) until something else lands a non-null update.

This bit us once: `handleAudioChange` used `if (powerOn && …)` so a poll
that landed before powerstate notify silently failed to set the volume.

### 6. Per-endpoint failures must not invalidate the whole poll cycle

The Jointspace endpoint matrix varies per firmware: `/screenstate`,
`/sources/current`, and others are 404 on some TVs and 200 on others.
The poller's first version wrapped all four/five endpoint fetches in one
`try/catch`, so a 404 on the last step dropped state updates from the
first four and triggered `onPollFailure` ("TV unreachable") even though
the TV had just answered four other requests.

`pollOnce` therefore handles each step independently: a `NotFoundError`
(or any non-`OfflineError`) on one step logs `poll[<endpoint>] skipped:
…` and continues; only a real `OfflineError` aborts the cycle and fires
`onPollFailure`. `anySucceeded` controls availability so a single
working endpoint keeps the TV marked reachable.

If you add a new endpoint to the poll cycle, follow that pattern, never
add a fetch that can take the rest of the cycle down with it.

## What we kept after digest auth was fixed

After fixing bug #1, you might wonder whether all the MSAF-specific
workarounds are still needed. Short answer: **yes, most of them**.

| Mitigation | Keep? | Why |
|---|---|---|
| `keepAlive: true, maxSockets: 1` on httpsAgent | **Yes** | Core digest auth fix. Removing this breaks every authenticated call. |
| HTTPS request mutex (`httpsCallChain`) | **Yes** | Belt-and-braces with `maxSockets: 1`; also serialises tasks within the app to keep request order predictable. |
| Skip HTTP/1925 fallback on MSAF | **Yes** | HTTP/1925 doesn't expose authenticated endpoints on MSAF; falling back produces 404s, not recovery. |
| Skip `/screenstate` probe on MSAF | **Yes** | Endpoint doesn't exist there; probing only burns an HTTPS request. |
| `notifyOnlyMode` on MSAF (skip HTTPS poll cycle) | **Yes** | `notifyChange` covers every state the 4-call poll cycle reads (audio, ambihue, ambilight, powerstate). Polling adds load without new information. Less HTTPS traffic = lower chance of hitting bug #2. |
| `DEFAULT_TIMEOUT_MS: 10s` (was 20s) | **Yes** | Faster failure when HTTPS is genuinely dead; shorter mutex blocking. No downside on a healthy TV (real requests finish in <2s). |
| Remove `Connection: close` header | **Yes** | Required for the digest auth fix. See bug #1. |

So nothing structural was rolled back, but **none** of these is MSAF-only
speculation either: each addresses a documented symptom from real TV logs.

## Diagnostic tools

### `scripts/xtv-status.sh`

Requires `adb connect <tv-ip>:5555` first. Reports:

- Whether the `org.droidtv.xtv` process is alive (PID, RSS, threads)
- HTTP/1925 reachability + response time
- HTTPS/1926 reachability + response time
- Socket-state counts on both ports (`ESTABLISHED`, `CLOSE_WAIT`,
  pending accepts)
- Last 5 warnings/errors from the xtv service log

**Health signal:** HTTPS/1926 should be `200` and **`CLOSE_WAIT: 0`**.
Anything else means the TV is on the way to bug #2.

### Watching for live force-closes

```bash
adb -s <tv-ip>:5555 logcat | grep -E "FZAmit|CPU Consumption|<homey-ip>"
```

Each `FZAmit: Closing the connection forcefully` line is one FD leaked.
Whose connection is it? Look at the trailing `IP:PORT`, that's the
**remote** (client) side. If `<homey-ip>` appears, the app triggered bug
#2 with that connection.

### TV-side reboot via adb

The xtv service runs as `system` UID; the `adb shell` user can't kill it
selectively (`kill -9` and `am force-stop` both fail). The only soft
reset that works is a full TV reboot:

```bash
adb -s <tv-ip>:5555 reboot
```

Boot takes ~60 s. After that, `xtv-status.sh` should show
`CLOSE_WAIT: 0` and HTTPS/1926 → 200 again.

## How to validate changes to the HTTPS path

Any change touching `jointspace-api.ts`, `cached-digest.ts`, or the agent
configuration needs to survive this regression test on an MSAF TV:

1. `adb -s <tv-ip>:5555 reboot` and wait until `xtv-status.sh` reports
   `CLOSE_WAIT: 0` and HTTPS `200`.
2. Start a logcat tail filtered for `FZAmit|<homey-ip>` in a side terminal.
3. Restart the Homey app and pair / use the device.
4. Hit several commands (volume up/down, ambilight toggle, app change).
5. After 1–2 minutes of normal use, re-run `xtv-status.sh`.

**Pass:** `CLOSE_WAIT` stays at 0 or 1, no `FZAmit: ... forcefully` for the
Homey IP in logcat, all commands respond in <2 s.

**Fail:** `CLOSE_WAIT` climbs over time, force-close events for the Homey
IP, or commands start hanging. Revert and re-read this doc.
