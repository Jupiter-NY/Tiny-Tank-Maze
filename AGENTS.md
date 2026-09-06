# Multiplayer work

Before changing multiplayer code, read [MULTIPLAYER_HANDOFF.md](MULTIPLAYER_HANDOFF.md) for the September 6, 2026 fixes, tests, known limits, and stutter investigation.

This branch also includes the separate exact-duplicate-ray optimization; read [FOG_PERFORMANCE.md](FOG_PERFORMANCE.md) for its scope, validation, and measurement limits.

- Run `npm test` from `server/` after relevant changes; install the server dependencies first if needed.
- Test normal room-code play as well as malformed connections, simultaneous eliminations, delayed movement, and reconnecting.
- Treat stutter optimization as a separate task when requested. The reliability patch deliberately preserves Nolan's rendering and network-smoothing choices.
- Keep deployment status explicit. The frontend and multiplayer server are separate hosting components; a GitHub branch or local test does not establish what is live.
