#!/bin/sh
# The main checkout's src-tauri/target, from the main checkout or any of its worktrees. The gate's
# cargo tasks build there, so a fresh worktree reuses the dependencies main already compiled instead
# of compiling them all again. Cargo locks the directory: two worktrees' builds queue, and switching
# worktrees recompiles only the drover crate.
set -eu
common=$(git rev-parse --path-format=absolute --git-common-dir)
echo "$(dirname "$common")/src-tauri/target"
