# Tiny Tank Maze v5.9.2 — Fullscreen update

This package is based on the uploaded v5.8.2 frontend/reliability candidate,
including the exact-duplicate fog-ray optimization.

## Added

- Fullscreen button in Classic/Infinite.
- Fullscreen button in Multiplayer.
- `F` toggles fullscreen when not typing into an input.
- `Esc` exits fullscreen through the browser's standard fullscreen behavior.
- Cursor is hidden while the game shell is fullscreen and restored on exit.
- Canvas scales to the available screen while keeping the existing internal
  1152×768 game coordinate system.
- `game.js` and `multiplayer.js` URLs use `?v=5.9.2` to avoid stale browser/CDN
  copies.

## Preserved

The multiplayer fog polygon, exact-duplicate-ray optimization, client-state
sending/coalescing, movement smoothing, stale-input handling and server
protocol were not intentionally changed.

## Files changed

- `game.html`
- `game.js`
- `index.html` (control hint only)
- `multiplayer.html`
- `multiplayer.js`

## Files copied unchanged from the upload

- `AGENTS.md`
- `FOG_PERFORMANCE.md`
- `home.js`
- `RELEASE_STATUS.md`

`RELEASE_STATUS.md` still describes the prior v5.8.2 deployment. This generated
v5.9.2 package has not been deployed merely by being created here.

The upload did not include `style.css`, `config.js`, `leaderboard.js`, or server
files. Fullscreen-specific CSS is therefore embedded directly in `game.html`
and `multiplayer.html`, and those missing files are not replaced by this
package.
