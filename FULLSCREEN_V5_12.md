# Tiny Tank Maze v5.12 — Fullscreen cursor/UI polish

## Cursor behavior

While fullscreen:
- active gameplay hides the mouse cursor
- Infinite upgrade selection shows the cursor
- single-player death/result screen shows the cursor
- multiplayer join/lobby/end-of-round dialogs show the cursor
- closing those dialogs returns to the hidden gameplay cursor

The behavior is driven by observing the panels' `hidden` class, so it works no
matter which existing code path opens or closes a panel.

## Fullscreen button styling

The fullscreen controls are now `<a class="home-link">` elements, the same
element/class combination as the existing HOME controls. This lets the project's
existing stylesheet style FULLSCREEN and HOME identically rather than relying on
browser button defaults.

## Files changed

- game.html
- game.js
- multiplayer.html
- multiplayer.js

No server files are changed.
