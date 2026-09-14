# Current release

**Published and verified on September 14, 2026**, at the parent's explicit request. This page supersedes the earlier candidate and release-status notes.

The unified main source includes Nolan's latest Obfuscated upload, all reconciled fixes, the Little Tiny Games landing page, and the patched secure leaderboard backend. See [MAIN_WORKFLOW.md](MAIN_WORKFLOW.md) for the canonical workflow.

## Public site and exact release

- Collection: https://littletinygames.com/
- Game: https://littletinygames.com/TinyTanks/
- Deployed code: `6826d0d5bda0f05924cd2513c6c47e793be1604b`.
- Vercel: `dpl_Em637qnjebsL8U9bPPnnX4cqny68`, READY in production, with the apex and www custom-domain aliases verified. All 13 public assets match the selected source exactly.
- Render: https://tiny-tank-maze.onrender.com/health reported the same code commit. The optional database read check succeeded with HTTP 200 and the normal game later completed a successful score write.
- `main`, `Obfuscated`, and `server` were fast-forwarded together to the unified release. Subsequent documentation-only commits record publication; they do not change the deployed browser or backend code. Main is the source for future feature branches.

Vercel was published manually from the clean release package. Future GitHub pushes alone do not establish that the website has updated. No domain or GoDaddy changes were needed.

## Verification

- **60/60 Node regression tests passed** on the release commit.
- **30/30 public production checks passed**, completed at 18:36 UTC: all 13 asset hashes, public routes and legacy redirects, private-file exclusions, desktop/phone landing layout and navigation, and live gameplay.
- Two isolated browser players created, joined, started and played one dedicated Render room. Movement, firing, guest departure, results, rejoin and rematch worked. The room was cleaned up without touching other players' rooms.
- One normal Classic round named **Release test** naturally ended with 1 kill and score 100. The unmodified game's finish request returned HTTP 200 with `ok: true`; the page confirmed "Global score submitted". No synthetic score or injected game state was used. That one real test entry remains on the leaderboard.
- No browser errors, warnings or unexpected requests were recorded in the production run.
- The same browser assets previously passed 59 isolated browser checks, including fullscreen and recovery cases; the release packager passed 12 fixture checks. These supplement the public checks and do not replace Nolan's playtesting on his device.

The local production receipt is under `05_Game_Deployment/reviews/2026-09-14/production-validation/live-6826d0d-complete/production-smoke-results.json` in the publisher's Nolan workspace. The corresponding test and deployment records are under `reviews/2026-09-14/main-production/`. These local QA artifacts are not website files.

## Remaining limits

The production anonymous browser role can read scores but its direct INSERT was denied by PostgreSQL. Authenticated-role grants were not inspected; the game does not sign players into Supabase. No SQL migration was executed. The normal game submission above verifies the Render server's write path.

Obfuscation and score plausibility checks are not proof against every cheat. Active rooms and score-run sessions remain in one Render process and can be lost on a backend restart. Stutter under Nolan's device/network conditions still needs his playtest. The reconciliation preserves Nolan's renderer and network smoothing, together with the previously tested multiplayer fog optimization.
