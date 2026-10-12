# 0007: The app is Drover, with its own bundle identifier

> Status: Accepted · Date: 2026-10-12 · Adds **Drover** to `CONTEXT.md`; renames **herdr-app** in ct-workstation's

## Context

The app shipped as `Herdr.app` (repo `herdr-app`, identifier `dev.cuongnb.herdrapp`) and drives
herdr, the multiplexer. The two names differed by one capital letter, and agents kept confusing the
client with the server: whose code, whose bug, whose log. A glossary entry alone was tried (PR #104)
and judged too weak, since every file, path and window title still said "Herdr".

## Decision

- The app is named **Drover**; "herdr" means only the multiplexer.
- The bundle identifier becomes `dev.cuongtransc.drover` (`.dev` for the dev build), and the Cargo
  and npm packages, runtime dir, signing identity and env vars follow the name.
- The user's state is copied once to the new identifier's folders by `mise run app:migrate-id`, not
  by code in the app: the app is installed on one Mac.

## Alternatives rejected

- **Keep the identifier, change only the visible name.** No state to move, but the old name would
  live on in every macOS folder, log path and the signing requirement; the user asked for a clean break.
- **"Herdr Desk" or another name containing "herdr".** Still overlaps; confusion shrinks, not ends.
- **Migration inside the app.** Works on any machine, but needs code that runs before the webview
  opens its storage, for an app installed in one place.

## Consequences

- macOS permissions (notifications) are granted again, and `sign:setup` makes a new identity.
- Ports from the upstream fork (`cuongnbms/herdr-app`) need the package and identifier names adjusted.
- Dated docs before this ADR still say Herdr and `herdr-app`; they are history.
