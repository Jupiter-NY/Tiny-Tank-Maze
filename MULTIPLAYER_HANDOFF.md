# Multiplayer handoff for Nolan and AI collaborators

> The reliability work described below is the v5.8.1 baseline. This branch additionally contains a separate v5.8.2 fog optimization; see [FOG_PERFORMANCE.md](FOG_PERFORMANCE.md) for that follow-up. Its performance changes do not alter the server or networking settings.

Date: September 6, 2026. Prepared with Codex at Nolan's parent's request.

**Purpose:** fix confirmed multiplayer reliability bugs while preserving the rendering and networking behavior Nolan had just worked on. The separate stutter investigation below did not result in performance changes.

Starting source: `server` branch, commit `5e9646f43a13170dc5f40eff67d2eb0b064450ef`, client v5.8.0. The fixes are isolated on `fix/multiplayer-reliability`, client v5.8.1. This branch is a review candidate, not a production release. It has not been merged into `server` or deployed to Vercel/Render as part of this work.

## What changed and why

### Socket errors no longer crash the whole server

`server/server.js` now attaches a socket `error` handler before checking the browser origin. A malformed WebSocket connection is terminated individually. Cleanup still happens through the existing close handler. This handles the specific connection error rather than suppressing unrelated process-level exceptions.

The regression test sends a protocol-invalid frame only to a temporary localhost server and verifies that two other players keep receiving snapshots and a ping response, with their room intact.

### Grenade outcomes include every victim, and finished rounds stay finished

A grenade applies its entire blast before checking the winner. If the final two tanks die together, the result is a draw. The client now displays **Draw** for a null winner. Ordinary lethal bullets still end the round immediately. Once a result is announced, later bullets/grenades in that server tick stop processing so they cannot kill the announced winner afterward.

Tests cover draws, a surviving winner, kill credit, normal lethal hits, and later projectiles in the same tick.

### Disconnects return the player to a usable room-entry screen

The client clears old room, held-key, queued-shot, rendering, and connection-timing state, shows a visible recovery message, and enables CREATE/JOIN. The player name and last room code are preserved. Events arriving late from a replaced socket cannot reset a newer connection.

This supports creating or joining a room again. It does not add re-entry to an already-running match; that restriction is unchanged. Tests cover disconnects in the lobby, gameplay and results screens, reconnecting and starting again, stale socket callbacks, and failed initial connections.

### Positions outside the map and gross movement abuse are rejected

The server now checks playable bounds and destination wall collisions before accepting a reported position. A server-time movement budget allows up to 185 pixels/second (the normal client moves at 165) with one 32-pixel burst allowance. Unused allowance is capped and consumed, so repeatedly sending packets cannot mint fresh slack. Client timestamps do not grant extra movement credit.

Elapsed time during a network gap is retained so a valid later position can catch up. The old straight-line wall-path check was deliberately not restored: two valid samples around a corner may have a straight chord that intersects a wall.

**Limit:** these checks prevent the reproduced out-of-map jump and gross excessive movement; they are not complete anti-cheat. The browser still supplies its position, and a short wall crossing within the movement budget can remain possible. Complete authoritative movement or maze-route validation is a separate design task. Do not replace this qualification with a claim that all teleport/wall cheats are solved.

Tests cover normal movement at several update rates, packet spam, out-of-bounds/wall/nonfinite positions, idle credit, catch-up after a 1.5-second network gap, valid corner turns, and new-round resets.

### Version and test entry points

The runtime label and `multiplayer.html` script cache key are v5.8.1. The earlier missing `buildVisibilityPolygon()` startup function had already been fixed by Nolan and was retained.

From a fresh checkout with Node 20 or newer:

```sh
cd server
npm install
npm test
```

The current regression suite contains 22 passing tests. It uses Node's built-in test runner and the existing server dependencies; no test framework or new production dependency was added. Tests use isolated logic evaluation or temporary localhost servers and clean up afterward.

Additional local checks passed against the patched files: two real Chrome contexts created/joined/started a match and moved, then both recovered visibly after the test server stopped. After restarting the server, the same browser pages created/joined/started a new match and moved without reloading or logging browser errors. A separate two-client protocol check passed firing, grenade use, host transfer and room cleanup. These checks used localhost only; they are not a full human match or validation of real internet latency.

Source files: `server/server.js`, `multiplayer.js`, `multiplayer.html`.
Tests: `server/tests/reliability.test.cjs`, `server/tests/movement.test.cjs`, `tests/client-recovery.test.cjs`.

## Stuttering / 卡顿: observations, not an optimization patch

The fog calculation is a concrete profiling candidate. In the original v5.8.0 code, each draw casts roughly 4,100 rays against about 650 wall segments: approximately **2.6–2.7 million intersection checks per frame**. An isolated Node benchmark of the unchanged geometry on an Apple M4 measured **9.6–11.7 ms median**, before Canvas drawing and other browser work. A 60 fps frame has about 16.7 ms total. This is not a browser frame-rate measurement or proof of the cause on Nolan's device.

Network timing can look different: opponents use 20 Hz snapshots, a 100–180 ms interpolation buffer, and no extrapolation. Delayed snapshots can make opponents pause while the local tank still feels responsive. Projectiles also use snapshot positions. The 220 ms stale-input rule is unchanged. No claim was established about Render's plan, region, or load causing the stutter.

Useful next observation: does the whole scene/local tank hitch, or only the other tank/projectiles? Profile browser frame time and network delay separately before changing anything. Preserve the existing wall-blocking fog and corner/latency tests in any future optimization.

**Deliberately unchanged:** fog geometry, ray count, Canvas rendering, movement speed, snapshot/tick rates, interpolation/extrapolation settings, and stale-input thresholds. The movement validation above is a bounded correctness change, not a latency treatment.

## Before a release

- Play together on two devices: start, move around corners, shoot, use grenades, finish/rematch, and disconnect/reconnect. Local automation cannot establish performance over the actual internet connection.
- Deploy the corresponding backend changes to Render and frontend changes to Vercel when a release is authorized. Only publishing the browser files will not fix the server issues.
- The parent's current Vercel workflow stages browser assets manually. Its packaging list needs both `multiplayer.html` and `multiplayer.js` before a multiplayer release; that deployment tooling is outside this repository and was not changed here.
- At this handoff, multiplayer lives on `server`; the default `main` contains a different frontend. Choose the intended source explicitly rather than assuming `main` has these fixes.

The known-good review baseline is the starting commit above. Keep these fixes separate from future performance experiments so each can be reviewed, tested, and reverted independently.
