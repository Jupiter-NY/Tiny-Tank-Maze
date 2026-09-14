# September 14 reconciliation and game collection

Prepared at Nolan's parent's request. This candidate combines Nolan's `Obfuscated` upload with the prior fixes and a new Little Tiny Games landing page. It has not replaced the production website. Backend deployment and database verification remain release requirements below.

## Source lineage

- Nolan's uploaded client: `Obfuscated`, `780b28764440e812a6effad034520708578bf44e`.
- Prior repaired client: `NolansAdditions`, `2eeaddbf6ff8c31fd2888e96ce15265dd24486b3`, already an ancestor of the upload.
- Nolan's new backend: `server`, `5e9e7bca903813b7773bf7b35c275f5095f347cc`.

The upload changed four browser files. It preserved multiplayer recovery, Draw, fog deduplication and shared CSS, but replaced single-player poison/Multi Shot fixes and restored conflicting fullscreen markup. This was another later file replacement, not missing Git ancestry. The older `server` branch's frontend is not a replacement for the newer game.

The current single-player browser cache version is **5.22.1**; multiplayer remains **5.9.1**. Continue from this reconciled tree. Preserve a readable editable source before the next obfuscation/export and compare generated files against the current fixes. Obfuscation and browser integrity checks deter casual changes; they do not prove that a score came from legitimate gameplay.

## What was reconciled

- Restored independent enemy poison weapon/status values and accurate Multi Shot descriptions, with the same gameplay scaling and spread as before.
- Restored the shared fullscreen canvas dimensions and overlay cursors while retaining Nolan's new Content Security Policy.
- Preserved Nolan's obfuscated client, integrity checks, rendering clips, upgrades, bosses, pause, and secure-run API integration.
- Froze completed-run score/time/health and run handles before asynchronous requests. Delayed checkpoints and pressing Play Again can no longer mix the completed run with its replacement. Classic calculation uses integer milliseconds consistently with the server; a boundary result can differ by one point.
- Reconciled the new backend router without changing multiplayer simulation. The validator preserves fractional HP for Classic's health bonus, rejects fractional values in integer fields, and reserves a finishing run before awaiting the database to prevent concurrent duplicate submissions.
- Fixed non-JSON leaderboard error handling so an HTTP/proxy failure keeps its meaningful status instead of failing when reading the response twice.
- Updated database setup and added an incremental migration that preserves records/public reads and removes direct browser inserts. These SQL files have **not** been applied to the account by this task.

## Landing page and URLs

Nolan's existing `index.html` is the tank game's mode menu, not a collection page. New files under `site/` provide the collection page and original SVG artwork without additional libraries or external fonts.

| Published path | Source and purpose |
| --- | --- |
| `/` | `site/index.html`: Little Tiny Games collection |
| `/TinyTanks/` | Existing root `index.html`: tank mode menu |
| `/TinyTanks/game.html?mode=classic` | Classic game |
| `/TinyTanks/game.html?mode=infinite` | Infinite game |
| `/TinyTanks/multiplayer.html` | Multiplayer |

`/TinyTanks` redirects to `/TinyTanks/`. Legacy `/game.html` and `/multiplayer.html` links redirect into that folder, keeping mode queries. The game menu includes an All Games link. Existing game HOME controls return to the game menu.

The existing domain already points to the Vercel project. This path change needs no GoDaddy login or DNS change. The game still needs a keyboard and mouse; the collection page itself adapts to phones.

## Validation

- **57/57 Node tests** pass, including the retained multiplayer/fog suite, the actual obfuscated combat/run code and new backend/client leaderboard tests.
- **59/59 isolated Chrome checks** pass: unmodified obfuscated startup under its CSP, integrity checks, Classic/Infinite progression, fullscreen aiming/cursors at 1280×720 and 900×1200, and actual two-player create/join/start/fire/move/rematch/server-restart recovery.
- No browser errors/warnings/external requests in that isolated suite; temporary rooms and clients were cleaned up.
- Landing page navigation and absence of horizontal overflow pass at widths 1440, 768, 390 and 320. Desktop and phone screenshots were visually reviewed.
- Live Render checks observed health, matching production CORS preflights and one synthetic run-start response. No public score was submitted. A successful start checks neither actual database write permission nor anti-cheat completeness.

Run `npm test` from `server/`. The optional browser suite is `npm run test:browser` with Playwright installed separately; see the earlier handoff for runtime setup. Tests use local backends and never need production secrets.

## Required production order

1. Deploy the backend-only fixes to the existing Render service. A separate `fix/leaderboard-release-2026-09-14` branch is prepared against the current `server` branch so its old frontend cannot overwrite this client. Confirm Render's actual deployed commit. The new raw fractional-HP payload requires the patched validator first.
2. In Supabase, verify the server's secret/service role can write and inspect the browser role privileges. The repository's earlier setup permitted direct browser inserts, which bypass the new validator. `supabase_secure_leaderboard.sql` removes that path without deleting scores and includes a read-only verification query. The expected result is public SELECT true and INSERT false for both `anon` and `authenticated`.
3. Coordinate applying that migration with publishing the new client. Revoking browser INSERT while the old production client remains live prevents that old client from saving new global scores. Retain the previous deployment and plan the cutover together.
4. Stage and publish the exact clean client commit to the existing Vercel project, then verify the custom-domain paths, game modes and a real score-save flow. Vercel preview origins need explicit Render origin permission for API/WebSocket testing; a preview's page rendering does not prove production multiplayer or score submission.

Required Render variables are `LEADERBOARD_HMAC_SECRET` (at least 32 characters), `SUPABASE_URL`, a server-only `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`, and appropriate `ALLOWED_ORIGINS`. Never put the server secret in `config.js`. Current live run-start succeeded, but database write access and live browser INSERT restrictions remain unverified. The connected browser/account tools were unavailable during this review, so no Render settings or Supabase policies were changed.

## Reproducible Vercel package

From this checkout, after committing all intended work:

```sh
python3 scripts/build-release.py --expected-commit FULL_COMMIT_SHA --output /new/external/release-folder
```

The output contains `public/` with exactly 13 allowlisted browser assets, `vercel.json`, and a source/hash manifest outside the public directory. It rejects dirty/mismatched source, asset bytes that differ from the commit, overlapping/existing output directories and unsafe files. `--draft` is only for local QA.

This replaces the older external nine-asset packaging workflow for collection releases. Do not deploy the whole repository or use the old flat layout: those approaches either expose non-browser files or omit the landing page/routing. GitHub source push, Vercel preview, Vercel production and Render deployment are separate states.
