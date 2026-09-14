"""Stage the game collection and TinyTanks from an explicitly selected Git commit."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


GAME_ASSETS = (
    "index.html", "game.html", "multiplayer.html", "style.css", "config.js",
    "home.js", "leaderboard.js", "game.js", "multiplayer.js",
)
SITE_ASSETS = ("index.html", "site.css", "tank-maze.svg", "icon.svg")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path,
                        help="A new directory outside the source checkout.")
    parser.add_argument("--expected-commit", required=True,
                        help="Full source commit SHA, never a moving branch name.")
    parser.add_argument("--draft", action="store_true",
                        help="Permit uncommitted files for local QA; manifest marks this as a draft.")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-fA-F]{40}|[0-9a-fA-F]{64}", args.expected_commit):
        parser.error("--expected-commit must be a full commit SHA.")
    root = Path(__file__).resolve().parents[1]
    output = args.output.expanduser().resolve()

    def git(*argv):
        return subprocess.check_output(["git", "-C", str(root), *argv], text=True).strip()

    commit = git("rev-parse", "HEAD")
    if commit.lower() != args.expected_commit.lower():
        parser.error(f"Expected {args.expected_commit}, found {commit}.")
    dirty = git("status", "--porcelain")
    if dirty and not args.draft:
        parser.error("Commit or resolve source changes before preparing a release. Use --draft only for local QA.")
    if output == root or root in output.parents or output in root.parents:
        parser.error("Output and source checkout must not overlap.")
    if output.exists():
        parser.error("Output already exists. Use a new directory to preserve earlier releases.")

    mapping = {f"TinyTanks/{name}": name for name in GAME_ASSETS}
    mapping.update({name: f"site/{name}" for name in SITE_ASSETS})
    contents = {}
    for destination, source in mapping.items():
        filename = root / source
        if filename.is_symlink() or not filename.is_file():
            parser.error(f"Missing or unsafe browser asset: {source}")
        if not args.draft:
            git("ls-files", "--error-unmatch", "--", source)
        contents[destination] = filename.read_bytes()
        if not args.draft:
            committed = subprocess.check_output(["git", "-C", str(root), "show", f"{commit}:{source}"])
            if contents[destination] != committed:
                parser.error(f"Asset differs from the selected commit: {source}")
    if git("rev-parse", "HEAD") != commit or git("status", "--porcelain") != dirty:
        parser.error("Source changed during staging. Retry after edits finish.")
    for destination, source in mapping.items():
        if (root / source).read_bytes() != contents[destination]:
            parser.error(f"Source changed during staging: {source}")

    public = output / "public"
    (public / "TinyTanks").mkdir(parents=True)
    for name, data in contents.items():
        (public / name).write_bytes(data)
    configuration = {
        "$schema": "https://openapi.vercel.sh/vercel.json",
        "framework": None, "buildCommand": None, "installCommand": None,
        "outputDirectory": "public",
        "redirects": [
            {"source": "/TinyTanks", "destination": "/TinyTanks/", "permanent": True},
            {"source": "/game.html", "destination": "/TinyTanks/game.html", "permanent": True},
            {"source": "/multiplayer.html", "destination": "/TinyTanks/multiplayer.html", "permanent": True},
        ],
        "headers": [
            {"source": "/(.*)", "headers": [
                {"key": "X-Content-Type-Options", "value": "nosniff"},
                {"key": "Referrer-Policy", "value": "strict-origin-when-cross-origin"},
            ]},
        ],
    }
    (output / "vercel.json").write_text(json.dumps(configuration, indent=2) + "\n")
    manifest = {
        "repository": "https://github.com/Jupiter-NY/Tiny-Tank-Maze",
        "source_commit": commit, "source_branch": git("branch", "--show-current"),
        "draft": args.draft, "source_dirty": bool(dirty), "source_paths": mapping,
        "assets_sha256": {name: hashlib.sha256(data).hexdigest() for name, data in contents.items()},
    }
    (output / "RELEASE_MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"output": str(output), "source_commit": commit,
                      "draft": args.draft, "browser_assets": len(contents)}, indent=2))


if __name__ == "__main__":
    main()
