# File viewer Edit mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The File viewer opens in view mode and gains an Edit mode (CodeMirror 6) whose Save never silently overwrites a file that changed on disk.

**Architecture:** A port of the herdly fork's Edit mode. Rust gains a POSIX `cksum`, a version (`size`, `mtime`, `cksum`) on every whole text read, and `files_write`, which checks that version then writes atomically through the transport. The frontend keeps Drafts in a zustand store keyed by the Open item key, renders them with CodeMirror, and guards every path that could lose one (Done, closing items, the window, ⌘Q).

**Tech Stack:** Rust (Tauri 2, tokio, POSIX sh scripts over the transport), React 19 + zustand, CodeMirror 6, vitest (+ vitest browser).

**Spec:** `docs/superpowers/specs/2026-10-14-files-edit-mode-design.md` (decision record: `docs/adr/0009-file-viewer-edits-save-never-silently-overwrites.md`)

## Global Constraints

- **Port source is pinned:** herdly commit `f1b04d9` (`git show f1b04d9:<path>`; the ref `herdly/main` points at it in this repo). Copy from there, then adapt; never merge. Each commit message ends with `Ported from cuongnbms/herdly@f1b04d9 (<path list>).`
- **Out of scope, strip it when copying:** herdly's Create / Rename / Move / Delete (`CREATE_SCRIPT`, `RENAME_SCRIPT`, `MOVE_SCRIPT`, `DELETE_SCRIPT`, `create`, `rename`, `move_to`, `delete`, `check_name`, `script_error`, `src/files/edit.ts`, `dirtyUnder`, Draft `move`), `html.rs` / `HtmlView`, per-tab Open items (`itemsWith`, `tabs`), `history.ts`, `dockBadge` changes.
- **Drover differs from herdly:** one global `openItems` in `useApp` (no tabs); the item key is `itemKey(item)` in `src/store/openItems.ts`; temp file name `.<name>.drover-$$.tmp` (herdly: `.herdr-`); menu text "Quit Drover" comes from the app name, not hard-coded.
- **Error codes** (`AppError` code strings the frontend switches on): `conflict` (exit 6), `not_found` (exit 3), `invalid` (bad rel, text > `MAX_TEXT_BYTES`, target is a folder). Toast copy: `Cannot save <basename>: <message>`.
- **Dialog copy:** title `Unsaved Changes`; one file → `Save changes to <name>?`, several → `Save changes to N files?` followed by the list; buttons `Save` / `Save All` (several), `Discard`, `Cancel`.
- **Banner copy:** `File changed on disk` + `Reload` / `Overwrite`; `File was deleted` + `Save again` / `Close`.
- **Shortcuts:** ⌘⇧E toggles Edit/Done, ⌘S saves, Esc = Done (only when no dialog `.overlay` is open and the editor's search panel is closed). ⌘E stays the Files panel toggle.
- **Colours:** every text colour ≥ 4.5:1 against its background in light and dark; reuse existing CSS variables, add none that duplicate one.
- **Gate:** `mise run ci` passes at the end of every task (log to `/tmp/drover-ci-<task>.log`, never piped to `tail`). Frontend browser tests: `mise run test:browser`.
- **TDD:** each test step runs and fails before the code step.

## Review Focus

1. **A Draft is never replaced while dirty** — watch batches, ⌘R reloads and switching items back must keep the typed text and its undo history (Task 9 tests).
2. **CRLF files round-trip byte for byte** — saving a CRLF file with no edits writes identical bytes; mixed endings are not editable (Tasks 3, 4).
3. **Save during a save** — ⌘S twice, or Save All while a save runs, writes once and leaves the Draft consistent (Tasks 5, 7).
4. **ssh Machine on BSD (macOS) and GNU (Linux)** — `stat` fallback and `cksum` match on both (Task 3 test + Task 12 real run).
5. **Closing the item that is being edited through every path** — ×, middle click, Remove Others/Right/All, ⌘W, window close, ⌘Q (Tasks 7, 10).

---

### Task 1: POSIX `cksum` in Rust

**Files:**
- Create: `src-tauri/src/files/cksum.rs` (copy `f1b04d9:src-tauri/src/files/cksum.rs`)
- Modify: `src-tauri/src/files/mod.rs` (`pub mod cksum;`)

**Interfaces:**
- Produces: `pub fn cksum(bytes: &[u8]) -> u32` in `crate::files::cksum`

- [ ] **Step 1: Copy the file with its tests only**, replacing the body of `cksum` with `todo!()`; add the module to `mod.rs`. Keep herdly's tests and make sure one compares against the `cksum` binary:

```rust
#[test]
fn matches_the_cksum_binary() {
    for data in [&b""[..], b"a", b"hello world\n", &[0u8, 255, 13, 10][..]] {
        let mut child = std::process::Command::new("cksum")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        use std::io::Write;
        child.stdin.take().unwrap().write_all(data).unwrap();
        let out = String::from_utf8(child.wait_with_output().unwrap().stdout).unwrap();
        let want: u32 = out.split_whitespace().next().unwrap().parse().unwrap();
        assert_eq!(cksum(data), want, "{data:?}");
    }
}
```

- [ ] **Step 2:** `cd src-tauri && cargo test files::cksum` → FAIL (`not yet implemented`).
- [ ] **Step 3:** Restore herdly's body (CRC-32 polynomial `0x04C11DB7`, MSB-first, length appended little-end byte by byte, final complement).
- [ ] **Step 4:** `cargo test files::cksum` → PASS.
- [ ] **Step 5:** Commit `feat(files): POSIX cksum in Rust for the save version check`.

### Task 2: `files_read` reports `cksum` and `editable`

**Files:**
- Modify: `src-tauri/src/files/read.rs`, `src/lib/types.ts` (`FileContent`, new `FileVersion`)
- Test: `src-tauri/src/files/read.rs` (tests module)

**Interfaces:**
- Consumes: `cksum` (Task 1)
- Produces: Rust `FileContent { …, cksum: Option<u32>, editable: bool }`; `#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Debug)] pub struct FileVersion { size: u64, mtime: u64, cksum: u32 }`; `parse_stat` becomes `pub(super)`. TS: `FileContent` gains `cksum: number | null; editable: boolean`; `export interface FileVersion { size: number; mtime: number; cksum: number }`.

- [ ] **Step 1:** Add herdly's four tests verbatim from `git diff 914aa22 f1b04d9 -- src-tauri/src/files/read.rs`: `text_is_editable_with_its_cksum`, `invalid_utf8_and_truncated_text_are_not_editable`, `binary_and_images_are_not_editable`, `text_that_changed_size_while_read_is_not_editable` (uses `crate::files::Canned`, which exists here).
- [ ] **Step 2:** `cargo test files::read` → FAIL (no field `cksum`).
- [ ] **Step 3:** Apply the rest of that diff: fields, `FileVersion`, `pub(super) fn parse_stat`, and set `cksum`/`editable` only when `!truncated && body.len() as u64 == size`. Update the TS types and every TS fixture that builds a `FileContent` (`rg -l "truncated:" src -g '*.ts*'`) with `cksum: null, editable: false`.
- [ ] **Step 4:** `cargo test files::read` → PASS; `mise run typecheck` → clean.
- [ ] **Step 5:** Commit `feat(files): files_read reports a text file's cksum and whether it can be edited`.

### Task 3: `files_write` command

**Files:**
- Create: `src-tauri/src/files/edit.rs` (from `f1b04d9:src-tauri/src/files/edit.rs`: keep only `WRITE_SCRIPT`, `check_item`, `write_error`, `write`, and the tests listed below)
- Modify: `src-tauri/src/files/mod.rs` (`pub mod edit;`, module doc: Upload never overwrites (ADR-0005); Write replaces a file's content only after a version check (ADR-0009)), `src-tauri/src/commands.rs` (`files_write`), `src-tauri/src/lib.rs` (register), `src/lib/ipc.ts`

**Interfaces:**
- Consumes: `cksum`, `FileVersion`, `parse_stat` (Tasks 1–2); `exec_input`, `run_piped`, `TRANSFER_TIMEOUT`, `check_rel`, `script_argv`, `io_error` (exist).
- Produces: `pub async fn write(t: &dyn Transport, root: &str, rel: &str, text: &str, expected: Option<FileVersion>) -> AppResult<FileVersion>`; command `files_write(machine_id, root, rel, text, expected: Option<FileVersion>) -> FileVersion` (body as herdly `commands.rs:957`, using Drover's `files_root`); TS `filesWrite(machineId: string, root: string, rel: string, text: string, expected: FileVersion | null): Promise<FileVersion>`.

- [ ] **Step 1:** Port herdly's write tests: `refuses_the_root_and_unclean_paths`, `writes_over_the_expected_version_and_keeps_the_mode`, `a_changed_file_is_a_conflict_and_stays_untouched`, `expected_on_a_removed_file_is_not_found`, `force_overwrites_and_recreates_but_needs_the_folder`, `an_interrupted_transfer_leaves_the_file_untouched`, `writes_through_a_symlink_and_keeps_the_link`, `refuses_a_folder_too_much_text_and_unclean_paths`. Add:

```rust
#[tokio::test]
async fn crlf_bytes_come_back_unchanged_and_no_temp_file_is_left() {
    let (_t, r) = root();
    std::fs::write(format!("{r}/a.txt"), b"x\r\ny\r\n").unwrap();
    let c = read_file(&LocalTransport, &r, "a.txt").await.unwrap();
    let v = FileVersion { size: c.size, mtime: c.mtime, cksum: c.cksum.unwrap() };
    write(&LocalTransport, &r, "a.txt", "x\r\nz\r\n", Some(v)).await.unwrap();
    assert_eq!(std::fs::read(format!("{r}/a.txt")).unwrap(), b"x\r\nz\r\n");
    let names: Vec<_> = std::fs::read_dir(&r).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(names, vec![std::ffi::OsString::from("a.txt")]);
}
```

- [ ] **Step 2:** `cargo test files::edit` → FAIL.
- [ ] **Step 3:** Implement `write` and the script as herdly's, temp name `.<name>.drover-$$.tmp`. Register the command; add `filesWrite` to `ipc.ts`.
- [ ] **Step 4:** `cargo test files::edit` → PASS; `mise run ci` → passed.
- [ ] **Step 5:** Commit `feat(files): files_write saves only over the expected version, atomically`.

### Task 4: CodeMirror setup and the Drafts store

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (`pnpm add @codemirror/commands@^6.11.1 @codemirror/language@^6.13.0 @codemirror/language-data@^6.5.2 @codemirror/search@^6.7.2 @codemirror/state@^6.7.6 @codemirror/view@^6.43.14 @lezer/highlight@^1.2.5`)
- Create: `src/files/editorSetup.ts`, `src/files/editorSetup.test.ts`, `src/files/drafts.ts`, `src/files/drafts.test.ts` (from `f1b04d9`)

**Interfaces:**
- Produces (`editorSetup.ts`): `languageSlot: Compartment`, `editorExtensions(): Extension`, `createEditorState(text: string): EditorState`, `roundTrips(text: string): boolean`, `canEdit(c: FileContent): boolean`, `languageFor(rel: string): Promise<LanguageSupport | null>`.
- Produces (`drafts.ts`): `interface DiskVersion extends FileVersion { text: string }`, `interface DraftTarget { fk: string; machineId: string; root: string; rel: string }`, `interface Draft extends DraftTarget { state; base: DiskVersion; dirty; conflict: "changed" | "removed" | null; saving }`, `draftKey(fk: string, rel: string): string` (must equal `itemKey` of the file item: `"file:" + fk + "|" + rel`), `diskVersion(c: FileContent): DiskVersion | null`, `useDrafts` with `open, update, rebase, saved, setConflict, setSaving, touch, drop`, `isDirty(key: string): boolean`.

- [ ] **Step 1:** Copy both test files; drop the tests for `move` / `dirtyUnder`. Add:

```ts
import { itemKey } from "../store/openItems";
it("draftKey is the Open item key of the file", () => {
  const ws = { machine_id: "local", session: "s", workspace_id: "w" };
  expect(draftKey(filesKey(ws, "/r"), "a/b.md")).toBe(itemKey({ kind: "file", ws, root: "/r", rel: "a/b.md" }));
});
```

(`filesKey` from `./store`; adjust the `ws` literal to Drover's `WorkspaceRef` fields.)
- [ ] **Step 2:** `pnpm vitest run src/files/drafts.test.ts src/files/editorSetup.test.ts` → FAIL (modules missing).
- [ ] **Step 3:** Install deps; copy both modules without `move`, `dirtyUnder`, `relUnder`. Define `draftKey` in `drafts.ts` as `(fk, rel) => "file:" + fk + "|" + rel` and make `itemKey` in `openItems.ts` call it for file items (single source).
- [ ] **Step 4:** Same command → PASS; `mise run ci` → passed.
- [ ] **Step 5:** Commit `feat(files): Drafts hold a file's unsaved CodeMirror state`.

### Task 5: Saving a Draft

**Files:** Create `src/files/save.ts`, `src/files/save.test.ts` (from `f1b04d9`).

**Interfaces:**
- Consumes: `filesWrite` (Task 3), `useDrafts` (Task 4), `showToast` (`src/ui/Toast.tsx`).
- Produces: `saveDraft(key: string, opts: { force: boolean }): Promise<boolean>` — true when written; a second call while `saving` waits rather than writing twice.

- [ ] **Step 1:** Copy the tests (ok, conflict, not_found, other error → toast, Draft kept). Add one: two `saveDraft` calls without awaiting call `filesWrite` once.
- [ ] **Step 2:** `pnpm vitest run src/files/save.test.ts` → FAIL.
- [ ] **Step 3:** Copy `save.ts`; if herdly's version lets a second call write, make it return the running save's promise.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(files): saveDraft writes a Draft and records conflicts`.

### Task 6: `FileEditor` component

**Files:** Create `src/files/FileEditor.tsx`, `src/files/FileEditor.test.tsx` (from `f1b04d9`); Modify the files stylesheet that styles `.files-view` (find with `rg -l "files-view" src -g '*.css'`) with herdly's `.cm-*` rules from `git diff 914aa22 f1b04d9 -- '*.css'`; Create `src/files/FileEditor.browser.test.tsx`.

**Interfaces:**
- Consumes: `useDrafts`, `languageFor`, `languageSlot`.
- Produces: `<FileEditor draftKey={string} />`.

- [ ] **Step 1:** Copy the unit test. Write the browser test: mounts `FileEditor` for a `.ts` Draft, waits for a `.cm-content` token with a highlight class, and checks in both `data-theme="light"` and `"dark"` that `getComputedStyle` colour of `.cm-content`, `.cm-lineNumbers`, and a keyword span have contrast ≥ 4.5 against `.cm-editor` background (compute WCAG ratio in the test).
- [ ] **Step 2:** `pnpm vitest run src/files/FileEditor.test.tsx` and `mise run test:browser` → FAIL.
- [ ] **Step 3:** Copy the component and CSS; map any herdly-only CSS variable to Drover's.
- [ ] **Step 4:** Both → PASS.
- [ ] **Step 5:** Commit `feat(files): FileEditor edits a Draft with CodeMirror`.

### Task 7: Unsaved dialog and close guard

**Files:**
- Create: `src/files/unsaved.tsx`, `src/files/closeGuard.ts`, `src/files/closeGuard.test.tsx` (from `f1b04d9`)
- Modify: `src/store/openItems.ts` (+ test), `src/main/OpenStrip.tsx`, `src/App.tsx` (⌘W at line ~240; mount `<UnsavedDialog />`)

**Interfaces:**
- Consumes: `saveDraft`, `useDrafts`, `isDirty`, `Modal` (`src/sidebar/ContextMenu.tsx`).
- Produces: `closingKeys(s: OpenItems, scope: "one" | CloseScope, key: string): string[]` in `openItems.ts`; `askUnsaved(names: string[]): Promise<"save" | "discard" | "cancel">`; `settleDrafts(keys: string[]): Promise<boolean>`; `closeItemsGuarded(key: string, scope: "one" | CloseScope): Promise<void>` reading `useApp.getState().openItems` (no `itemsWith`).

- [ ] **Step 1:** Tests. In `openItems.test.ts`:

```ts
it("closingKeys lists what closeItems would remove", () => {
  const s = [a, b, c].reduce((acc, i) => openItem(acc, i, { pin: true }), NO_ITEMS);
  const k = s.items.map(itemKey);
  expect(closingKeys(s, "one", k[1])).toEqual([k[1]]);
  expect(closingKeys(s, "others", k[1])).toEqual([k[0], k[2]]);
  expect(closingKeys(s, "right", k[0])).toEqual([k[1], k[2]]);
  expect(closingKeys(s, "all", k[1])).toEqual(k);
  expect(closingKeys(s, "one", "nope")).toEqual([]);
});
```

(`a`, `b`, `c`: three file items from the file's existing fixtures.) Copy `closeGuard.test.tsx`, replacing per-tab setup with `useApp.setState({ openItems })`.
- [ ] **Step 2:** `pnpm vitest run src/store/openItems.test.ts src/files/closeGuard.test.tsx` → FAIL.
- [ ] **Step 3:** Implement `closingKeys` (same split as `closeItems`); copy `unsaved.tsx`, `closeGuard.ts`; route OpenStrip's four `closeItems` calls and App's ⌘W through `closeItemsGuarded`; render `<UnsavedDialog />` in `App`.
- [ ] **Step 4:** → PASS; `mise run ci` → passed.
- [ ] **Step 5:** Commit `feat(files): closing an item asks about its unsaved Draft`.

### Task 8: Edit mode in the File viewer

**Files:** Modify `src/files/FileViewer.tsx`; Create `src/files/FileViewer.edit.test.tsx` (from `f1b04d9`, the Edit / Save / Done / prompt cases).

**Interfaces:**
- Consumes: Tasks 4–7.
- Produces: toolbar group `role="group" aria-label="Edit"` with buttons `Edit` | `Save` + `Done`; disabled `Edit` titled `Mixed line endings`.

- [ ] **Step 1:** Copy the edit tests that do not involve the watch (those go in Task 9). Add: the viewer opens in view mode (no `.cm-editor`, `Edit` button present) for an editable file; no `Edit` button for an image, binary, truncated or invalid-UTF-8 file.
- [ ] **Step 2:** `pnpm vitest run src/files/FileViewer.edit.test.tsx` → FAIL.
- [ ] **Step 3:** Port herdly's FileViewer edit parts (`f1b04d9:src/files/FileViewer.tsx` lines 168–245 and the toolbar at ~297–340) into Drover's viewer: `edit` opens the Draft and calls `useApp.getState().pinItem(itemKey(item))`; `done` → `settleDrafts([key])`; ⌘S / ⌘⇧E / Esc per Global Constraints; hide Outline, Render/Source and FindBar while a Draft exists; render `<FileEditor>` instead of `<FileView>`.
- [ ] **Step 4:** → PASS; `mise run ci` → passed.
- [ ] **Step 5:** Commit `feat(files): Edit mode in the File viewer with Save and Done`.

### Task 9: Files watch, conflicts and the banner

**Files:** Modify `src/files/FileViewer.tsx` (`load` and the batch effect, lines ~55–95); extend `src/files/FileViewer.edit.test.tsx`.

**Interfaces:** Consumes `diskVersion`, `useDrafts().rebase/setConflict/touch`, `saveDraft(key, { force: true })`.

- [ ] **Step 1:** Port herdly's watch tests; they must cover: clean Draft rebased by a batch; dirty Draft keeps text + undo after a batch with a new cksum and shows `File changed on disk`; same cksum, new mtime → no banner; own save's echo → no banner; removed while dirty → `File was deleted`; Reload takes disk text; Overwrite calls `filesWrite` with `expected: null`; ⌘S while banner up does not write; switching to another item and back keeps the dirty text.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Port herdly `FileViewer.tsx` lines 57–96 into Drover's `load` / `setRemoved` paths and the banner markup + CSS.
- [ ] **Step 4:** → PASS; `mise run ci` → passed.
- [ ] **Step 5:** Commit `feat(files): a changed or deleted file never replaces a dirty Draft; Reload or Overwrite`.

### Task 10: Guard the window and ⌘Q

**Files:** Modify `src-tauri/src/lib.rs` (`app_menu`: replace predefined Quit with `MenuItem::with_id("quit", "Quit <app name>", …, "CmdOrCtrl+Q")`; `menu_event("quit") → Some("app://quit-requested")`), `src-tauri/src/commands.rs` (`app_quit`), `src-tauri/capabilities/default.json` (`core:window:allow-destroy`), `src/lib/ipc.ts` (`appQuit`, `onQuitRequested`), `src/App.tsx` (herdly `App.tsx:165–178`).

**Interfaces:** Produces `menu_event("quit") == Some("app://quit-requested")`, `fn quit_label(app_name: &str) -> String`.

- [ ] **Step 1:** In `lib.rs` tests change `assert_eq!(menu_event("quit"), None)` to `Some("app://quit-requested")` and add `assert_eq!(quit_label("Drover"), "Quit Drover")`. Frontend test: with a dirty Draft, the quit-requested handler opens the dialog and Cancel does not call `appQuit`; Discard does.
- [ ] **Step 2:** `cargo test menu` and the vitest file → FAIL.
- [ ] **Step 3:** Implement as herdly (`lib.rs:42–47,158–190`). `app.exit(0)` still ends in `RunEvent::Exit`, so Drover's existing teardown at `lib.rs:154` runs — keep it.
- [ ] **Step 4:** → PASS; `mise run ci` → passed.
- [ ] **Step 5:** Commit `feat(files): closing the window or quitting asks about unsaved Drafts`.

### Task 11: ● on the Open strip

**Files:** Modify `src/main/OpenStrip.tsx`, `src/main/OpenStrip.test.tsx`, its CSS.

- [ ] **Step 1:** Test: a file item with a dirty Draft has class `dirty` and its close button's label ends `(unsaved)`; a clean Draft has neither.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Port herdly `OpenStrip.tsx:68–69,92,108,188` and its `.dirty` CSS (● replaces × until hover).
- [ ] **Step 4:** → PASS; `mise run ci` → passed.
- [ ] **Step 5:** Commit `feat(files): unsaved items show a dot on the Open strip`.

### Task 12: Real checks and docs

**Files:** Modify `docs/guide/01-files.md` (Edit mode section: Edit button, ⌘⇧E, ⌘S, Done/Esc, conflict banner, what is not editable), `src/files/README` if any, spec `Status: implemented`.

- [ ] **Step 1:** Real ssh write: with an ssh Machine connected in a dev build, call `files_write` through the app on a scratch file in a Linux and (if available) a macOS remote; confirm saved bytes with `ssh <host> cksum <file>` equal the Rust `cksum`, and that a change made with `ssh <host> 'echo x >> <file>'` before Save shows the banner.
- [ ] **Step 2:** `mise run app:install`; walk the checklist (memory `ui-verify-checklist`): open a `.md` → view mode, Edit → type → ● appears → ⌘S → ● gone, file on disk changed; edit, then `echo x >> file` in a pane → banner; Reload; Overwrite; ⌘W with unsaved → dialog; ⌘Q with unsaved → dialog, Cancel keeps app; light and dark theme readable.
- [ ] **Step 3:** Docs; `mise run ci` → passed.
- [ ] **Step 4:** Commit `docs: Edit mode in the Files guide`.
