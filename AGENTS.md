# Multiplayer work

**Start from current main.** Read [MAIN_WORKFLOW.md](MAIN_WORKFLOW.md) and [CURRENT_RELEASE.md](CURRENT_RELEASE.md) first. Main unifies Nolan's additions, Obfuscated client, landing page and backend fixes. Earlier handoffs below are historical; do not switch back to an older source branch or overwrite fixed files with an older upload.

For the September 14 `Obfuscated` reconciliation and collection site, start with [SEPTEMBER_14_HANDOFF.md](SEPTEMBER_14_HANDOFF.md). It records the current client/backend lineage, preserved obfuscation, score fixes, 13-asset package and the pending Render/Supabase release requirements. Use this reconciled tree rather than replacing it with the older frontend on `server`.

For the current `NolansAdditions` work, first read [NOLANS_ADDITIONS_HANDOFF.md](NOLANS_ADDITIONS_HANDOFF.md). Start from the latest version of that branch. Its earlier full-file upload overwrote fixes that were already in its Git history, so merging the old fix commits again is not sufficient. Compare replacement game files against the current branch and run the regression suite before pushing.

Before changing multiplayer code, read [MULTIPLAYER_HANDOFF.md](MULTIPLAYER_HANDOFF.md) for the September 6, 2026 fixes, tests, known limits, and stutter investigation.

This branch also includes the separate exact-duplicate-ray optimization; read [FOG_PERFORMANCE.md](FOG_PERFORMANCE.md) for its scope, validation, and measurement limits.

- Run `npm test` from `server/` after relevant changes; install the server dependencies first if needed.
- Test normal room-code play as well as malformed connections, simultaneous eliminations, delayed movement, and reconnecting.
- Treat stutter optimization as a separate task when requested. The reliability patch deliberately preserves Nolan's rendering and network-smoothing choices.
- Keep deployment status explicit. The frontend and multiplayer server are separate hosting components; a GitHub branch or local test does not establish what is live.
