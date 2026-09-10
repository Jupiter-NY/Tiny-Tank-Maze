# September 10 fixes for Nolan and AI collaborators

Working branch: `NolansAdditions`. Starting commit: `984649c82d3d42db57bc0a421669cb7526c22a91`. Candidate versions: single-player **5.17.1**, multiplayer **5.9.1**. Prepared at the parent/publisher's request. This is a branch update, not a Vercel or Render deployment.

## What changed

- Restored the September 6 multiplayer disconnect reset and guards against callbacks from an older connection. The room entry and reconnect message become visible after disconnects, and old keys, shots, board state and timing are cleared. Player name and last room code are preserved.
- Restored **Draw** for a null winner and the exact-duplicate-angle fog optimization. Distinct corner rays remain unchanged; server rates and network smoothing are unchanged.
- Fullscreen now uses shared CSS for both clients. The canvas element keeps the game's 3:2 ratio and is centered in the screen, so the existing mouse-to-canvas mapping remains accurate. There is no stretched multiplayer picture or blank margin inside the canvas rectangle. Cursors are visible over interactive overlays and hidden during fullscreen gameplay; normal browser fullscreen exit remains available.
- Separated a poison enemy's `poisonWeaponDps` from the incoming `poisonDps`/`poisonUntil` status inflicted by the player. Poison cleanup no longer erases the enemy's attack strength, and using Poison Shot no longer strengthens its return fire. Original weapon scaling and poison duration remain unchanged.
- Corrected the Multi Shot upgrade descriptions to match the existing projectile spread: ±5.5°, ±14°, ±25.5° for stacks 1–3. Both display and firing use the same angle calculation. Pellet damage, count and spread were not rebalanced.
- Repaired literal `\n` escapes in the inherited multiplayer CSS block, which had prevented its intended lobby/input layout rules from applying. The rules themselves retain their original values.
- Added a short leaderboard note explaining that records span game versions and newer runs include kill-streak bonuses. Existing scores, submission format and database configuration remain unchanged. A separate leaderboard season is still an optional product decision.
- Updated fullscreen test mocks and added focused regression coverage. Cache queries identify the new client and shared stylesheet versions.

Nolan's pause, kill streaks, upgrades, enemy variants, boss arenas and celebrations are retained. The server implementation is unchanged from the previously fixed `server` branch.

## Why the previous fixes disappeared

This branch already inherited the September 6 fixes through `147f57690e4c87888ebcc238a41999ff24a03b84`. The September 9 `Add files via upload` commit `5921529348382d8d1968d57bdaf890663a78613b` replaced `multiplayer.js` and removed the recovery, Draw and fog changes. Git history establishes the overwrite, but does not establish how the replacement file was prepared.

Continue current development from the latest `NolansAdditions` checkout. Before replacing whole files with an exported or AI-produced package, compare the changes against this branch so existing fixes remain. Simply merging the old `server` commits again does not restore lines that were later deleted. `main`, `server`, this working branch and the deployed site are distinct; use the intended source explicitly.

## Checks

With Node 20 or newer:

```sh
cd server
npm install
npm test
```

The optional browser suite uses Playwright with an isolated localhost frontend/backend and no production score or room writes. Install it locally for testing without changing production dependencies:

```sh
cd server
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:browser
```

An existing installation can be selected with `PLAYWRIGHT_MODULE`, and an installed Chrome binary with `CHROME_EXECUTABLE`. The browser suite is separate from the default Node tests because it requires a browser runtime.

September 10 validation passed:

- **40/40 Node regression tests**, covering server reliability/movement, client recovery/fullscreen state, fog visibility and single-player poison/Multi Shot behavior.
- **53/53 browser checks** in Chrome at 1280×720 and 900×1200. Classic, Infinite and multiplayer passed windowed/fullscreen/exit aiming and cursor checks. Actual local two-player sessions passed create/join/start, movement, shooting, rematches and recovery after a server stop/restart without reloading either page.
- No browser errors or external requests in the isolated browser suite; game sources were unchanged by testing. JavaScript syntax and Git whitespace checks passed.
- The homepage and disconnect dialog were visually checked, including the repaired three-column mode layout and leaderboard note.

Automated accelerated wave transitions are not a full human playthrough or a balance/latency measurement. A short two-device playtest remains useful before publishing.

## Deployment and recovery

The current change does not publish the site. Vercel uses the existing manual nine-browser-asset workflow; the shared stylesheet is already included. Render's backend code is unchanged, so this patch adds no server deployment requirement. The prior question about the exact Render deployed commit remains separate from local source validation; see [RELEASE_STATUS.md](RELEASE_STATUS.md).

Keep the previous deployed v5.8.2 release available until a new release is validated. If a later change regresses gameplay, restore the affected change while retaining the other confirmed fixes, rather than uploading an older complete client.
