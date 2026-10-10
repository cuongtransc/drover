# 0006: Bookmarks hold projects, not Sessions

> Status: Accepted · Date: 2026-10-08 · Changes the **Bookmark** of `CONTEXT.md`
>
> Wording, 2026-10-10: "project" here is the Workspace; `CONTEXT.md` now says Workspace and Workspace row ("project" is avoided). The decision is unchanged.

## Context

A Bookmark pinned a Session to the top of the sidebar. A Session is an area of work (`ai-tools`,
`w-xb`), one per area and never one per project, so a user has about ten, and the SESSIONS tree
already shows every one of them: a Session Bookmark repeated a row the user could see. The unit the
user goes back to each day is a project (a Workspace: one repo or task), and that is the row that
gets lost, under a Group, inside a folded Session, or filtered out by Active while it is quiet.
Asked whether Bookmarks were worth anything, the answer was "not much"; asked which level they
should hold, the user chose projects after a mockup of both.

## Decision

- A Bookmark is a project, keyed `machine/session/workspace-label` (each part URI-encoded). The
  label, not herdr's `workspace_id`, so a Workspace opened again under the same name finds its
  Bookmark.
- A Bookmark row shows its project's state (dot, Blocked / Review, lanes), its name and its Session
  muted after it. A click opens the pane behind it, as the project's row in the tree does. Active
  never hides a Bookmark. A Bookmark whose Workspace or Session is gone stays, muted, saying
  `closed`; its menu removes it.
- Only a project row's menu bookmarks; the star moves from Session rows to project rows. A Session
  or Group dragged onto Bookmarks no longer bookmarks it; Bookmarks still reorder by drag.
- Renaming a Session carries its projects' Bookmarks; deleting it, or its leaving its Machine,
  drops them, as it does the Session's place in the tree.
- Session Bookmarks in an existing layout file are dropped when it is read (two keys on the user's
  Mac); the next change to the layout saves it without them.

## Consequences

The layout file's `bookmarks` changes meaning without a version field: an older build reading a
newer file sees project keys it cannot place and shows no Bookmarks, and loses nothing. Two
Workspaces with the same label in one Session share a Bookmark; herdr allows it, the sidebar opens
the first. The Bookmark row's Session name costs width at 248px; a long project name truncates the
Session name first.
