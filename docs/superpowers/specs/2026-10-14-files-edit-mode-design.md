# File viewer Edit mode

Date: 2026-10-14
Status: implemented

## Purpose

Quick edits without leaving Drover: fix a config value, tweak a README, correct a line an Agent
got wrong. It works the same on the local Machine and on ssh Machines. It is not an IDE. The
File viewer opens in view mode; only the **Edit** button switches it to Edit mode. Agents write
to the same folders at the same time, so a save must never silently overwrite a file that
changed on disk after it was opened.

Ported from the herdly fork (`cuongnbms/herdly`, spec `2026-10-08-files-edit-design.md`,
ADR-0007 there), minus the parts that depend on its tree Rename and Delete, which Drover does
not have.

## Scope

In:

- **Edit mode** in the File viewer, entered with an **Edit** button (⌘⇧E; ⌘E already shows the
  Files panel), backed by CodeMirror 6: line numbers, undo/redo, search and replace, bracket
  matching, Tab indent, syntax highlighting by file extension.
- **Save** (⌘S), written only if the file on disk is still the version the edit started from
  (size, mtime, POSIX `cksum`), atomically (temp file, then `mv`).
- A conflict banner: **Reload** / **Overwrite** when the file changed, **Save again** /
  **Close** when it was removed.
- **Drafts** that survive switching Open items, a ● on the Open strip item of an unsaved file,
  and Save / Discard / Cancel before closing items, the window or the app loses one.

Out:

- Multi-cursor, autocomplete, folding, minimap, LSP, format on save, auto-save.
- Creating, renaming or deleting files (ADR-0005 still forbids them).
- Editing images, binary files, files cut at 2 MB, or text that is not valid UTF-8.
- Drafts across app restarts.

## Backend

### Version on read (`src-tauri/src/files/read.rs`, new `cksum.rs`)

`FileContent` gains:

- `cksum: Option<u32>`: the POSIX `cksum` CRC of the bytes read, computed in Rust (no gap
  between reading and hashing). `Some` only for untruncated text.
- `editable: bool`: true only for text that is not truncated **and** decodes as valid UTF-8.
  The text is decoded with `from_utf8_lossy` today, so saving invalid bytes would silently turn
  them into U+FFFD.

`cksum.rs` holds the CRC (polynomial `0x04C11DB7`, length appended), so the value equals the
`cksum` binary's on GNU and BSD.

### Write (`src-tauri/src/files/edit.rs`, command `files_write`)

```
files_write(machine_id, root, rel, text, expected: { size, mtime, cksum } | null)
  -> { size, mtime, cksum }
```

The text goes through stdin with `exec_input`, one path for local and ssh Machines. Rust checks
`check_rel(rel)` and refuses text over `MAX_TEXT_BYTES` with `invalid`. The shell script, run in
`root`:

1. Resolves `./rel`; a symlink is followed (`readlink` until not a link) so the link stays.
2. With `expected`: the file must exist as a regular file (else exit 3 → `not_found`); its
   `stat` size and mtime (GNU `stat -c`, BSD `stat -f` fallback) and `cksum` must equal
   `expected` (else exit 6 → `conflict`). Without `expected` (Overwrite, Save again) the file
   may be missing; its folder must exist.
3. Writes stdin to `.<name>.drover-$$.tmp` in the same folder.
4. Copies the original's mode to the temp file when the original exists.
5. `mv -f` the temp file over the target. A `trap` removes the temp file on any failure.
6. Prints the new `stat`; Rust computes the new `cksum` from `text`.

Default 30 s exec timeout. Accepted gaps (ADR-0009): an Agent writing between steps 2 and 5 is
overwritten; `mv` gives a new inode, owner and group become the app user's.

## Frontend

### Drafts (`src/files/drafts.ts`)

A zustand store keyed by the Open item key:

```ts
interface Draft {
  state: EditorState;                 // CodeMirror state, undo history included
  base: { text: string; size: number; mtime: number; cksum: number }; // disk version it starts from
  dirty: boolean;                     // !state.doc.eq(base text); undoing back to base clears it
  conflict: "changed" | "removed" | null;
  saving: boolean;
}
```

