# One shared source: main

At Nolan's parent's request, `main` is now the canonical source for the complete game collection, Nolan's Obfuscated client, prior fixes, and the secure leaderboard backend. The merge preserves the histories of `main`, `Obfuscated`, `NolansAdditions`, and the backend work. Old `main` only removed multiplayer; those removals were intentionally not restored.

## For Nolan and AI collaborators

1. Fetch the latest repository and start new work from **main**. Preserve any uncommitted work before switching branches.
2. Create a feature branch from current main and make changes there. Read `AGENTS.md`; compare whole-file uploads or newly obfuscated bundles before replacing existing files.
3. Run `npm test` from `server/`. For browser changes, run the optional `npm run test:browser` suite and check the affected game mode.
4. Merge the finished feature branch into main. Publish the selected main commit using the documented release package. Verify the public site before assuming a Git push updated it.

Nolan can test the published game remotely at **https://littletinygames.com/TinyTanks/**. The collection landing page is **https://littletinygames.com/**. No shared Wi-Fi or local test server is needed for the public site.

## Source layout

- `site/`: Little Tiny Games collection landing page and its artwork/styles.
- Root `index.html`, `game.js`, `multiplayer.js` and related browser assets: Tiny Tank Maze. Packaging places them under `/TinyTanks/`.
- `server/`: the single canonical backend implementation. Duplicate unused root-level leaderboard server modules were removed during reconciliation.
- `scripts/build-release.py`: stages exactly 13 browser assets plus Vercel routing from a clean, explicitly selected commit. Backend, SQL, tests, credentials and Git files are excluded from public output.
- `CURRENT_RELEASE.md`: exact source and deployment evidence for the latest publication.

## Publishing

The website stays on the existing Vercel project `tiny-tank-maze`. The multiplayer and score backend stays on the existing Render service. The domain and DNS are unchanged.

Render's existing `server` branch connection is preserved for this release; that branch is synchronized with main as a deployment mirror. Do not develop a separate frontend or backend on it. Until the Render dashboard connection is changed to main, a future backend release must fast-forward `server` to the tested main commit. Backend changes deploy before a frontend that requires them.

Vercel still uses a manual publish; a GitHub push is not proof of a website update. Stage the clean main commit with:

```sh
python3 scripts/build-release.py --expected-commit FULL_MAIN_COMMIT_SHA --output /new/external/release-folder
```

Deploy that output to the existing Vercel project. Verify the served files, redirects, game modes and Render commit. The server reports its deployment commit at `/health`; `/health?database=1` optionally checks a zero-row database read. It explicitly does not claim INSERT permission from a read check.

## September 14 database verification

The production public browser key can read the leaderboard, while a single empty-array INSERT probe returned HTTP 401 / PostgreSQL 42501 `permission denied for table leaderboard`. No score rows were submitted by that probe. This confirms direct anonymous browser INSERT is already blocked. Authenticated-role grants were not inspected; the current game does not sign players into Supabase.

`supabase_secure_leaderboard.sql` remains an account-level migration/reference for verifying both browser roles. No SQL migration was executed by this release task. New scores go through the Render validator. Obfuscation and plausibility checks are not complete proof of authentic gameplay.
