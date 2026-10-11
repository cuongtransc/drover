#!/bin/sh
# One-time: copy the app's state from its old identifier (Herdr, dev.cuongnb.herdrapp) to
# Drover's (dev.cuongtransc.drover), for the release and the dev build. Copies, never moves:
# the old folders stay until deleted by hand. A folder Drover already has is never overwritten.
# Refuses while either app runs, as a live WebKit folder may be mid-write.
#   MIGRATE_ID_APPS  process names to wait for (default "herdr-app drover")
set -u

old=dev.cuongnb.herdrapp
new=dev.cuongtransc.drover

for app in ${MIGRATE_ID_APPS:-herdr-app drover}; do
  if pgrep -x "$app" >/dev/null 2>&1; then
    echo "migrate-id: quit $app first" >&2
    exit 1
  fi
done

cd "$HOME" || exit 1
for suffix in "" .dev; do
  for item in "Library/WebKit/%s" "Library/Application Support/%s" "Library/Caches/%s" "Library/Preferences/%s.plist"; do
    # shellcheck disable=SC2059 # the item is the format
    from=$(printf "$item" "$old$suffix")
    # shellcheck disable=SC2059
    to=$(printf "$item" "$new$suffix")
    [ -e "$from" ] || continue
    if [ -e "$to" ]; then
      echo "migrate-id: kept $to (already there)"
      continue
    fi
    cp -Rp "$from" "$to" || exit 1
    echo "migrate-id: copied $from -> $to"
  done
done
