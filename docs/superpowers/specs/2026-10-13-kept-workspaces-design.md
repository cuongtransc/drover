# Kept workspaces

Date: 2026-10-13
Status: approved design, pending implementation plan

## Goal

A Session is one area of work, and the user goes back to the same few Workspaces in it every day.
herdr removes a Workspace when its last Pane closes, so today the user keeps a placeholder Terminal
open in each one (`ct-agent`, `ct-smarthomes`) just to keep it in the list. A **Kept workspace**
stays in its Session after its last Pane closes: it waits under **Closed** at the end of the Agents
column, and one click opens it again in its Workspace folder.

## Scope

In:
- Keep when closed: a checkbox item in the Workspace header's menu.
- The **Closed** section at the end of the Agents column, folded by default.
- Reopen: from a Closed row, and from a closed Bookmark of a Kept workspace.
- A Bookmark keeps its Workspace (ADR 0008).
- The layout file keeps fields it does not know.

Out:
- Keeping every Workspace ever opened: the list would fill with briefs and one-off investigations.
- Restoring Tabs, Panes or Agents: reopening makes a Workspace with one Terminal.
- Closed rows while the Session is stopped: the Stopped screen stays as it is.
- A marker on a Kept workspace's header: the menu's check says it (chosen 2026-10-13 over an icon and
  an accent-coloured label, from real renders).
- Changing herdr so an empty Workspace survives: that is upstream's.

## Model

A Kept workspace is keyed like a Bookmark, `machine/session/workspace-label` (`projectKey`), and
holds its folder:

```ts
interface Layout {
  tree: LayoutNode[];
  bookmarks: ProjectKey[];
  kept: Record<ProjectKey, { folder: string | null }>; // new
}
```

