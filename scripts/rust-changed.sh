#!/bin/sh
# Exit 0 when the backend gate must run: src-tauri/ differs from where this branch left origin/main
# (commits, staged, unstaged or untracked files). Exit 1 when it does not: the backend is then the one
# main already passed, and fmt, clippy and cargo test would only repeat that, at minutes of CPU in a
# fresh worktree. Everything the backend compiles from is under src-tauri/. CI_RUST=1 forces the run;
# with no origin/main to compare with, it runs.
set -u
[ "${CI_RUST:-}" = 1 ] && exit 0
base=$(git merge-base HEAD origin/main 2>/dev/null) || exit 0
git diff --quiet "$base" -- src-tauri || exit 0
[ -n "$(git ls-files --others --exclude-standard -- src-tauri)" ] && exit 0
echo "backend gate skipped: src-tauri unchanged from origin/main (CI_RUST=1 runs it)"
exit 1
