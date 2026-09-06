# Tiny Tank Maze Multiplayer Setup

This build keeps the existing GitHub Pages frontend and Supabase leaderboard,
then adds a separate Node.js WebSocket server for real-time multiplayer.

## Architecture

```text
littletinygames.com (GitHub Pages)
        |
        | wss:// WebSocket
        v
Node.js multiplayer server (Render)
        |
        +-- rooms
        +-- movement / collision
        +-- bullets / grenades
        +-- health / deaths
        +-- pickups
        +-- visibility filtering

Supabase remains separate and continues to store the global Classic/Infinite leaderboard.
```

## What multiplayer currently includes

- private 5-character room codes
- 2–8 player free-for-all
- server-authoritative movement
- synchronized maze generation
- server-authoritative bullets and damage
- grenades and explosion damage
- heal, rapid-fire, vision, grenade, and radar-ping pickups
- dynamic pickup spawning
- last tank alive wins
- host-controlled rematches
- server-side line-of-sight filtering
- dead players cannot spectate hidden enemy positions
- WebSocket heartbeat cleanup

This is intentionally separate from Classic and Infinite mode so those modes keep working normally.

---

# 1. Push the new files to GitHub

Add these new files/folders to the same repository that hosts littletinygames.com:

```text
multiplayer.html
multiplayer.js
server/
    package.json
    server.js
    .gitignore
MULTIPLAYER_SETUP.md
```

Replace these updated files:

```text
index.html
home.js
style.css
config.js
```

Keep these existing files too:

```text
game.html
game.js
leaderboard.js
supabase_setup.sql
```

IMPORTANT: if your current `config.js` already contains your real Supabase URL and
publishable key, keep those two real values. Only add the new `multiplayerServer`
field from the new config.

Your config should eventually resemble:

```js
window.TANK_CONFIG = {
  supabaseUrl: "https://YOURPROJECT.supabase.co",
  supabasePublishableKey: "sb_publishable_...",
  multiplayerServer: "wss://YOUR-RENDER-SERVICE.onrender.com/ws",
};
```

---

# 2. Test the server locally first

Open Terminal and enter the server folder:

```bash
cd path/to/tiny-tank-maze/server
npm install
npm start
```

The server should print something like:

```text
Tiny Tank Maze server listening on 0.0.0.0:3000
```

For local testing, temporarily set this in `config.js`:

```js
multiplayerServer: "ws://localhost:3000/ws",
```

Serve the website from the project root in another Terminal:

```bash
python3 -m http.server 8000
```

Open two browser windows at:

```text
http://localhost:8000
```

Use Multiplayer -> Create Room in one window, then join that room code from the
other window.

Do not use `ws://localhost` after publishing the site. Public HTTPS pages should
connect using `wss://`.

---

# 3. Deploy the server on Render

1. Push the repository to GitHub.
2. Open the Render dashboard.
3. Choose **New -> Web Service**.
4. Connect the same GitHub repository.
5. Set **Root Directory** to:

```text
server
```

6. Set **Build Command** to:

```text
npm install
```

7. Set **Start Command** to:

```text
npm start
```

The included server already listens on `0.0.0.0` and uses Render's `PORT`
environment variable.

## Recommended environment variable

In Render, add:

```text
ALLOWED_ORIGINS=https://littletinygames.com,https://www.littletinygames.com
```

If you also want to test from your GitHub Pages URL, temporarily add it too:

```text
ALLOWED_ORIGINS=https://littletinygames.com,https://www.littletinygames.com,https://YOURNAME.github.io
```

This prevents arbitrary websites from opening multiplayer connections to your
server with browser WebSockets.

---

# 4. Put the Render WebSocket URL into config.js

Render gives the service an address similar to:

```text
https://tiny-tank-maze-server.onrender.com
```

Use the WebSocket version plus `/ws`:

```js
multiplayerServer: "wss://tiny-tank-maze-server.onrender.com/ws",
```

Commit that `config.js` change to GitHub.

Your published site at `https://littletinygames.com` can connect to that Render
server even though they use different domains.

---

# 5. Test the public multiplayer game

Use two different browsers, computers, or one normal + one private/incognito window.

1. Visit littletinygames.com.
2. Enter a name.
3. Select Multiplayer.
4. Player 1 chooses Create Room.
5. Copy the room code.
6. Player 2 joins with that room code.
7. Host starts the match.

If it works, both tanks should move in the same maze and server-side bullets should
damage the other player.

---

# Important implementation details

## Server authority

The client sends controls such as:

```json
{
  "type": "input",
  "input": {
    "up": true,
    "down": false,
    "left": false,
    "right": false,
    "shooting": false,
    "aim": 1.7
  }
}
```

It does NOT send messages such as `I hit Player 2` or `my HP is 100`.
The server determines those results.

## Flashlight security

The server checks the player's vision radius and maze line-of-sight before sending
other tank positions. If an opponent is behind a wall, that opponent is omitted
from the snapshot sent to that browser.

This is stronger than merely hiding an enemy in JavaScript because the hidden
position is not sent to the client in the first place.

## Server memory

Rooms currently live only in the server's RAM. If Render restarts the server,
active rooms disappear. This is normal for this first multiplayer version and does
not affect the Supabase leaderboard.

## Scaling later

This design intentionally assumes one server instance. If the game eventually has
enough traffic to require multiple server instances, room state should be moved to
shared infrastructure or players in a room need sticky/consistent routing.
