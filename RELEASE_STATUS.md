# Multiplayer v5.8.2 release status

Updated September 6, 2026, at the parent/project publisher's request.

## Source

- Reliability fixes: [PR #1](https://github.com/Jupiter-NY/Tiny-Tank-Maze/pull/1), commit `6fb5db6160ab376210f7daa53aaf7083bde9e328`.
- Exact-duplicate fog-ray optimization: [PR #2](https://github.com/Jupiter-NY/Tiny-Tank-Maze/pull/2), commit `c923c032c9810036936194fa02ff1e0d452179ed`.
- Both are merged into `server`; combined merge `ba03f6342c5a485177ac5a5dae95dc902fa8c750` has the same source tree as the tested candidate. `main` is a different frontend and is not the multiplayer release source.
- Final local preflight: all 29 tests and 11 JavaScript syntax checks passed; core asset hashes match the earlier browser-tested candidate.

## Hosting status

Release is in progress. Publishing a branch is not proof of either deployment.

- Vercel frontend: production publication and live checks pending at https://littletinygames.com.
- Render multiplayer: existing https://tiny-tank-maze.onrender.com service responds to health checks; dashboard sign-in is needed to establish the deployed commit. Do not assume the merge has deployed the backend.
- Vercel uses a manual nine-browser-asset upload; GitHub pushes do not automatically deploy that frontend. Existing domain/DNS and Supabase leaderboard configuration remain in use.

See [MULTIPLAYER_HANDOFF.md](MULTIPLAYER_HANDOFF.md) and [FOG_PERFORMANCE.md](FOG_PERFORMANCE.md) for changes, test evidence and known limits. A two-device human internet playtest is still useful for latency and device-specific stutter; the local draw-cost improvement does not establish a universal FPS or network improvement.

## Recovery

The performance commit is separate from the reliability fixes and can be reverted independently if a rendering regression appears. The previous Vercel production deployment is `dpl_9PjYD5xLfyqC4dMqEfaPgLu5iwzZ` (single-player frontend, source `3524bd36b3700945e9e9cf183b761bc251395f74`). Production rollback should be followed by browser and backend compatibility checks. Keep rollback and deployment identities explicit.
