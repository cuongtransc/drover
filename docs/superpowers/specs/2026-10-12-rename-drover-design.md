# Rename the app to Drover

> Status: Draft · Date: 2026-10-12 · ADR: [0007](../../adr/0007-rename-to-drover.md)

## Why

The app ships as `Herdr.app` and drives **herdr**, the multiplexer. Two names one capital letter
apart made agents (and readers) mix the client up with the server: whose bug, whose log, whose
code. A glossary entry (PR #104) was judged not enough: the name itself must stop overlapping.
The app becomes **Drover** (one who drives a herd); bare "herdr" then has one meaning.

## Scope

### 1. Names and identity

| | Before | After |
|---|---|---|
| Product name | `Herdr` / `Herdr Dev` | `Drover` / `Drover Dev` |
| Bundle identifier | `dev.cuongnb.herdrapp` / `.dev` | `dev.cuongtransc.drover` / `.dev` |
| Cargo package, lib | `herdr-app`, `herdr_app_lib` | `drover`, `drover_lib` |
| npm package | `herdr-app` | `drover` |
| Runtime dir | `/tmp/herdr-app[-dev]-<uid>` | `/tmp/drover[-dev]-<uid>` |
| Signing identity | `Herdr Local Signing` | `Drover Local Signing` |
| Env vars | `HERDR_SIGN_IDENTITY`, `HERDR_APP_SSH_TEST` | `DROVER_SIGN_IDENTITY`, `DROVER_SSH_TEST` |
| Integration test sessions | `herdrapp-test-*` | `drover-test-*` |
| Installed bundle | `/Applications/Herdr.app` | `/Applications/Drover.app` |

### 2. The word "Herdr" in code and docs

Each occurrence is read, not replaced in bulk: where it names this app it becomes **Drover**;
where it names the multiplexer it becomes lowercase **herdr**. Kept as they are:

- `src-tauri/src/herdr/`: the code that speaks herdr's protocol; the name is right.
- Test fixtures with a Workspace labelled `herdr-app`: a project name in sample data, not the app.
- Dated specs, plans and ADRs under `docs/`: history, left as written.

### 3. Logo

Direction A ("crook"), chosen from three rendered options: a shepherd's crook leading three status
dots (blue, green, yellow) on the old icon's dark plum ground with the coral accent. The final SVG
replaces `assets/app-icon.svg`; `mise run gen:icons assets/app-icon.svg` regenerates
`src-tauri/icons/`. Checked at 16, 32 and 64 px before it is committed.

### 4. Moving the user's state

The identifier names every per-app folder macOS keeps, so a new identifier starts empty. State on
this Mac today:

| Path under `~/Library` | Holds |
|---|---|
| `WebKit/<id>` (2.9 MB) | the UI's localStorage (settings and other UI state) |
| `Application Support/<id>` | `machines.json`, `sidebar-layout.json` (Groups, Bookmarks) |
| `Preferences/<id>.plist`, `Caches/<id>` | macOS preferences, caches |
| `Logs/<id>` | old logs (not moved) |

A one-time task `mise run app:migrate-id` (script `scripts/migrate-id.sh`) copies each of the first
three from `dev.cuongnb.herdrapp` to `dev.cuongtransc.drover`, and the `.dev` pair the same way:

- It refuses while the old or new app is running (`pgrep -x` on both binaries).
- It skips a pair whose new folder already exists, so it is safe to run twice and never overwrites
  the new app's state.
- It copies, never moves: the old folders stay until the user deletes them.
- `HOME` is honoured, so the test runs it on a fake home.

`app:install` runs it before installing when the new `Application Support` folder is absent.

WebKit keys storage by origin (`tauri://localhost`, unchanged) under a per-folder salt that is
copied with the folder, so the copied localStorage should be read as-is. This is the one
assumption only a real run proves (see Verification).

### 5. Documentation

- `CONTEXT.md`: title Drover; term **Drover** with an `_Avoid_` list; the flagged ambiguity says
  what "Herdr" used to mean. "herdr" itself is a workstation-wide word, defined in ct-workstation's
  `CONTEXT.md` (step 2 of After the merge), not here.
- `CLAUDE.md` (new, short): bare "herdr" is the multiplexer, not patched here; where the app's log is.
- `README.md`: name, install path, logo.
- ADR 0007 records the rename and the identifier change.
- PR #104 (glossary only) is closed as superseded, with a link to this PR.

## After the merge

Order matters: moving the folder breaks every session running in it.

1. Claude renames the GitHub repo to `cuongtransc/drover` through the API (GitHub redirects the old
   URL), sets `origin` to the new URL and checks `ct mr resolve`.
2. Claude opens a ct-workstation PR: its `CONTEXT.md` term **herdr-app** becomes **Drover**
   (adding **herdr**, the multiplexer, with "Herdr" under `_Avoid_`), and `CONTEXT-MAP.md` points to
   the new repo URL and path. The user merges it.
3. The user closes the sessions working in `herdr-app` and runs a prepared script that moves the
   checkout to `…/21-AI-Coding-Agent/drover`, moves Claude's project memory folder to the new path's
   name, and deletes `src-tauri/target` (Tauri targets are not relocatable).
4. The user runs `mise run sign:setup` (new identity) and `mise run app:install`, grants
   notifications again, then deletes `/Applications/Herdr.app`.

## Verification

- `mise run ci` and `mise run test:browser` green.
- `scripts/migrate-id.test.sh` (added to `ci`): copies on a fake `HOME`; skips an existing target;
  refuses while a fake process named like the app runs; never touches the old folders.
- One real run: build `Drover.app`, run `app:migrate-id` on this Mac's state, open the app and check
  settings, Groups, Bookmarks and Machines are there. Not done until this passes.
- The Dock icon and the app name in the menu bar are looked at by the user (no automated check).

## Not in scope

- Migration inside the app (other machines): the app is installed on this Mac only.
- Renaming `src-tauri/src/herdr/` or herdr's own terms (Session, Workspace, Pane).
- Rewriting dated docs.