Actions: `open`, `update`, `rebase` (newer disk version while not dirty), `saved`,
`setConflict`, `drop`. A Draft exists from the moment Edit is pressed.

### Editor (`src/files/FileEditor.tsx`, `editorSetup.ts`)

An `EditorView` created from the Draft's state, writing each transaction's state back.
Extensions: `lineNumbers`, `history`, `search` (panel styled like the FindBar, replace
included), `keymap` with `indentWithTab`, `bracketMatching`, language by extension through
`@codemirror/language-data` (lazy imports from `'self'`, current CSP holds). The theme uses the
app's CSS variables; every text colour ≥ 4.5:1 in light and dark.

`\r\n` text gets `EditorState.lineSeparator.of("\r\n")`; the trailing newline is kept. Text that
does not round-trip byte for byte (mixed LF/CRLF, lone `\r`) shows a disabled Edit titled
"Mixed line endings".

### Save (`src/files/save.ts`)

`saveDraft(key, { force })` calls `files_write` with `expected = base` (`null` when forced):
ok → `saved`; `conflict` → `conflict = "changed"`; `not_found` → `conflict = "removed"`; other
errors → toast "Cannot save <name>: <message>", Draft kept. While `conflict` is set, ⌘S flashes
the banner instead of writing.

### File viewer (`src/files/FileViewer.tsx`)

- View mode is the default. **Edit** in the breadcrumbs when `editable`; ⌘⇧E toggles Edit/Done.
- In Edit mode: **Save** (⌘S, disabled when clean) and **Done** (Esc) replace Render/Source;
  Outline and FindBar are hidden; `FileEditor` takes the view.
- Edit pins a preview item, so opening another file never hides a Draft.
- Done when clean drops the Draft and returns to the previous mode; with unsaved changes it
  asks "Save changes to <name>?" — **Save / Discard / Cancel**.

### Files watch and ⌘R

- No Draft or a clean Draft: read again as today; a clean Draft is rebased.
- Dirty Draft: never replaced. Read the file, compare `cksum` with `base`: different →
  `changed`, gone → `removed`. A `touch` raises nothing; the app's own save already carries
  the new `cksum` in `base`, so its echo is ignored.

### Guards against losing a Draft (`closeGuard.ts`, `unsaved.tsx`)

- `closeItems` (one, Others, to the Right, All, ⌘W): dirty Drafts among the closed items are
  listed in one dialog — **Save All / Discard / Cancel**. A closed item's Draft is dropped.
- Window close: Tauri `onCloseRequested`. ⌘Q: the predefined Quit becomes a custom "Quit
  Drover" item (⌘Q) that emits `app://quit-requested`; the page asks first, then exits through
  an `app_quit` command. Quit from the Dock is not guarded.
- An ssh Machine going offline keeps the Draft; Save fails with a toast and can be retried.

### Open strip

A file item with a dirty Draft shows ● in place of × until hovered.

## Testing

TDD throughout.

- Rust (`cksum.rs`, `read.rs`, `edit.rs`, on `tempfile` with the local transport): write keeps
  the mode; mismatched `expected` → `conflict`, file untouched; forced write works, also on a
  removed file; symlink stays a symlink; CRLF bytes unchanged; > 2 MB → `invalid`; no temp
  file left after a failure; `editable` false for invalid UTF-8 and truncated text; Rust
  `cksum` equals the binary's.
- Vitest: `drafts` (dirty, undo to base, rebase, drop); `save` with mocked ipc (ok, conflict,
  not_found, other); `FileViewer` flow (Edit, type, ⌘S, Done, Save/Discard prompt, conflict
  banner, watch never replaces a dirty Draft); `closeItems` guard; ● on the Open strip.
- Browser test (vitest browser): CodeMirror mounts, a language loads lazily, colours in both
  themes.
- One real `files_write` against an ssh Machine (BSD and GNU `stat` paths).
- Real app via `app:install`, then a where/do/expect checklist for the user.

## Documentation

- ADR-0009 supersedes ADR-0005's "No edit … or overwrite"; Upload/Download rules unchanged.
- `CONTEXT.md`: the Files panel no longer "never edits"; new terms **Edit mode** and **Draft**,
  distinct from the Chat lens **Edit** (Rewind).
- `docs/guide/01-files.md`: an Edit mode section.
