#!/bin/sh
# Tests for rust-changed.sh in a throwaway repo. Run by `mise run test:ci-scope`.
set -u
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fails=0
check() { # check <name> <command...>
  name=$1; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; fails=$((fails + 1)); fi
}
needed() { (cd "$tmp/repo" && "$here/rust-changed.sh" >"$tmp/out" 2>&1); }
skipped() { ! needed; }

fresh() {
  rm -rf "$tmp/repo"
  mkdir -p "$tmp/repo/src-tauri/src" "$tmp/repo/src"
  cd "$tmp/repo" || exit 1
  git init -q -b main
  git config user.email t@t; git config user.name t
  echo 'fn main() {}' >src-tauri/src/main.rs
  echo 'export {}' >src/App.tsx
  git add -A; git commit -qm base
  git update-ref refs/remotes/origin/main HEAD
  git checkout -qb feat
  cd - >/dev/null || exit 1
}

fresh
check "nothing changed: skipped" skipped
check "says why it skipped" grep -q "src-tauri unchanged" "$tmp/out"

fresh
echo 'export const a = 1' >"$tmp/repo/src/App.tsx"
git -C "$tmp/repo" commit -qam front
check "a frontend commit: skipped" skipped

fresh
echo 'fn main() { }' >"$tmp/repo/src-tauri/src/main.rs"
git -C "$tmp/repo" commit -qam back
check "a src-tauri commit: needed" needed

fresh
echo 'fn main() { }' >"$tmp/repo/src-tauri/src/main.rs"
check "an uncommitted src-tauri change: needed" needed

fresh
git -C "$tmp/repo" add src-tauri && echo 'fn x() {}' >"$tmp/repo/src-tauri/src/x.rs"
check "an untracked src-tauri file: needed" needed

fresh
git -C "$tmp/repo" update-ref -d refs/remotes/origin/main
check "no origin/main to compare with: needed" needed

fresh
check "CI_RUST=1 forces it" env CI_RUST=1 sh -c "cd '$tmp/repo' && '$here/rust-changed.sh' >/dev/null"

[ "$fails" -eq 0 ] || { echo "$fails failed"; exit 1; }
