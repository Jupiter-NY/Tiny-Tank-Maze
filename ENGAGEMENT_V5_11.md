# Tiny Tank Maze v5.11 — Kill Streaks + Centered Upgrade Dialog

## Kill streak scoring

Kills now award escalating points when they happen within 4 seconds of the
previous kill:

- 1st kill: +100
- 2nd kill: +200
- 3rd kill: +300
- 4th kill: +400
- and so on

Every kill refreshes the 4-second streak timer.

The streak resets when:
- the player takes any damage
- more than 4 seconds pass without another kill

The HUD shows the active streak and remaining time once the streak reaches 2x.
Kill popups show the multiplier and awarded points.

Classic and Infinite both use the streak-awarded kill points. Infinite's wave
clear bonuses still add to `player.points` as before.

## Upgrade dialog centering

`#upgradePanel` is now explicitly positioned over the `.game-shell` and uses
flex centering. The upgrade card is centered horizontally and vertically over
the 1152×768 canvas area, including fullscreen.

## Files changed

- game.js
- game.html

Multiplayer files are unchanged.
