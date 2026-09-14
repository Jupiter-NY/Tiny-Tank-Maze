# Multiplayer v5.8.2 release status

September 14 review: the reconciled Obfuscated client and collection landing page are a new candidate, not a production release. [SEPTEMBER_14_HANDOFF.md](SEPTEMBER_14_HANDOFF.md) records the verification and required Render/Supabase work. This review observed that the production root still serves the tank menu and `/TinyTanks` returns 404; it did not replace production.

September 14 preview: `dpl_D8yruLoacxerh5ew9oTeN5czXmee` is READY from source `b2b92cdf4f6d4936efa5c0d63a33db28e0acc536`. See the handoff for its sign-in-protected preview URL and passed route/source checks. It is not promoted to the custom domain.

September 10 development note: `NolansAdditions` now contains a separate single-player 5.17.1 / multiplayer 5.9.1 candidate. See [NOLANS_ADDITIONS_HANDOFF.md](NOLANS_ADDITIONS_HANDOFF.md). The release history below describes the deployed September 6 version; the new branch has not been deployed by this follow-up.

Updated September 6, 2026, at the parent/project publisher's request.

## Source

- Reliability fixes: [PR #1](https://github.com/Jupiter-NY/Tiny-Tank-Maze/pull/1), commit `6fb5db6160ab376210f7daa53aaf7083bde9e328`.
- Exact-duplicate fog-ray optimization: [PR #2](https://github.com/Jupiter-NY/Tiny-Tank-Maze/pull/2), commit `c923c032c9810036936194fa02ff1e0d452179ed`.
- Both are merged into `server`; combined merge `ba03f6342c5a485177ac5a5dae95dc902fa8c750` has the same source tree as the tested candidate. `main` is a different frontend and is not the multiplayer release source.
- Final local preflight: all 29 tests and 11 JavaScript syntax checks passed; core asset hashes match the earlier browser-tested candidate.

## Hosting status

**Vercel frontend: published and verified.** Client v5.8.2 is live at [littletinygames.com](https://littletinygames.com), deployed September 6, 2026 at approximately 15:34 UTC.

- Browser source commit: `4e7a05c95def4db54495e3e3e0762cbd64ea0527`. Its game files are unchanged from the tested combined merge. This status update is a later documentation-only commit.
- Vercel deployment: `dpl_2kYsgRCWTxXybGyTay16JAg2aEbB`, READY, production, aliased to the custom domain.
- All nine public assets matched the staged SHA-256 manifest over HTTPS. The `www` redirect retained the path and query. Server source, SQL, README and Git config returned 404.
- Live Chrome: two browser players created/joined/started a match with client v5.8.2, the maze rendered, departure produced a winner, and lobby/leave controls worked. Classic and Infinite launched, and existing global leaderboard rows loaded. No browser warning/error was recorded. No scores were intentionally submitted.

**Render backend: live behavior checked; exact deployed commit unconfirmed.** The existing service responds to health checks. After the merges, an ordinary two-player protocol check passed 8/8: connection, room, readiness/start, movement, shooting, departure/winner/host transfer, rejoin/rematch and cleanup. A separate valid-message probe in its own temporary room rejected an out-of-map position, consistent with the new movement validation being active. All temporary rooms and connections were cleaned up.

The Render dashboard is at a sign-in page, so this session could not inspect the deployment log/commit or initiate a manual Render deployment. The behavior above is evidence, not proof of the exact backend revision or every server-side fix. **Remaining release check for Nolan or the account owner:** open the existing Render service, confirm a successful deployment includes `6fb5db6160ab376210f7daa53aaf7083bde9e328` (present in combined merge `ba03f6342c5a485177ac5a5dae95dc902fa8c750` and browser source commit above), and deploy the latest `server` revision if necessary. Do not create a replacement service or change paid plans for this check.

Vercel uses a manual nine-browser-asset upload; GitHub pushes do not automatically deploy that frontend. Existing domain/DNS and Supabase leaderboard configuration remain in use.

See [MULTIPLAYER_HANDOFF.md](MULTIPLAYER_HANDOFF.md) and [FOG_PERFORMANCE.md](FOG_PERFORMANCE.md) for changes, test evidence and known limits. A two-device human internet playtest is still useful for latency and device-specific stutter; the local draw-cost improvement does not establish a universal FPS or network improvement.

## Recovery

The performance commit is separate from the reliability fixes and can be reverted independently if a rendering regression appears. The previous Vercel production deployment is `dpl_9PjYD5xLfyqC4dMqEfaPgLu5iwzZ` (single-player frontend, source `3524bd36b3700945e9e9cf183b761bc251395f74`). Production rollback should be followed by browser and backend compatibility checks. Keep rollback and deployment identities explicit.
