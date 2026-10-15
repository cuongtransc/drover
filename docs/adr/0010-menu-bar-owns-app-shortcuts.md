# 0010: The menu bar owns the app's ⌘ shortcuts

> Status: Accepted · Date: 2026-10-16

## Context

Drover's shortcuts (⌘K, ⌘J, ⌘E, ⌘P…, `src/shortcuts/actions.ts`) are caught by a `keydown`
listener in the webview (`App.tsx`). None of them shows anywhere: the macOS menu bar is Tauri's
default plus Settings and Quit. Apple's HIG puts keys in the main menus ("Show keyboard shortcuts
in your app's main menus, not in context menus") and asks that what a context menu offers is also
in the main interface. #173 took the keys out of Drover's context menus for that reason.

A menu item with a key equivalent takes that key before the web page. Checked 2026-10-16 in a
WKWebView with an `NSMenu` item on ⌘K and a focused `<textarea>`: ⌘K ran the menu item and the
page never saw a `keydown`, whether or not it called `preventDefault()`; `a` and ⌘L (not on the
menu) reached the page. wry calls WebKit's own `performKeyEquivalent` for a window's main
webview (it overrides it only for child webviews), so Drover behaves the same.

## Decision

Each Drover action with a shortcut is an item of the macOS menu bar carrying that shortcut as its
key equivalent, built in Rust from the user's bindings. The menu is the one path a bound key
takes: the item sends `menu://action/<id>` to the webview, which runs the action. The webview's
`keydown` listener no longer handles a key that is on the menu.

- Rebinding in Settings › Shortcuts sets the item's accelerator (`set_accelerator`).
- While Settings records a key, every Drover item's accelerator is cleared, so the recorder
  receives ⌘K and the rest; they are set again when recording ends.
- A shortcut that also belongs to an editor inside the page (⌘F, ⌘G, ⇧⌘G: CodeMirror's search
  while a file is edited) stays out of the menu bar until that editor can be reached from a menu
  event.

## Consequences

- The keys show where macOS users look for them, and change with the bindings.
- A menu key works wherever focus is in the window (Composer, terminal, a link), as the webview
  listener did for ⌘ chords; a bare key, Ctrl or Alt still reaches the terminal (§4.1).
- Tests that pressed a shortcut on `window` now send the menu event instead; the key path itself
  is checked in the installed app.

## Alternatives considered

- **Menu shows keys, the webview still handles them**: the menu takes the key first, so the
  webview listener would never run and the shortcuts would break.
- **A shortcuts sheet on ⌘/** instead of menus: cheaper, but not where macOS users look, and the
  HIG asks for the main menus.
