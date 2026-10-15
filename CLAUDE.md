# Drover

Drover (`Drover.app`) is a Tauri desktop client for **herdr**, the terminal multiplexer at https://github.com/herdrdev/herdr. Terms: `CONTEXT.md` (Drover was named Herdr before ADR 0007).

- Bare "herdr" means the multiplexer on a Machine. Its code is not here: a herdr bug is reported upstream or worked around in Drover, never patched in this repo.
- The pre-commit hook runs `mise run ci`: commit to run the gate, do not run it before as well. It skips the backend when `src-tauri/` matches origin/main (`CI_RUST=1` runs it).
- The gate's cargo tasks (`lint`, `test:backend`) build in the main checkout's `src-tauri/target`, so a worktree compiles only the drover crate; builds from several worktrees queue on Cargo's lock. `build:local`, `app:install` and `dev` keep the worktree's own target.
- Drover's own log is `~/Library/Logs/dev.cuongtransc.drover/` (`dev.cuongtransc.drover.dev` for `mise run dev`).
