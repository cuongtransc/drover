#!/bin/sh
# Tests for migrate-id.sh on a throwaway HOME. Run by `mise run test:migrate`.
set -u
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
cleanup() { [ -n "${pid:-}" ] && { kill "$pid"; wait "$pid"; } 2>/dev/null; rm -rf "$tmp"; }
trap cleanup EXIT

fails=0
check() { # check <name> <command...>
  name=$1; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; fails=$((fails + 1)); fi
}

old=dev.cuongnb.herdrapp
new=dev.cuongtransc.drover
fresh_home() {
  rm -rf "$tmp/home"
  mkdir -p "$tmp/home/Library/WebKit/$old/WebsiteData/LocalStorage" \
    "$tmp/home/Library/Application Support/$old" "$tmp/home/Library/Preferences"
  echo ls >"$tmp/home/Library/WebKit/$old/WebsiteData/LocalStorage/db"
  echo '{"m":1}' >"$tmp/home/Library/Application Support/$old/machines.json"
  echo plist >"$tmp/home/Library/Preferences/$old.plist"
}
run() { HOME="$tmp/home" MIGRATE_ID_APPS="migrate-test-$$" "$here/migrate-id.sh" >"$tmp/out" 2>&1; }

fresh_home
check "copies: exit 0" run
check "copies localStorage" grep -q ls "$tmp/home/Library/WebKit/$new/WebsiteData/LocalStorage/db"
check "copies Application Support" grep -q '"m":1' "$tmp/home/Library/Application Support/$new/machines.json"
check "copies the plist" grep -q plist "$tmp/home/Library/Preferences/$new.plist"
check "keeps the old folders" test -f "$tmp/home/Library/Application Support/$old/machines.json"
check "says what it copied" grep -q "migrate-id: copied Library/Application Support/$old -> Library/Application Support/$new" "$tmp/out"
check "skips what is missing (no Caches, no .dev)" sh -c "! test -e '$tmp/home/Library/Caches/$new' && ! grep -q '\.dev' '$tmp/out'"

fresh_home
mkdir -p "$tmp/home/Library/Application Support/$new"
echo '{"m":2}' >"$tmp/home/Library/Application Support/$new/machines.json"
check "keeps a target that exists: exit 0" run
check "keeps a target that exists: content" grep -q '"m":2' "$tmp/home/Library/Application Support/$new/machines.json"
check "keeps a target that exists: says so" grep -q "migrate-id: kept Library/Application Support/$new (already there)" "$tmp/out"

# A stand-in app process. Its name stays within the 15 characters Linux's `pgrep -x` compares.
app=mt$$
cp /bin/sleep "$tmp/$app"
# macOS kills a copied system binary until it is signed again.
if command -v codesign >/dev/null; then codesign -s - -f "$tmp/$app" || exit 1; fi
"$tmp/$app" 60 &
pid=$!
i=0
until pgrep -x "$app" >/dev/null; do
  i=$((i + 1))
  [ "$i" -le 50 ] || { echo "FAIL the stand-in app never showed up in pgrep"; exit 1; }
  sleep 0.1
done
run_busy() { HOME="$tmp/home" MIGRATE_ID_APPS="$app" "$here/migrate-id.sh" >"$tmp/out" 2>&1; }

fresh_home
check "refuses while an app runs: exit 1" sh -c "! HOME='$tmp/home' MIGRATE_ID_APPS='$app' '$here/migrate-id.sh' >'$tmp/out' 2>&1"
check "refuses while an app runs: says which" grep -q "migrate-id: quit $app first" "$tmp/out"
check "refuses while an app runs: copies nothing" test ! -e "$tmp/home/Library/WebKit/$new"

fresh_home
mkdir -p "$tmp/home/Library/WebKit/$new" "$tmp/home/Library/Application Support/$new"
: >"$tmp/home/Library/Preferences/$new.plist"
check "an app running is fine when nothing is left to copy: exit 0" run_busy
check "an app running is fine when nothing is left to copy: says kept" grep -q "migrate-id: kept Library/WebKit/$new (already there)" "$tmp/out"

rm -rf "$tmp/home"; mkdir -p "$tmp/home"
check "an app running is fine with no old state at all" run_busy

[ "$fails" -eq 0 ] && echo "migrate tests: all passed" || { echo "migrate tests: $fails failed"; exit 1; }
