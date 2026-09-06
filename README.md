# Tiny Tank Maze — v4.2 Enemy Scaling

For the September 6 multiplayer reliability fixes (client v5.8.1), testing instructions, remaining limits, and stutter notes, see [MULTIPLAYER_HANDOFF.md](MULTIPLAYER_HANDOFF.md). AI collaborators should also read [AGENTS.md](AGENTS.md).

This version keeps the global Supabase leaderboard from v4.1 and makes
Infinite mode ramp much faster.

## Infinite enemy scaling

Enemy quantity still increases every wave, with an additional pressure enemy
every four waves.

Enemy stats also scale every wave:

- maximum health increases about 7.5% of the original base per wave
- bullet damage rises each wave
- movement speed rises gradually
- baseline fire rate becomes faster
- bullet velocity rises gradually

### Special enemies

- Wave 3+: Rapid enemies can spawn
  - yellow accent
  - much shorter firing delay
- Wave 6+: Explosive enemies can spawn
  - orange accent
  - orange explosive bullets
  - shots explode on walls and can splash the player
- At later waves enemies can roll both traits.

The chance of special enemies increases as the run continues.

## New permanent player upgrades

Infinite-mode upgrade choices now include the original weapon upgrades plus:

### Reinforced Hull
- +25 maximum HP per stack
- immediately fills the added health
- wave clears still heal you to full

### Repair Nanobots
- +1.2 HP/second per stack
- regeneration begins after 4 seconds without taking damage
- multiple stacks combine

Repair pickups also scale with your maximum health, healing at least 40 HP or
30% of maximum HP, whichever is larger.

## Existing permanent upgrades

- Rapid Chamber
- High Velocity
- Explosive Rounds
- Ricochet
- Heavy Rounds
- Reinforced Hull
- Repair Nanobots

All upgrades can stack and combine.

## Global leaderboard

The global Supabase leaderboard remains unchanged. Updating the website files
does not erase existing leaderboard rows in Supabase.

Keep your existing `config.js` Supabase URL and publishable key when replacing
files on GitHub.


## v4.3 early-wave engagement curve

Infinite mode now deliberately keeps the opening five waves easier:

- Waves 1-5 use baseline enemy health, damage, speed, fire rate, and bullet speed.
- No rapid-fire or explosive enemies can spawn during waves 1-5.
- Enemy count still rises steadily, so the player feels progression without a sudden stat spike.
- Wave 6 begins enemy stat scaling and introduces rapid-fire enemies at a low chance.
- Wave 8 introduces explosive enemies.
- Special-enemy chances and enemy stats continue scaling after their unlock waves.

This gives the player several waves to collect permanent upgrades and build momentum before the harder enemy variants appear.
