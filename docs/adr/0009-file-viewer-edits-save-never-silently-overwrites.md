# 0009: The File viewer edits a file's content; Save never silently overwrites, accepting a millisecond race

> Status: Accepted · Date: 2026-10-14 · Supersedes the "No edit … or overwrite" rule of [0005](./0005-files-write-only-by-upload-never-overwrite.md)

## Context

[0005](./0005-files-write-only-by-upload-never-overwrite.md) made Upload the only write into a
Workspace. Users now want quick edits in Drover (a config value, a README line, a line an Agent
got wrong) on the local Machine and on ssh Machines. A save replaces a file's content, and
Agents write to the same files at the same time; losing an Agent's write without anyone
noticing is what 0005 was written to prevent. The herdly fork solved this (its ADR-0007);
Drover ports that design.

Source: [design spec](../superpowers/specs/2026-10-14-files-edit-mode-design.md)

## Decision

- The File viewer opens in view mode and gains an **Edit mode** (CodeMirror 6), entered only by
  the Edit button or ⌘⇧E, and offered only for untruncated, valid UTF-8 text.
- **Save checks before it writes.** The Draft remembers the version it started from (size,
  mtime, POSIX `cksum`). Save writes only if the file on disk still matches; otherwise it writes
  nothing and offers **Reload** / **Overwrite**. Overwrite is always a deliberate click.
- **The write is atomic:** temp file in the same folder, the original's mode copied, `mv -f`
  over the file (through a symlink to its target).
- The Files watch never replaces a dirty Draft; a change on disk raises the conflict banner.
- Upload and Download keep 0005's rules. Create, rename, move and delete stay out.

A check-then-atomic-write keeps an Agent's write from being lost unnoticed, which "Save always
overwrites" does not; `cksum` joins size and mtime because mtime has one-second resolution and
a same-second, same-size rewrite would otherwise pass.

## Consequences

- An Agent writing in the few milliseconds between the check and the `mv` is overwritten.
  Closing that gap needs locking that Agents don't take part in.
- `mv` gives the file a new inode; owner and group become the app user's. A process holding the
  old file open keeps the old content. This is how most editors save.
- Each save reads the file once more on the Machine for its `cksum` (at most 2 MB).
- ⌘Q goes through the page so unsaved Drafts are asked about; Quit from the Dock is not guarded.

## Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| Save always overwrites | Silently loses an Agent's write made while the file was open. |
| Lock editing while an Agent in the Workspace is `working` | The Agent may not touch that file; its status says nothing about which files it writes. |
| Check size and mtime only | Same-second, same-size rewrites pass. |
| Write in place (`cat > file`) | An Agent can read a half-written file; a failed write leaves it truncated. |
| Monaco | Several MB, needs web workers that `script-src 'self'` blocks. |
| A plain textarea | No highlighting, weak undo, no search; slow on long files. |
