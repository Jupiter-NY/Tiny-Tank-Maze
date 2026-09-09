# Tiny Tank Maze v5.10 — Infinite engagement update

This update is built on the user's v5.9.2 fullscreen package and changes only
single-player/frontend files. Multiplayer JavaScript and HTML are copied
unchanged.

## New permanent upgrades

### Multi Shot (M)
- Maximum 3 stacks.
- Stack 1: 3 bullets per volley.
- Stack 2: 5 bullets per volley.
- Stack 3: 7 bullets per volley.
- Side pellets deal 82% of normal direct damage.
- Every pellet can still inherit Explosive Rounds, Poison Shot, Ricochet and
  Bounce Explosions, intentionally creating strong late-run synergies.

### Poison Shot (☣)
- Maximum 5 stacks.
- Direct hits poison enemies that survive the hit.
- Poison lasts 4 seconds and refreshes on another poisoned hit.
- Damage per second scales from 8 to 24 across five stacks.
- Poisoned visible enemies receive a green status ring.

### Bounce Explosions (X)
- Maximum 5 stacks.
- Having at least one stack grants one bonus wall bounce.
- Every wall bounce creates a line-of-sight-blocked splash explosion.
- Blast damage/radius scale with stacks.
- Combines directly with Ricochet; more ricochets mean more bounce blasts.

## Feedback / celebration

- Infinite wave clear now triggers confetti from both lower corners.
- A WAVE CLEARED banner shows the wave bonus and full repair.
- Upgrade selection waits 650 ms so the clear gets its own visual beat.
- Enemy eliminations show a floating +100 popup.
- Direct bullet hits create visible sparks.
- Explosive, poison and bounce-explosion effects have distinct particle colors.
- Celebration particles continue updating while gameplay is paused at the
  upgrade screen.

## Art ideas for Nolan

The current game is geometric, so the easiest high-impact original art is
texture/decal work that preserves readability:

1. Floor tile: draw a seamless 64×64 or 128×128 dark concrete/metal texture.
2. Wall texture: draw a seamless 64×64 metal/stone panel with bright top edges.
3. Tank body and turret: draw them separately on transparent square canvases so
   the body and turret can rotate independently.
4. Decals: small scratches, warning stripes, arrows, vents and stains can be
   randomly stamped onto floor cells without changing collision.
5. Pickup icons: custom vision, rapid, repair, grenade and radar symbols would
   add more identity than changing their colors alone.
6. Upgrade icons: one small icon per permanent upgrade makes the selection
   screen feel more collectible.

A good first pass is floor + wall + pickup icons. They improve the entire game
without making tanks harder to read in the darkness.
