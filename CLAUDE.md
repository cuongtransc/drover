# herdr-app

The **Herdr app** (`Herdr.app`) is a Tauri desktop client for **herdr**, the terminal multiplexer at https://github.com/herdrdev/herdr. Terms: `CONTEXT.md`.

- Bare "herdr" means herdr, the server and CLI on a Machine. Its code is not here: a bug in herdr's behaviour is reported upstream or worked around in this app, never patched in this repo.
- The app's own log is `~/Library/Logs/dev.cuongnb.herdrapp/` (`dev.cuongnb.herdrapp.dev` for `mise run dev`), not herdr's.
- `mise run dev` runs `Herdr Dev`, apart from the installed `Herdr.app`; a bare `tauri dev` shares the installed app's state.
