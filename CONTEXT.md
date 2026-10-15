# Drover

A desktop client for [herdr](https://github.com/herdrdev/herdr) that browses and drives agent panes on the local computer and on remote computers.

Words shared with herdr, `cta` and the rest of the workstation (Session, Workspace, Claude session, Orchestrator, Lane, Lane brief, Decision brief, Agent Board…) are defined once in ct-workstation's `CONTEXT.md` ([map](https://g.devopsz.com/cocp/ct-workstation/src/branch/main/CONTEXT-MAP.md)); this file adds the app's own words and its screen.

## Language

**Drover**:
This desktop app (`Drover.app`; `Drover Dev.app` from `mise run dev`). Named Herdr before ADR 0007.
_Avoid_: Herdr, herdr-app, the client

**Machine**:
A computer where herdr runs: either `local` or a remote one reached by an SSH target (an alias from `~/.ssh/config` or `user@host`).
_Avoid_: host, PC, server, remote

**Session**:
A named persistent herdr session on a Machine; it owns exactly one herdr socket and is either running or stopped. The user keeps one per area of work (`w-xb`, `p-ai`), never one per project: herdr means a Session as an isolation boundary with its own server.
_Avoid_: server, instance

**Workspace**:
A group of Tabs inside a Session: one repo, task or investigation, as herdr means it. The sidebar lists a Session's Workspaces with agent work under it as Workspace rows.
_Avoid_: space, project

**Workspace folder**:
The folder the app remembers for a Workspace; Agents started from the app's UI run in a new Tab there. herdr itself does not know it.
_Avoid_: project dir, workspace cwd

**Group**:
A named, nestable set of Sessions the user arranges in the sidebar; it can hold Sessions from any Machine. herdr itself does not know it.
_Avoid_: folder, project

**Bookmark**:
A Workspace (by its Session and its label) the user pinned to the top of the sidebar, so
it is one click away however deep its Session sits, folded or filtered out (ADR 0006). It outlives
its Workspace: closed, it waits under the same name. Before ADR 0006 a Bookmark was a Session.
_Avoid_: favourite, pin

**Kept workspace**:
A Workspace (by its Session and its label) the app remembers with its Workspace folder after herdr
removes it, so it can be opened again from its Session (ADR 0008). The user turns it on per
Workspace; a Bookmark is always one. Closed, it waits under **Closed** in the Agents column.
_Avoid_: saved workspace, pinned workspace, dormant workspace

**Tab**:
A layout of Panes inside a Workspace. Its label says its role: `orch-*` the orchestrator, `lane-<slug>` a worker it dispatched (a lane's git worktree stays a Tab, never a Workspace of its own), `brief-*` a decision, or a one-word purpose for a shell (`dev`, `test`, `server`, `logs`). A bare number is herdr's default and names nothing.

**Pane**:
One cell of a Tab's layout, identified by `pane_id`; the unit the user selects and views.

**Terminal**:
The live terminal stream behind a Pane, identified by `terminal_id`; the thing that gets attached.
_Avoid_: pty, shell

**Attach**:
An exclusive connection to a Terminal's stream; herdr allows only one at a time per Terminal.

**Agent**:
A coding agent (Claude Code, pi, ...) that herdr detects running in a Pane, with an agent status of `working`, `blocked`, `done`, `idle` or `unknown`.

**Slash command**:
A command an Agent runs when a message starts with it (`/compact`, or `$name` for a Codex skill): a built-in, a user or project command, or a skill, including a plugin's.
_Avoid_: shortcut, macro

**Skill**:
A packaged set of instructions an Agent loads for a task, invoked by the user (as a Slash command) or by the Agent itself.
_Avoid_: plugin, extension

**Lens**:
A way of viewing a Pane: the **Terminal lens** (the raw attached terminal) or the **Chat lens** (the Agent's Transcript as a conversation).
_Avoid_: mode, view

**Files panel**:
The file tree of one Workspace under the agent list, following the active Open item, rooted at its Workspace folder (else the selected Pane's cwd). It reads files, moves files in by Upload and out by Download, and its File viewer edits a text file's content in Edit mode; it never renames or deletes (ADR-0005, ADR-0009).
_Avoid_: files overlay, file browser

**Open item**:
An Agent's Pane or a file the user opened, shown as an item in the **Open strip** above the main area, across all Machines and Sessions. Removing an item only takes it off the strip: its Pane keeps running.
_Avoid_: tab (a herdr Tab is a layout of Panes), close (closing ends a Pane or Tab; an item is removed), editor

**File viewer**:
The main area's view of the active file Open item.
_Avoid_: file lens (a Lens views a Pane)

**Edit mode**:
The File viewer's state in which the user changes a text file's content and saves it; the viewer opens in view mode and enters Edit mode only from its Edit button. Distinct from **Edit** in the Chat lens, which rewinds an Agent.
_Avoid_: editor, edit (alone)

**Draft**:
A file's unsaved content in Edit mode, together with the version on disk it started from. A Draft is dirty when it differs from that version; Save writes it only if the file on disk is still that version.
_Avoid_: buffer, unsaved file

**Files watch**:
The live feed of changes under the Files panel's root (`inotifywait`, a `find` poll loop, or FSEvents) that reloads the open file, the loaded folders of the tree and the CHANGED group. One at a time, owned by the Files panel.
_Avoid_: watcher (herdr's session watcher), polling

**Hidden folders**:
The folder names (Settings → Files; `.git`, `node_modules`, `target`… by default) left out of the Files tree, Go to file, `@` completion and the Files watch, at any depth and on every Machine. The panel's eye shows them in the tree only.
_Avoid_: heavy folders, ignored folders (that is `.gitignore`)

**Shortcut**:
A ⌘ chord that runs one app action (Jump to pane, Toggle Files panel, …), changed or set to None in Settings → Shortcuts. Keys that only act inside one view (find, reload, the Composer's keys) are not Shortcuts.
_Avoid_: hotkey, keybinding, accelerator (a macOS menu's own key)

**Transcript**:
The Agent's own conversation file (`.jsonl`) that the Chat lens reads.
_Avoid_: history, log

**Background task**:
A shell command or subagent an Agent started that keeps running after the tool call returned; the Agent is told when it ends and may then start a turn by itself.
_Avoid_: background job, async task, background shell

**Parked tail**:
The live reading of a Transcript kept after its Chat lens closed, so reopening that Chat lens resumes it instead of reading the Transcript again.
_Avoid_: cached chat, background tail

**Provider**:
The service an Agent's account belongs to (Claude, Codex, OpenCode Go, Grok); it owns a Quota.
_Avoid_: vendor, model

**Model**:
The language model an Agent answers with, as its Transcript records it (`claude-opus-5-5`); one Provider offers many.
_Avoid_: provider, engine

**Reasoning effort**:
How hard the Model is set to think, as the Transcript records it (`high`, `off`); never inferred.
_Avoid_: thinking level, effort mode

**Quota**:
How much of a Provider account's usage allowance is used, read on this Mac only. It belongs to the Provider, never to a Machine or an Agent.
_Avoid_: usage, limit, credits

**Window**:
One rolling or calendar period of a Quota (`5h`, `week`, `month`) with a used percent and a Reset.

**Reset**:
The moment a Window's used percent goes back to zero.

## UI surfaces

The names to use when talking about the screen, in issues, specs and prompts: each is what the
user sees, then where it lives. A numbered picture of all of them, light and dark:
[docs/design/ui-map.html](docs/design/ui-map.html). After a UI change, `mise run docs:ui-map` redraws it from
the real App; a surface added or renamed here goes into `src/docs/uiMap.surfaces.ts` too. Their tokens,
rules and previews: the [Herdr Design System](https://claude.ai/artifact/4xbvNjCSxGdWRzrVxgGNUq).

| Surface | What it is | Code |
|---|---|---|
| **Sidebar** | The left column: Bookmarks, Sessions, Machines | `src/sidebar/Sidebar.tsx` |
| **Layout controls** / **Board button** | Beside the traffic lights: ⌘B / ⇧⌘B, and the Agent Board with its count | `src/main/LayoutControls.tsx`, `.board-btn` |
| **Session row** | A Session in the Sidebar | `SessionRow` |
| **Workspace row** | A Workspace with agent work, under its Session row | `ProjectRows` (`src/sidebar/ProjectRows.tsx`), `sessionProjects` |
| **Sessions filter** | All \| Active on the Sessions header | `useSessionFilter` (`src/sidebar/activeFilter.ts`) |
| **Fold line** | "N hidden · idle or stopped" with Show, under what the Active filter keeps; Show also opens every Stopped fold | `.filter-hidden` in `GroupTree` |
| **Stopped fold** | "N stopped · names" at the end of a tree level (a group, or the top) holding its two or more stopped Sessions, folded by default; a lone stopped Session is a row of its own, last. The viewed Session keeps its place; words in the Sessions filter show stopped Sessions as rows; a stopped Session moved into a level opens its fold | `StoppedFold` in `GroupTree`, `src/sidebar/stoppedFold.ts` |
| **Agents column** | The middle column, headed by the Session name and PANES (its rows are Panes: agents and shells) | `src/agents/AgentList.tsx` |
| **Workspace header** | A Workspace's name over its Pane rows; + starts an agent in it | `.ws-head` in `AgentList.tsx` |
| **Pane row** | A Pane in the Agents column | `AgentCard` |
| **Closed section** | CLOSED WORKSPACES and its count, docked at the foot of the Agents column above the Files panel, folded by default: the Session's closed Kept workspaces, a click opens one again | `src/agents/ClosedSection.tsx` |
| **Panes filter** | All \| Active on the PANES header | `usePaneFilter` (`src/agents/paneFilter.ts`), `PanesHeader` |
| **Queue chip** | "1 blocked · 1 review" atop the Agents column | `SessionQueueChip` |
| **Fork** | A Claude pane's menu: Fork session / Fork into a new worktree opens a Tab running `claude --resume <id> --fork-session`; its Chat lens says where it came from | `src/agents/forkSession.ts` |
| **Side question** | A `/btw <question>` asked from the /btw column beside a Claude pane's chat (opened with the Composer's **/btw** key) or sent from the Composer: its answer, read off Claude's screen (it never reaches the transcript), shows in that column, earlier ones folded above it; Claude's own panel is closed right after | `src/chat/btw.ts`, `src/chat/BtwPanel.tsx` |
| **Edit** | The pencil on the user's last message in a Claude pane's Chat lens: Claude's Rewind goes back to before it (stopping a working Claude first, asking what to restore when it changed files) and the message returns to the Composer | `src/chat/rewind.ts`, `src/chat/EditPanel.tsx` |
| **Protected pane** | A lock on a Pane row: Close pane (Close tab on a one-pane Tab) is off, and closing its Tab, Workspace or Session names it first; orchestrators start protected | `src/agents/protect.ts` |
| **Lane toggle** | "N lanes ›" on an orchestrator's Pane row | `.lane-toggle` in `AgentList.tsx` |
| **Triage HUD** | The queue shown by ⌘J | `src/main/TriageHud.tsx`, `src/main/triage.ts` |
| **Agent Board** | The ⇧⌘D overlay, with the Quota column | `src/dashboard/AgentDashboard.tsx`, `QuotaColumn` |
| **Files panel** | Under the Pane rows in the Agents column; ⌘E shows and hides it, Browse files on a Workspace header | `src/files/FilesPanel.tsx`, `src-tauri/src/files/` |
| **Go to file** / **Files tree** | ⌘P's box and the folders under the Files panel's root | `src/files/GoToFile.tsx`, `src/files/FileTree.tsx` |
| **Top bar** | The main area's one bar, as tall as the columns' heads: the Open strip, then the Lens switch while a Pane fills the main area. It replaced the Header (Breadcrumb, Status pill) on 2026-10-10 | `src/main/TopBar.tsx` |
| **Open strip** | The Open items: the Agents and files you opened; two of one name say where they live (`zsh · drover`), the tooltip the whole path | `src/main/OpenStrip.tsx`, `src/store/openItems.ts` |
| **Lens switch** | Terminal \| Chat as two icons at the Top bar's end | `src/main/LensSwitch.tsx` |
| **File viewer** | The main area while a file's Open item is active | `src/files/FileViewer.tsx` |
| **CHANGED group** | Git's changes under the root, above the Files tree | `ChangedList`, `useChanged`, `files_changed` |
| **Chat lens** / **Terminal lens** | The main area, as a conversation or the raw terminal | `src/chat/ChatLens.tsx`, `src/terminal/TerminalLens.tsx` |
| **Work block** | One turn's work folded under "Worked for …"; Claude's thinking stays shown while folded | `src/chat/WorkBlockView.tsx` |
| **Queued messages** | Messages sent mid-turn that the agent has not read yet | `src/chat/QueuedMessages.tsx` |
| **Background tasks strip** | The Agent's running Background tasks above Queued messages, each with its time running; a row jumps to its tool card | `src/chat/BackgroundTasks.tsx` |
| **Working line** | The spinner and "Working 1m 23s" (counted from the prompt) over the Composer while the agent works | `src/chat/WorkingIndicator.tsx` |
| **Composer** / **Composer chips** | The message box and the reply buttons above it | `src/chat/Composer.tsx` |
| **Composer keys** | Esc, Ctrl+C, ⇧Tab sent as keys, right of the Composer chips | `.composer-keys` |
| **Git status line** / **Model label** | Under the message box: folder, branch, changes; model · effort · context | `GitStatusLine`, `.composer-model` |

Status words, everywhere a status is put in words (ui-ux-guidelines §3.1): **Blocked** = `blocked`,
**In progress** = `working`, **Review** = `done` not yet seen, **Done** = `done` seen or `idle`.
_Avoid_: INPUT, Needs you, waiting, To do

## Relationships

- A **Machine** has zero or more **Sessions**
- A **Session** is in at most one **Group**; a **Group** has zero or more **Sessions** and **Groups**
- A **Workspace** may be a **Bookmark**; a **Bookmark** names at most one live **Workspace** (none while it is closed)
- A **Workspace** may be a **Kept workspace**; every **Bookmark** is a **Kept workspace**; a **Kept workspace** names at most one live **Workspace** (none while it is closed)
- A running **Session** has one or more **Workspaces**; a **Workspace** has one or more **Tabs**; a **Tab** has one or more **Panes**
- Each **Pane** has exactly one **Terminal**
- A **Pane** has at most one **Agent**; an **Agent** has at most one **Transcript** the app can find
- A **Terminal** has at most one **Attach** at a time
- A **Provider** has one **Quota**; a **Quota** has one or more **Windows**, each with at most one **Reset**

## Example dialogue

> **Dev:** "When the user clicks a **Pane** on devtuf, do we **Attach** right away?"
> **Domain expert:** "Only in the **Terminal lens**. If the **Agent** is Claude Code and we find its **Transcript**, the **Chat lens** opens and nothing is attached."

## Flagged ambiguities

- "space" (user's word) resolved: it is herdr's **Workspace**.
- "Herdr" (capitalised) was this app's old name: in dated docs it means **Drover**; bare "herdr" is always the multiplexer.
- "session" means a herdr named **Session**, never an agent's conversation; that is a **Transcript**.
