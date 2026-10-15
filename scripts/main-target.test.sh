#!/bin/sh
# Tests for main-target.sh in a throwaway repo with a worktree. Run by `mise run test:main-target`.
set -u
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$tmp"' EXIT

fails=0
check() { # check <name> <command...>
  name=$1; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; fails=$((fails + 1)); fi
}
from() { (cd "$1" && "$here/main-target.sh"); }

git init -q -b main "$tmp/repo"
mkdir -p "$tmp/repo/src-tauri"
git -C "$tmp/repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
git -C "$tmp/repo" worktree add -q "$tmp/repo/.worktrees/feat" -b feat
mkdir -p "$tmp/repo/.worktrees/feat/src-tauri"
want="$tmp/repo/src-tauri/target"

check "from the main checkout" test "$(from "$tmp/repo")" = "$want"
check "from main's src-tauri" test "$(from "$tmp/repo/src-tauri")" = "$want"
check "from a worktree's src-tauri" test "$(from "$tmp/repo/.worktrees/feat/src-tauri")" = "$want"

[ "$fails" -eq 0 ] || { echo "$fails failed"; exit 1; }
