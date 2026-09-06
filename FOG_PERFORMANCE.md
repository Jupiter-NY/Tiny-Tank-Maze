# Fog rendering follow-up for Nolan and AI collaborators

Date: September 6, 2026. Client v5.8.2.

This is a separate performance change on `perf/deduplicate-fog-rays`, based on the reliability candidate `6fb5db6160ab376210f7daa53aaf7083bde9e328` / [PR #1](https://github.com/Jupiter-NY/Tiny-Tank-Maze/pull/1). It is not merged or deployed. Review/apply the reliability fixes first, then this small follow-up; keep the performance commit independently reversible.

## The change

`buildVisibilityPolygon()` already sorts its ray angles. Shared wall endpoints and collinear corners often produce the exact same angle several times. It now skips an angle only when it is exactly equal to the immediately preceding sorted angle.

This adds five lines in the visibility loop. All distinct angles still run the original wall-intersection calculation, in the original order. In particular, the closely spaced rays on either side of a corner remain distinct. There is no approximate rounding, reduced angular resolution, far-wall filtering, geometry cache, new renderer, or change to the vision radius.

The client version and script cache key are bumped to v5.8.2. `server/server.js` is byte-identical to the reliability baseline. Movement, hit detection, tick/snapshot rates, network smoothing, stale-input handling and hosting configuration are unchanged by this performance commit.

## What was checked

- **29 regression tests pass.** Seven new tests compare exact ordered visibility coordinates to a frozen copy of the previous algorithm. Cases cover seeded mazes, walls/corners/edges, normal and boosted vision, close but distinct angles, invalid input, and changing the maze between rounds. The tests also verify reduced intersection work. They use deterministic checks rather than machine-dependent timing thresholds.
- **Eight immediate Canvas RGBA comparisons are pixel-identical.** Each checks the full 1152×768 image, covering two seeded mazes, central/corner positions and normal/boosted vision. Separately exported PNGs show tiny raster differences: 469–479 pixels out of 884,736 differ by at most one RGB level out of 255, with no alpha difference; a repeated baseline export matches itself. Thus the evidence supports unchanged visibility geometry, but does not establish that every exported image is byte/pixel-identical. The cause of that export difference was not established.
- **Real browser gameplay passed:** two players start, move and shoot; an ordinary departure produces a winner; the players start a rematch; server disconnection exposes usable recovery controls; both reconnect and start again without page reloads. No browser console/page errors occurred.
- **Protocol checks passed:** room creation/join/readiness, movement, firing, grenade use, winner/host transfer, rematch inventory reset and cleanup.

Run the portable tests with Node 20 or newer:

```sh
cd server
npm install
npm test
```

The new test is `tests/fog-visibility.test.cjs`; its frozen reference is `tests/fixtures/fog-visibility-6fb5db6.js`. The fixture preserves the previous algorithm for comparison; it is not loaded by the game.

## Measurement method and limits

On the local Apple M4 / Chrome 151 test system, the final paired comparison gave these **per-scene median draw times**:

| Browser CPU setting | v5.8.1 baseline | v5.8.2 candidate |
|---|---:|---:|
| Normal | 7.0–8.9 ms | 3.5–4.3 ms |
| Chrome 4× CPU slowdown | 30.0–37.1 ms | 14.7–17.9 ms |

The mean of the eight scene medians fell by about 50% at normal speed and 51% with CPU slowdown. All eight full Canvas images were identical. These are drawing-cost measurements, not a claim that game FPS doubles or that every stutter is fixed.

A longer 120-sample follow-up on the first normal-speed scene gave baseline/candidate medians of 9.2/4.3 ms and 95th percentiles of 9.4/4.5 ms. The candidate's first two measured draws were slower, so its 99th percentile was 10.9 ms versus 9.7 ms for the baseline. The remaining 118 candidate draws were below 9.5 ms. This is consistent with a startup/JIT transient, but that cause was not proven; do not claim that every tail percentile improves. The portable [measurement summary](docs/fog-performance-summary.json) preserves these qualifications.

The local comparison runs the original and optimized `draw()` function bodies in actual Chrome with the same injected game state and real Canvas 2D rendering. It alternates the two versions' order, uses four warm-up draws and twenty measured draws per version/scenario, and repeats eight scenarios at normal CPU speed and Chrome's 4× CPU slowdown. Pixel checks run separately from the timed draws. The final recorded comparison runs after other test processes have stopped.

This measures JavaScript plus Canvas command-submission time. It does **not** independently measure GPU completion, internet latency, complete-match FPS, or Nolan's device. A lower drawing cost can help browser stutter, but will not fix an opponent pausing because of delayed network messages.

Keep a two-device internet playtest before release, especially watching wall shadows, boosted vision, corner turns, shooting, rematches and reconnects. If a later change affects visibility or gameplay, revert this performance commit independently of the reliability fixes.
