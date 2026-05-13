# State poller design

This doc captures the non-obvious decisions in `state-poller.ts` and the
`handleXChange` family in `device.ts`. Read it before touching the poll
cycle, the notifyChange loop, or any capability-update handler - the
patterns here were arrived at through symptoms that aren't visible from
the code alone.

For the HTTPS-server-side quirks that *constrain* the poller (digest
auth socket binding, Restlet `InboundWay` bug, MSAF endpoint subset),
see [`restlet-quirks.md`](./restlet-quirks.md).

## notifyChange is not a complete substitute for polling

`notifyChange` (HTTP/1925 long-poll) returns a stream of state updates.
Empirically, on MSAF firmware **it doesn't fire for most state
changes**. Field observation from a live session: after the first cycle
(which returns powerstate + activities/current + several unhandled keys
like `context`, `network/devices`, `system/epgsource`), every
subsequent notify-cycle on MSAF returned **only `activities/current`**.
Volume, mute, ambilight, ambihue, screenstate changes never came
through.

So treating notify as authoritative and disabling the poll cycle leaves
the entire device state stale except for the currently-running app.

The poller therefore stays on, on every firmware. Notify is the
fast-path for app-switch events; polling is the consistency net for
everything else. `osPollIntervalMs` decides cadence, currently 10 s
everywhere, with a TODO to lengthen MSAF once we've verified what's
truly notify-only.

`parseNotifyState` logs every notify cycle's handled/unhandled keys
plus the payload values, so you can audit exactly what the TV is
telling us:

```
[poller] notifyChange returned: handled=[activities/current] unhandled=[]
[poller]   notify[activities/current] = {"component":{"packageName":"org.droidtv.playtv",…}}
```

If a state update you expected isn't in `handled=[…]`, the TV isn't
notifying about it on this firmware; polling will catch up within the
poll interval. `pollOnce` logs each fetched value too:

```
[poller]   poll[audio/volume] = {"muted":false,"current":31,"min":0,"max":60}
[poller]   poll[ambilight/currentconfiguration] = {"styleName":"FOLLOW_VIDEO",…}
```

## Capability handler gates can swallow updates during startup

When a `handleXChange` handler depends on the value of another
capability (e.g. volume updates depend on `onoff` being truthy, see
`handleAudioChange`), be careful with the early-init window where the
gating capability is `null` (not-yet-observed). Treat `null` as "accept
the update" and only skip on confirmed-false. Otherwise the first
poll's authoritative reading gets dropped and the capability holds an
outdated default (`0` for numeric) until something else lands a
non-null update.

This bit us once: `handleAudioChange` used `if (powerOn && …)` so a
poll that landed before powerstate notify silently failed to set the
volume.

## Per-endpoint failures must not invalidate the whole poll cycle

The Jointspace endpoint matrix varies per firmware: `/screenstate`,
`/sources/current`, and others are 404 on some TVs and 200 on others.
The poller's first version wrapped all four/five endpoint fetches in
one `try/catch`, so a 404 on the last step dropped state updates from
the first four and triggered `onPollFailure` ("TV unreachable") even
though the TV had just answered four other requests.

`pollOnce` therefore handles each step independently: a `NotFoundError`
(or any non-`OfflineError`) on one step logs `poll[<endpoint>]
skipped: …` and continues; only a real `OfflineError` aborts the cycle
and fires `onPollFailure`. `anySucceeded` controls availability so a
single working endpoint keeps the TV marked reachable.

If you add a new endpoint to the poll cycle, follow that pattern -
never add a fetch that can take the rest of the cycle down with it.
