# Secure leaderboard backend release

This backend-only branch starts from `origin/server` at `5e9e7bca903813b7773bf7b35c275f5095f347cc`. It accompanies the frontend reconciliation on `release/site-2026-09-14` (Nolan's Obfuscated release plus the reviewed fixes). Frontend files and the multiplayer simulation are unchanged here.

## Changes and validation

- Reserve a run before awaiting its score insert, preventing overlapping finish requests from inserting twice. A failed database response allows retry. This does not provide database-enforced idempotency after an ambiguous network failure.
- Validate integer statistics without truncation. Preserve fractional HP so the Classic HP bonus matches the game. The companion frontend freezes scoring time and statistics before asynchronous submission.
- Add backend regression tests; adapt the existing multiplayer test loaders to the new router imports. Run `npm test` from `server/`.
- Keep public leaderboard reads, remove public browser INSERT from setup, and provide the incremental `supabase_secure_leaderboard.sql` migration. Existing rows are preserved.

Local validation on September 14: `npm test` from `server/` passed **37/37**, including normal two-player room creation/start and survival of a malformed unrelated connection, match finalization, delayed movement, client reconnect handling, fog equivalence and secure leaderboard validation. Database writes in leaderboard tests are mocked; network transport tests bind to loopback.

## Render configuration

Use the `server` root directory, Node >=20, existing dependency installation, and `npm start`. The active modules are `server/secure-leaderboard.js` and `server/secure-leaderboard-core.js`; duplicate root-level modules are not imported by this service.

Required server-only environment variables:

- `LEADERBOARD_HMAC_SECRET`: at least 32 characters.
- `SUPABASE_URL`.
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`: an appropriate server credential, never a browser publishable key.
- `ALLOWED_ORIGINS`: include both `https://littletinygames.com` and `https://www.littletinygames.com`. A nonempty list passed by `server.js` takes precedence over the router's `LEADERBOARD_ALLOWED_ORIGINS` fallback.

Keep a single server instance: active run sessions are in process memory and disappear on restart. Browser `config.js` keeps its public read credentials and points `leaderboardApiUrl` to the Render origin.

## Cutover and outstanding account verification

1. Deploy this backend before the companion frontend: the older validator rejects legitimate fractional HP from the corrected client.
2. Verify the server credential and database readiness in the hosting/database accounts. Apply `supabase_secure_leaderboard.sql` at the frontend cutover; its final read-only query should show browser roles can SELECT but cannot INSERT. Revoking INSERT intentionally stops legacy direct browser submissions.
3. Publish the companion frontend after its combined checks pass. The migration and deployment are separate actions; committing this branch does neither.

On September 14, production preflights for both website origins returned 204 with matching CORS headers. One authorized ephemeral `/run/start` returned 200. No `/finish`, public score, or database mutation was sent. This confirms route/environment-string readiness only: it does not prove the deployed hash, database credential validity, or current database grants/policies. The SQL migration remains pending.

The validator checks plausible client-supplied statistics. It does not simulate single-player gameplay, and obfuscation cannot establish authentic play. Retained limits include eight-hour run expiry, wave 250, and per-IP ten-minute limits of 20 starts, 180 checkpoints and 30 finishes.
