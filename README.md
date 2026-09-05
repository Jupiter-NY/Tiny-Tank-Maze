# Tiny Tank Maze — v4

## Pages

- `index.html` — dedicated home page
- `game.html` — gameplay page
- `home.js` — name handling + local leaderboards
- `game.js` — game simulation and rendering

## Game modes

### Classic
- 6 enemy tanks
- One maze
- Existing power-ups continue spawning
- Score includes clear, remaining-health, and speed bonuses

### Infinite
- Starts with 6 enemies
- Every new wave adds 2 more enemies
- The same maze remains for the whole run
- Clearing a wave fully heals the player
- Clearing a wave grants a permanent bullet upgrade choice
- Permanent upgrades stack and combine
- Run ends only when the player tank is destroyed

## Permanent bullet modifications

After each Infinite wave, choose 1 of 3 random upgrades:

- Rapid Chamber — faster shooting; stacks multiplicatively
- High Velocity — faster bullets
- Explosive Rounds — bullet impact splash damage; radius and damage scale
- Ricochet — +1 wall bounce per stack
- Heavy Rounds — more direct damage

Examples:
- Ricochet + Explosive Rounds: bullets bounce until impact, then explode
- Rapid Chamber + Heavy Rounds: high-DPS direct fire
- High Velocity + Ricochet + Explosive Rounds: fast bouncing explosive shots

## Leaderboards

The home page shows separate local top-5 boards for:

- Classic score
- Infinite highest wave (score breaks ties)

The player's name and scores are stored in browser `localStorage`.

## Existing systems retained

- Smooth wall-blocked field of view
- Independent 360° turret aiming
- Dynamic power-up spawning
- Repair, rapid-fire, vision, grenade, and enemy-ping pickups
- Grenades
- Random maze generation
- AI tank movement and line-of-sight combat

## Controls

- WASD / arrow keys: move
- Mouse: aim
- Left click / Space: shoot
- G: grenade

## Run locally

From the project folder:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```
