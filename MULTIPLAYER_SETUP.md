# Tiny Tank Maze Multiplayer Setup

The website and multiplayer server are deployed separately:

| Component | Existing destination | Purpose |
|---|---|---|
| Browser files | Vercel, `https://littletinygames.com` | Website, controls, local tank movement, and drawing |
| Multiplayer backend | Render, `https://tiny-tank-maze.onrender.com` | Rooms, maze generation, position validation, projectiles, damage, pickups, and match results |
| Classic/Infinite leaderboard | Existing Supabase project | Stores the separate single-player leaderboard |

The browser connects to `wss://tiny-tank-maze.onrender.com/ws`. The custom domain stays on Vercel; using Render for multiplayer does not require moving the website or changing its domain.

Use the repository's **`server` branch** as the multiplayer release source. The default `main` branch can contain a different frontend. The Vercel workflow stages browser assets manually; a GitHub push alone does not establish that the website has updated. Render's current deployment settings and deployed commit must also be checked separately.

This document describes the update procedure, **not confirmation that a particular commit is live**. See [MULTIPLAYER_HANDOFF.md](MULTIPLAYER_HANDOFF.md) for the reliability changes and known limits, and [FOG_PERFORMANCE.md](FOG_PERFORMANCE.md) for the separate fog optimization and its measurements.

## How multiplayer works

- Players create a private five-character room code or join a friend's room.
- Rooms support 2–8 players, host-started matches, and host-controlled rematches.
- The server generates the shared maze and controls bullets, grenades, damage, health, pickups, and results. A simultaneous final grenade elimination produces a draw.
- The browser simulates its displayed tank and sends `client_state` messages containing position, aim, sequence number, timestamp, and shooting state.
- The server checks playable bounds, destination wall collision, packet freshness, and a movement budget based on server time before accepting a position. It does **not** fully simulate authoritative movement from keyboard inputs.
- Ongoing snapshots filter opponents by vision radius and maze line of sight. However, the initial `game_start` message broadcasts all player spawn coordinates. This is not a claim that hidden positions are never transmitted.
- Disconnects show usable CREATE/JOIN controls again. Rejoining an already-running match is not supported.

Position checks limit gross excessive movement and out-of-map jumps, but are not complete anti-cheat: a short wall crossing within the movement budget can remain possible. The previous straight-line path rejection is intentionally absent because valid delayed samples around a corner can have a chord that crosses a wall.

## 1. Select and test the intended release

Start from the intended commit on `server` and record its full Git commit ID. Check the working tree before updating it so local work is preserved.

With Node 20 or newer, run:

```sh
cd server
npm install
npm test
```

The current suite has **29 tests**, covering connection errors, elimination outcomes, movement validation, reconnect recovery, and fog equivalence. Keep the test result associated with the exact source commit being released.

For a local two-browser check, start the server from `server/`:

```sh
ALLOWED_ORIGINS=http://localhost:8000 npm start
```

In an isolated local copy of the frontend, set only its multiplayer connection to:

```js
multiplayerServer: "ws://localhost:3000/ws",
```

Serve that copy from its root in another terminal:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000/multiplayer.html` in two browser windows, create/join a room, start, move around corners, fire, throw a grenade, finish/rematch, and disconnect/reconnect. Preserve the existing Supabase URL and publishable key. The release configuration must use the public `wss://` URL below, not the temporary localhost URL.

## 2. Update the existing Render service

Use the **existing** `tiny-tank-maze.onrender.com` service; do not create a duplicate service for this update.

In its dashboard, verify these settings rather than assuming they are already configured:

| Setting | Intended value |
|---|---|
| Repository | `Jupiter-NY/Tiny-Tank-Maze` |
| Branch | `server` |
| Root directory | `server` |
| Build command | `npm install` |
| Start command | `npm start` |

The server already listens on `0.0.0.0` and uses the hosting service's `PORT` environment variable. Check whether automatic deployments are enabled; otherwise deploy the selected commit manually through the existing service. Confirm that the deployment completed and that its **deployed commit ID matches the intended release**. A successful health response alone does not identify the deployed source version.

Verify `ALLOWED_ORIGINS` includes the website origins that will actually be used, for example:

```text
https://littletinygames.com,https://www.littletinygames.com
```

If intentionally supporting Nolan's GitHub Pages test site, add its origin `https://jupiter-ny.github.io` as well. An origin has no repository path. Vercel preview and backup domains also need their own allowed origins if they will be used for multiplayer testing; do not assume they are accepted.

Origin filtering restricts ordinary browser connections from other websites. It is not user authentication or complete protection against a custom WebSocket client.

The expected backend endpoints are:

```text
https://tiny-tank-maze.onrender.com/health
wss://tiny-tank-maze.onrender.com/ws
```

## 3. Stage and deploy the browser files to Vercel

Keep the existing Supabase configuration and confirm `config.js` contains:

```js
multiplayerServer: "wss://tiny-tank-maze.onrender.com/ws",
```

Stage these **nine browser assets** from the same selected release into the existing Vercel release directory:

```text
index.html
game.html
multiplayer.html
style.css
config.js
home.js
leaderboard.js
game.js
multiplayer.js
```

The deployment packaging script lives outside this repository. Check its asset list before using it: an older seven-file list omits `multiplayer.html` and `multiplayer.js`. Publish the staged files manually to the existing Vercel project serving `littletinygames.com` and retain its project/domain configuration. Do not put `server/`, `node_modules/`, tests, or database setup SQL into this static browser release.

Publishing these assets updates the website only; it does not update the Render server. Record the Vercel deployment identifier and source commit separately from the Render deployed commit. Preserve the previous release information for rollback.

## 4. Verify the public release

After both deployments complete, use two devices or independent browser sessions:

1. Open `https://littletinygames.com` and select Multiplayer.
2. Create a room on one device and join its code from the other.
3. Start, move around corners, shoot, and use grenades.
4. Finish a round and start a rematch.
5. Disconnect a player and verify the visible recovery controls. Create/join a new room to reconnect; an ongoing match cannot be rejoined.
6. Check Classic/Infinite mode still opens normally.

Check the displayed client version and served browser files against the selected release, and verify the Render deployed commit in its dashboard. Record the website, backend, and two-device test results separately. A GitHub Pages test match is useful evidence for that site, but does not establish what Vercel currently serves.

## Server state and operating limits

Rooms live in one server process's memory. Restarting or redeploying Render removes active rooms and disconnects players; they must create/join new rooms afterward. This does not change the separate Supabase leaderboard.

This design assumes one backend instance. Running multiple instances would require an explicit room-routing and shared-state design. Local automated tests and a successful normal match do not establish capacity, real internet latency, or complete anti-cheat protection.
