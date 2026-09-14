# Tiny Tank Maze

**Main is the shared source for all current work.** Start new feature branches from current main. The collection lives at `littletinygames.com` and the tank game at `/TinyTanks/`. Read [MAIN_WORKFLOW.md](MAIN_WORKFLOW.md) for source layout and publishing, and [CURRENT_RELEASE.md](CURRENT_RELEASE.md) for verified deployment status. Earlier dated notes below describe historical candidates.

**September 14 production:** Nolan's obfuscated single-player **5.22.1**, multiplayer **5.9.1**, and the Little Tiny Games collection are live. [Open the collection](https://littletinygames.com/) or [play Tiny Tank Maze](https://littletinygames.com/TinyTanks/). Code commit `6826d0d` passed 60 Node tests and 30 public production checks, including two-player Render gameplay and a normal score submission. Read [CURRENT_RELEASE.md](CURRENT_RELEASE.md) for exact deployment evidence and remaining limits, and [SEPTEMBER_14_HANDOFF.md](SEPTEMBER_14_HANDOFF.md) for the earlier reconciliation details.

The historical September 10 candidate included single-player **5.17.1** and multiplayer **5.9.1**. Its reviewed fixes are preserved in current main; [NOLANS_ADDITIONS_HANDOFF.md](NOLANS_ADDITIONS_HANDOFF.md) explains them.

The historical September 6 multiplayer release was **v5.8.2**. [RELEASE_STATUS.md](RELEASE_STATUS.md) preserves that release record; `MAIN_WORKFLOW.md` is the current publishing guide.

## Earlier single-player updates — v4.2 Enemy Scaling

For the September 6 multiplayer reliability fixes (client v5.8.1), testing instructions, remaining limits, and stutter notes, see [MULTIPLAYER_HANDOFF.md](MULTIPLAYER_HANDOFF.md). AI collaborators should also read [AGENTS.md](AGENTS.md).

The separate v5.8.2 fog performance follow-up is documented in [FOG_PERFORMANCE.md](FOG_PERFORMANCE.md).

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
