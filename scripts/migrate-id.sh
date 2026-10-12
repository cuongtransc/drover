#!/bin/sh
# One-time: copy the app's state from its old identifier (Herdr, dev.cuongnb.herdrapp) to
# Drover's (dev.cuongtransc.drover), for the release and the dev build. Copies, never moves:
# the old folders stay until deleted by hand. A folder Drover already has is never overwritten.
# Refuses while either app runs and something is left to copy, as a live WebKit folder may be mid-write.
#   MIGRATE_ID_APPS  process names to wait for (default "herdr-app drover")
set -u

old=dev.cuongnb.herdrapp
new=dev.cuongtransc.drover

# pairs <action>: runs <action> <from> <to> for each item the old identifier has.
pairs() {
  for suffix in "" .dev; do
    for item in "Library/WebKit/%s" "Library/Application Support/%s" "Library/Caches/%s" "Library/Preferences/%s.plist"; do
      # shellcheck disable=SC2059 # the item is the format
      from=$(printf "$item" "$old$suffix")
      # shellcheck disable=SC2059
      to=$(printf "$item" "$new$suffix")
      [ -e "$from" ] || continue
      "$1" "$from" "$to" || return 1
    done
  done
}

pending=0
count() { [ -e "$2" ] || pending=$((pending + 1)); }

migrate() {
  if [ -e "$2" ]; then
    echo "migrate-id: kept $2 (already there)"
    return 0
  fi
  cp -Rp "$1" "$2" || return 1
  echo "migrate-id: copied $1 -> $2"
}

cd "$HOME" || exit 1
pairs count
# Only a copy needs the apps closed: with nothing left to copy, a running app is no reason to fail.
if [ "$pending" -gt 0 ]; then
  for app in ${MIGRATE_ID_APPS:-herdr-app drover}; do
    if pgrep -x "$app" >/dev/null 2>&1; then
      echo "migrate-id: quit $app first" >&2
      exit 1
    fi
  done
fi
pairs migrate || exit 1
