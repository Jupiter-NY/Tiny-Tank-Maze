# Tiny Tank Maze — v4.1 Global Leaderboard

This version adds a real shared/global leaderboard for a GitHub Pages deployment
using Supabase as the online database.

## Added files

- `config.js` — your Supabase Project URL + publishable key
- `leaderboard.js` — shared browser API for global scores
- `supabase_setup.sql` — database/table/RLS setup

## Setup

### 1. Create a Supabase project

Create a project in Supabase.

### 2. Run the SQL

Open `supabase_setup.sql`, copy all of it, and run it once in the Supabase SQL Editor.

It creates the leaderboard table, enables Row Level Security, grants public
read + insert only, and does not give browser users update/delete permission.

### 3. Copy your public project credentials

In Supabase, copy:

- Project URL
- Publishable key (`sb_publishable_...`)

Do NOT use a secret/service-role key.

### 4. Edit `config.js`

Replace the placeholders:

```js
window.TANK_CONFIG = {
  supabaseUrl: "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE",
  supabasePublishableKey: "PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE",
};
```

with your real values.

### 5. Push to GitHub Pages

Keep these files in the published root:

```text
index.html
game.html
style.css
home.js
game.js
config.js
leaderboard.js
supabase_setup.sql
README.md
```

## Behavior

- The homepage loads the global Classic and Infinite top-5 leaderboards.
- Every completed/dead run saves locally first, then submits to Supabase.
- If Supabase is unconfigured or unavailable, the game still works and the
  homepage shows local fallback scores.
- Infinite ranking sorts by highest wave first, then score.
- Classic ranking sorts by score.

## Security

This is global, but not cheat-proof.

The game is still fully client-side, so a determined player can modify their
browser code or manually call the public score endpoint. Database constraints
stop malformed or absurdly out-of-range records, but they cannot prove a score
was actually earned.

For a serious competitive leaderboard, score calculation/validation should move
to an authoritative server or use signed/verifiable run data.

## Run locally

```bash
python3 -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```