- `folder` is the Workspace folder when Keep is turned on (`getFolder`, else `suggestFolder`, else
  `null` = herdr's default cwd). **Change folder…** on a Kept workspace, live or closed, writes it too.
- A key is **closed** when its Session is running and lists no Workspace with that label. Two live
  Workspaces with one label share the key; the first is the one it names (as Bookmarks do).
- `kept` lives in the sidebar layout file (`layout.rs` stores the JSON, the UI owns its shape), not in
  localStorage: the folder store is keyed by `workspace_id` and pruned when the Workspace leaves, which
  is exactly the moment a Kept workspace needs its folder.

### Layout file compatibility

`parseLayout` today rebuilds the object from `tree` and `bookmarks`, so an older build that reads a
newer file and saves drops `kept`. Two changes:
- `parseLayout` reads `kept` (an object of `{ folder: string | null }`; a malformed entry is dropped,
  a missing field is `{}`).
- Every field the build does not know is kept and written back unchanged, so the next field added
  after this one survives older builds.

This build is the first to carry the second rule, so a pre-0008 build still drops `kept`. Accepted:
the user runs one installed build plus `Drover Dev`, which has its own layout file.

## Behaviour

| Event | What Drover does |
|---|---|
| Keep when closed (header menu, unchecked) | Adds `kept[key]` with the folder. Nothing else on screen changes. |
| Keep when closed (checked) | Removes `kept[key]`, unless the key is bookmarked (then the item is checked and disabled, note "Bookmarked"). |
| Bookmark | Also adds `kept[key]` when missing. Unbookmark leaves `kept` alone. |
| Live bookmarked Workspace without `kept` (Bookmarks from before this change) | Added once the Session's snapshot lists it, with its folder. A closed Bookmark with no `kept` entry stays as today: muted, `closed`, a click does nothing. |
| Last Pane closes / Close workspace | herdr removes the Workspace; its key becomes closed and its row shows under Closed. The Close workspace confirmation is unchanged. |
| Click a Closed row, or its `>_` button | `workspace.create { cwd: folder, label, focus: false }`, then select its root Pane (a Terminal). herdr appends it, so it shows last among the live Workspaces. |
| Closed row menu | **Reopen**, **Change folder…**, **Forget** (removes `kept[key]`; on a bookmarked key it also unbookmarks, since a Bookmark keeps its Workspace). |
| Click a closed Bookmark with `kept` | Reopens as above, then selects the Pane, with the view origin `bookmarks`. |
| Rename workspace… (Drover) | After herdr accepts, moves `kept` and the Bookmark from the old key to the new one. A rename outside Drover leaves the old key closed; the user Forgets it. |
| Session renamed / deleted / leaves its Machine | `kept` moves / is dropped with the Session's Bookmarks (`renameSessionKey`, `forgetSessions`, `forgetMachine`). |
| Reopen fails (folder gone, herdr error) | The error shows as other herdr calls' errors do (`onError`); the row stays under Closed. |
| Reopen while one is pending | The row is disabled until `workspace.create` returns or fails, so a double click makes one Workspace. |

## The Closed section

At the end of `.agents-list`, after the last Workspace group, when the running Session has at least
one closed key:

- A header row: chevron, **CLOSED** (the `.section-label` style), the count. Folded by default; the
  fold is remembered in `expanded` under `closed:<machine>/<session>`.
- Open: one row per closed key, in label order: a hollow dot, the label, the folder's last segment
  (`folderName`), a `>_` button on hover (always visible on the selected row).
- Shown under both Panes filters (Active and All); never counted in **Active N**.
- `Nothing active` / `No panes` still show when no Workspace is live; the Closed section sits under
  them.
- Text colours: label `--fg-3` at 500 weight, folder `--fg-3`; both already meet 4.5:1 in light and
  dark (`styles.css` notes 4.8:1 and 5.2:1).

Mockups (real renders, light and dark): main checkout `tmp/mockups/kept-ws/` (not in git).

## Components

| Unit | Change |
|---|---|
| `src/sidebar/groups.ts` | `Layout.kept`; `setKept`, `forgetKept`, `moveKept`; `setBookmarked` adds `kept`; `renameSessionKey` / `forgetSessions` / `forgetMachine` carry `kept`; `parseLayout` keeps unknown fields. |
| `src/workspaces/kept.ts` (new) | `closedKept(layout, machineId, session)` → closed keys with label and folder; `reopenKept(…)` (the `workspace.create` call and the selection). |
| `src/agents/ClosedSection.tsx` (new) | The section and its rows. |
| `src/agents/AgentList.tsx` | Header menu: Keep when closed; Change folder… and Rename workspace… update `kept`; render `ClosedSection`. |
| `src/sidebar/BookmarkRow.tsx` | Closed Bookmark with `kept` reopens on click. |
| Live-Bookmark backfill | Where `pruneFolders` runs on a Session snapshot: add `kept` for bookmarked keys that are live and missing. |
| `CONTEXT.md` | **Kept workspace**, **Closed section** (UI surfaces), Bookmark relationship. |
| `src/docs/uiMap.surfaces.ts` | The Closed section, if the UI map's sample data shows one. |

## Testing

- `groups.test.ts`: `kept` round-trips through `parseLayout`; malformed entries dropped; an unknown
  top-level field survives load → update → save; Bookmark adds `kept`; Forget on a bookmarked key
  unbookmarks; Session rename/delete and Machine forget carry or drop `kept`.
- `kept.test.ts`: closed keys from a snapshot (live label, duplicate labels, stopped Session → none);
  reopen calls `workspace.create` with label and folder, `cwd: null` when folder is null, selects
  the root Pane, and reports an error without dropping the key.
- `AgentList.test.tsx`: the menu's checkbox toggles `kept`; Closed folded by default, opens, shows
  under Active, not counted; a click reopens once on a double click; Rename moves the key.
- `BookmarkRow` test: a closed Bookmark with `kept` reopens; without it, nothing happens.
- A browser test (`*.browser.test.tsx`, real `styles.css`) for the Closed rows in light and dark at
  the default column width: label and folder do not overlap the `>_` button.
- Real run before the merge ask: `mise run app:install`, keep a Workspace, close its last Pane in
  the real app, see it under Closed, reopen it, check its cwd (`pwd` in the Terminal) and the layout
  file's `kept`.
