# Tiny Tank Maze v5.14 — Multi Shot Balance + Enemy Variants

## Player Multi Shot balance

Once the player has at least one Multi Shot stack, every pellet deals exactly
50% of normal direct bullet damage, including the center pellet.

- Stack 1: 3 × 0.5 = 1.5 normal bullets if all three hit.
- Stack 2: 5 × 0.5 = 2.5 normal bullets if all five hit.
- Stack 3: 7 × 0.5 = 3.5 normal bullets if all seven hit.

Heavy Rounds still increases the base direct damage first, then Multi Shot
halves that direct damage per pellet. Existing Explosive Rounds, Poison Shot,
Ricochet and Bounce Explosions still attach to each pellet.

## Infinite enemy variants

Special enemies are one primary archetype at a time so players can read them.

- Wave 6: Rapid — yellow marking, faster reload.
- Wave 7: Multi Shot — cyan marking, three weaker bullets in a spread.
- Wave 8: Explosive — orange marking, existing splash bullets.
- Wave 9: Poison — green marking/green bullets, lower direct damage plus a
  short poison damage-over-time effect.
- Wave 10: Bounce — dashed blue ring/blue bullets, two wall ricochets.
- Wave 11: Sniper — black body, long barrel, pale fast bullet, very high direct
  damage, slower movement and a long reload.

Special-enemy frequency rises gradually with wave number and is capped so not
every enemy becomes special.

## Pause compatibility

The v5.13 virtual gameplay clock is preserved. Enemy/player poison durations and
all existing gameplay timers freeze while single-player is paused.

## Files changed

- game.js
- game.html
- index.html (Infinite feature text only)

Multiplayer files and server files are unchanged.
