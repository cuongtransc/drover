# 0008: Drover keeps chosen Workspaces after herdr removes them, at the cost of state herdr does not know

> Status: Accepted · Date: 2026-10-13 · Extends the **Bookmark** of [0006](./0006-bookmarks-hold-projects.md)

## Context

herdr removes a Workspace when its last Pane closes. The user keeps one Session per area of work and
returns to the same Workspaces in it every day, so they leave a placeholder Terminal in each one
(`ct-agent`, `ct-smarthomes`) only to keep it listed. A Bookmark already outlives its Workspace
(0006), but it sits in the Sidebar, not in the Session's Agents column, and a closed Bookmark cannot
open anything: Drover forgets the Workspace folder with the `workspace_id`.

Source: [design spec](../superpowers/specs/2026-10-13-kept-workspaces-design.md)

## Decision

- Drover keeps a Workspace the user marks **Keep when closed**: its label and folder, keyed
  `machine/session/workspace-label` like a Bookmark, in the sidebar layout file. Closed, it shows
  under **Closed** at the end of the Agents column; a click makes the Workspace again with herdr's
  `workspace.create` in that folder.
- A Bookmark keeps its Workspace: bookmarking turns Keep on, and Forget on a closed bookmarked
  Workspace also unbookmarks it.
- The layout file keeps every field a build does not know and writes it back.

Keeping is the user's choice per Workspace, which beats both keeping every Workspace (the list
fills with one-off briefs and investigations) and the placeholder Terminal (a live shell per
Workspace, and one stray `exit` loses it).

## Consequences

Drover now owns a list of Workspaces herdr does not know. It drifts when a Workspace is renamed
outside Drover (the old label stays under Closed until Forgotten) and holds nothing of the old
Tabs: reopening gives one Terminal. Two Workspaces with one label share a key, as Bookmarks do.

A build from before this ADR rebuilds the layout from `tree` and `bookmarks` and drops `kept` when
it saves; from this build on, unknown fields survive.

## Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| Keep every Workspace ever opened | Briefs, lane checks and quick investigations would pile up under Closed with no signal of which matter. |
| Keep the placeholder Terminal, protected | Already the workaround; costs a live shell per Workspace and still shows a Pane row that means nothing. |
| A closed Bookmark is enough (no Kept) | Bookmarks sit in the Sidebar, across Sessions; the user wants the Workspaces in their Session's own view. |
| Patch herdr to keep empty Workspaces | herdr is upstream (`CLAUDE.md`): Drover works around it, never patches it here. |
| Keep the folder in localStorage by label | The layout file already holds the Bookmark keys it must move with on rename and Session changes; one store keeps them in step. |
