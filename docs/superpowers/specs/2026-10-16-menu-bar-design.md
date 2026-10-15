# Drover menu bar

Date: 2026-10-16 · Status: draft for review · Decision: [ADR 0010](../../adr/0010-menu-bar-owns-app-shortcuts.md)
· Design page: https://claude.ai/artifact/MKfwtM7fTr5rtnHVg4A6Re (B1, approved 2026-10-16)

## Goal

Every Drover action with a shortcut is in the macOS menu bar with its key, so the keys can be
found without Settings or the guide (Apple HIG). Context-menu actions on a file are reachable from
the menu bar too.

## Menus

| Menu | Items (key from the user's bindings) |
|---|---|
| Drover | About · Settings… ⌘, · Services · Hide · Quit ⌘Q (unchanged) |
| File | New Tab ⌘T · Go to File… ⌘P — Reveal in Finder ⌥⌘R · Open on this Mac · Copy Path ⌥⌘C — Remove Item ⌘W |
| Edit | Tauri's default (Undo, Redo, Cut, Copy, Paste, Select All) |
| View | Toggle Sidebar ⌘B · Focus Layout ⇧⌘B · Toggle Files Panel ⌘E · Agent Board ⇧⌘D — Bigger Font ⌘= · Smaller Font ⌘− · Default Font Size ⌘0 — Enter Full Screen |
| Go | Jump to Pane… ⌘K · Next Blocked or Review ⌘J · Previous Blocked or Review ⇧⌘J — Next Open Item ⇧⌘] · Previous Open Item ⇧⌘[ |
| Window | Tauri's default (Minimize, Zoom) |
| Help | Drover Guide · Keyboard Shortcuts… |

- **File items act on** the Chat path that has focus, else the file shown in Files (the active
  Open item when it is a file); with neither they are disabled. Reveal in Finder and Open on this
  Mac also need the file to be on this Mac. Open on this Mac has no key: a menu key works
  everywhere, and ⌘↩ belongs to terminals; ⌘↩ keeps working on a focused path.
- **Find** (⌘F, ⌘G, ⇧⌘G) stays off the menu bar in this change: while a file is edited,
  CodeMirror's search takes those keys inside the page, and a menu key would take them first.
- **Help › Drover Guide** opens `docs/guide/00-index.md` on GitHub in the browser.
  **Keyboard Shortcuts…** opens Settings › Shortcuts.
- Labels follow `ACTIONS` in `src/shortcuts/actions.ts`, which become the menu's single source.

## How a key runs

1. Rust builds the menu at startup from the bindings the frontend sends
   (`menu_set_shortcuts(bindings)`), and again whenever they change.
2. A key equivalent takes the key before the page (ADR 0010) and sends
   `menu://action/<id>`, as `menu://settings` does today.
3. The frontend runs the same function as today's `run[id]` in `App.tsx`, with today's guards
   (a dialog keeps `KEPT_BY_DIALOGS` actions). The `keydown` listener stays as the fallback
   outside the app (tests, the browser harness): in the app the menu takes those keys first, so
   it never runs them twice.
4. Settings › Shortcuts: starting to record clears every Drover item's accelerator; saving or
   cancelling sets them from the bindings again.
5. File items: the frontend reports the target (a path on this Mac, a remote path, or none) as it
   changes; Rust sets the items' `enabled`.

Accelerator strings come from a `Chord` in one function (`⌘` → `CmdOrCtrl`, `⇧` → `Shift`,
`⌥` → `Alt`, `⌃` → `Ctrl`, `KeyK` → `K`, `BracketLeft` → `[`, `Equal` → `=`, `Minus` → `-`), with a
test for every default binding.

## Out of scope

- Find in the menu bar (above), and moving ⌘S / ⇧⌘E (the editor's Save and Edit) into it.
- A menu for Sessions or Machines (no shortcuts today).

## Testing

- Rust: the menu built from the default bindings has each item, id and accelerator; a changed
  binding changes one accelerator; cleared accelerators while recording.
- Frontend: `menu://action/<id>` runs the action and keeps the dialog guard; the `keydown` path
  no longer runs a menu-carried action; Settings clears and restores accelerators around
  recording; the File target reported for a focused path, an open file, a remote file and none.
- Installed app (real run): each key from the Composer, the terminal and a focused path, once;
  rebinding ⌘K in Settings, then the new key works and the menu shows it.

## Docs in the same change

`ui-ux-guidelines` §4.1 (the shortcut map lives in the menu bar), §4.5 (keys are shown in the
main menus); the Files guide; `CONTEXT.md` (Menu bar surface).
