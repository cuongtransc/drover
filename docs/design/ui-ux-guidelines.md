# Herdr UI/UX guidelines

How Herdr's interface decides what to show, how it looks, and how it is driven. Every UI change is
checked against this page; a change that breaks a rule either fixes the rule here in the same PR
or does not ship.

Written 2026-10-07 from a three-role review (interaction & information architecture, visual
design, macOS platform & accessibility) of the app as it stood after the triage work
(`docs/superpowers/specs/2026-10-06-triage-design.md`). Where the roles disagreed, §8 records the
call and why. Terms follow `CONTEXT.md` (Machine › Session › Workspace › Tab › Pane).

The same tokens, rules and components as a browsable page, with live previews in both themes:
the [Herdr Design System](https://claude.ai/artifact/4xbvNjCSxGdWRzrVxgGNUq), built from
`src/styles.css` and this page (private to its owner until shared).

## 1. Who it is for, and the loop it serves

One person supervises many agents (claude, codex, pi…) running in parallel across Sessions on the
local Machine and SSH Machines. The day is a loop:

> **see who needs me → act on it → next.**

Everything else (starting sessions, arranging groups, reading a transcript at leisure) is
occasional. The interface is judged by how few looks, keys and pixels one turn of the loop costs,
and by how calm it is when nothing needs the user.

## 2. Principles

1. **Attention first, structure second.** Emphasis follows attention state: needs you (blocked) >
   working > done and unseen > idle > shell. The Machine › Session › Workspace › Tab tree is how
   rows are *grouped*, not what makes them loud. *Don't* give an idle agent the same card, badge
   and height as one waiting for input.
2. **Only the exceptions may shout.** Colour, tint, motion and a status *word* are spent on
   "needs you" (and, more quietly, "done and unseen"). Working is a quiet glyph; idle and shells
   carry no mark. If four things shout, none does.
3. **Constants are not content.** A value that is the same on (nearly) every sibling is not shown;
   only the exception is. *Don't*: "no folder" on every Workspace header, `local` on every local
   Session, an empty "—" pill on every shell. Absent data renders as nothing, not as a label.
4. **One fact, one source, one denominator.** Each count names what it counts and is derived from
   one predicate (`isActiveSession`, `triageQueue`). *Don't*: three unlabelled numbers side by side
   ("2 2 2"), or a raw pane total ("ca 10") that counts shells nobody acts on.
5. **Destinations are not headers.** A control that changes the whole view (the Agent Board,
   Settings) looks like a button or tab and sits apart from lists. A full-width strip above a list
   reads as that list's title. *Don't*: put a destination directly above "SESSIONS".
6. **Progressive disclosure along the hierarchy.** Level 1 shows Machines and Sessions, level 2
   Workspaces and the Panes that matter, the main area one Pane. Tabs, idle Panes and shells show as
   a count until asked for. Selection always reveals itself: the selected Pane is never folded away.
7. **Stable layout.** A state change recolours a row in place; it does not move it, resize it or
   insert rows under the pointer. Re-sorting happens at settle points (switching Session, pressing
   ⌘J), never live.
8. **Keyboard-first, every action has a keyboard path.** The loop runs on keys (⌘J, ⌘K, ⌘B). No
   action exists only on hover, drag or right-click. Global shortcuts are ⌘ chords only, because
   terminals and agents own bare keys, Ctrl, Alt and Esc.
9. **Status is never colour alone, and dimming never drops below 4.5:1.** Every status has a shape
   or word and an accessible name. "Quiet" is done with weight, size and position, not with low
   contrast or `opacity`.
10. **Quiet when nothing needs you.** The all-clear state is designed: no pill, no tint, calm
    columns. The end of the loop is the goal, not an empty screen.

## 3. Visual system

### 3.1 Status semantics and encoding

| State | Meaning | Colour | Mark in a list row | Word |
|---|---|---|---|---|
| blocked | waiting for the user's answer or approval | `--amber` | filled dot, pulsing (static under reduced motion) + 7% amber row tint | **Blocked**, in `--amber-text` |
| working | agent busy | `--blue` | spinning ring (a solid circle under reduced motion) | none (*In progress* in counts and accessible names) |
| done, unseen | finished since last viewed: its result waits for a look | `--green` | check glyph | **Review**, in `--green-text` |
| done, seen / idle | nothing to do | — | none (slot kept so titles align) | none (*Done* in counts) |
| shell / unknown | no agent | — | none | none |

- **One vocabulary, the task tracker's**: Blocked · In progress · Review · Done, everywhere a status
  is put in words (rows, the PANES chip "1 blocked · 1 review", the focus pill, the ⌘J queue, the
  Board columns, accessible names). A row carries a word only when the user has to act (Blocked,
  Review). Avoid "INPUT" (a system word: who inputs what?), "Needs you" (long), "waiting" (who waits
  on whom?) and "To do" (a tracker's *not started*).

- **One encoding per surface.** List row and Open item: mark + (for blocked) the word. The Top bar has no
  status of its own: the active Open item's mark is it (the Header's Status pill went on 2026-10-10). Never
  mark + badge + tint + border + glow on one row (a blocked card shows five signals today).
- **Tint is reserved for "needs you"**: `color-mix(in srgb, var(--amber) 7%, transparent)`, no border,
  no glow. Status colours are never used for anything that is not status.
- Tints come from three steps only: 7% (row), 14% (chip), 25% (border, high-contrast mode only).

### 3.2 Selection, focus, accent

- **Selection** is neutral: `--active` fill + title weight 600, and `aria-current="true"`. No accent
  border, no left bar (see §8, D4).
- **Focus** is the `--ring` (`:focus-visible`), shown together with selection when both apply.
- **`--accent`** is reserved for focus rings, links and primary buttons; it is never a status.
- Selected + blocked: neutral fill, the amber dot and the Blocked word stay.

### 3.3 Density

| Token (new) | Height | Used for |
|---|---|---|
| `--row-xs` | 24px | Workspace headers, folded "3 idle · 2 shells" lines |
| `--row-s` | 28px | every list row: sessions, panes, menus |
| `--row-l` | 40px+ | Agent Board cards only |

Lists use one-line rows. A second line is allowed only when it carries unique information (the
reason an agent is blocked) and only on that row. 28px is also the floor for drag-and-drop and
pointer targets (§5); no "compact" mode below 24px.

### 3.4 Type, spacing, radius, icons, motion

- **Type** (new tokens): `--fs-xs` 11 (meta, counters, caps section labels at 600),
  `--fs-s` 12 (secondary text), `--fs-m` 13 (row titles, body), `--fs-l` 15 (titles). The
  10/10.5/11.5/12.5/13.5/14/18px literals collapse into these; the chat font size stays a user
  setting. Weights: 400 body, 500 titles, 600 headers and the selected row.
- **Spacing**: 2/4/6/8/12/16 as `--s-1`…`--s-6`; row inline padding 8, section gaps 12.
- **Radius**: `--r-sm` 6 (rows, buttons, chips, tiles), `--r-md` 8 (inputs, popovers, cards),
  `--r-lg` 12 (dialogs), 999 (pills). No 3/5/7px.
  Never box a row inside a boxed container.
- **Icons**: 16px stroke glyphs, `--fg-3` at rest, `--fg-2` on hover, `--fg` when selected. The agent's
  brand mark is 16px with no tile in lists; the 24–26px tile belongs to Board cards and the new-agent
  picker.
- **Motion**: `--t-fast` 120ms (hover, press), `--t` 180ms (disclosure, layout), `--ease`. Two things
  loop: the blocked dot's pulse and the working ring; under reduced motion the dot holds still and
  the ring becomes a solid circle. The global `prefers-reduced-motion` rule
  (styles.css) stays and covers everything; no JS-driven animation.

### 3.5 Contrast (measured, WCAG 2.x)

**Rule: every text colour reads at 4.5:1 or more on every surface it can sit on, in both themes.**

- App UI: each token used as text (`TEXT` in `src/tokens.test.ts`) passes 4.5:1 on `--surface-0`
  through `--surface-3` and `--surface-code`. A mark colour (`--amber`, `--green`, `--blue`) is for
  dots and icons; text takes its `-text` variant. The test fails on a new faint token or on text
  that uses a mark colour.
- Terminal: xterm's `minimumContrastRatio` is `TERM_MIN_CONTRAST` (4.5) in both themes. Programs
  pick colours for a dark background (white, light 256-colour greys, truecolor); xterm raises any
  that fall short against their cell when drawing. Backgrounds keep their colour.
  `src/terminal/theme.browser.test.ts` checks the drawn colours in Chrome (`mise run test:browser`).
- Fix a failing colour by moving its lightness just far enough, keeping its hue; leave passing
  colours alone. Check light mode first: most use is there.

The 2026-10 audit, before the rule:

| Pair | Ratio | Verdict |
|---|---|---|
| dark `--fg-3` #6e717c on `--surface-1` / `--surface-0` | 3.34 / 3.54 | fails 4.5 |
| light `--fg-3` #868994 on `--surface-1` / white | 3.23 / 3.49 | fails 4.5 |
| light `--amber` #c27a10 on `--surface-1` | 3.20 | fails as text |
| light `--blue` #2f74e0 on `--surface-1` | 4.14 | fails as text |
| dark `--fg-2` / light `--fg-2` on `--surface-1` | 6.69 / 7.12 | passes |

Required token changes: dark `--fg-3` → `#8f929d` (5.2–5.5:1), light `--fg-3` → `#6a6d77`
(4.8–5.2:1), new `--amber-text` (light `#9a5f08`, 4.85:1; dark = `--amber`) for the Blocked word;
light blue is used for marks, never for text. `--grey` becomes `var(--fg-3)` in both themes.
Stopped and offline rows drop their `opacity: .7` / `.5`: quiet is `--fg-3` at the new value, nothing
lower. Vibrancy makes the sidebar backdrop vary with the wallpaper, so check new pairs over both a
light and a dark wallpaper.

### 3.6 Light/dark parity

Every colour is a token with a `[data-theme="light"]` twin, including the soft fills. Light
`--surface-2` must differ from `--surface-0` (today both are white, so raised cards vanish in light).
An `@media (prefers-contrast: more)` block restores a 1px `--line-3` border on the selected and
blocked rows.

## 4. Interaction and keyboard

### 4.1 Shortcut map

| Keys | Action |
|---|---|
| ⌘K | Jump to any pane (palette) |
| ⌘J / ⇧⌘J | Next / previous pane that needs you |
| ⌘B / ⇧⌘B | Hide the sidebar / focus on the main area |
| ⌘T | New tab with the default agent |
| ⇧⌘D (proposed, §7.2) | Open the Agent Board |

Reserved for later, in this order: ⌘N (new…), ⌘W (close pane, with confirmation), ⌘1–⌘9 (jump to
a bookmarked Workspace). **Never** bind bare letters, Ctrl-, Alt- or Esc at `window` level:
`keyHandler.ts` forwards everything but ⌘ chords to the terminal, and that contract stays. A new
⌘ shortcut is also gated while the palette or a dialog is open.

### 4.2 Lists

- One Tab stop per list, arrows inside (roving tabindex): ↑/↓ move, ←/→ fold/unfold, Home/End,
  Enter selects, Menu key or ⇧F10 opens the row's context menu. Handlers live on the list element,
  never on `window`.
- Hover-revealed controls (a Workspace header's "+", a row's close ×) are allowed only if they also
  appear on `:focus-visible` / `:focus-within` and on the selected row, and the same action is in the
  context menu and on a key.
- Every drag has a non-drag equivalent ("Move to group…", "Move tab left/right").

### 4.3 Destructive actions

One rule for closing a pane, a tab and a workspace: confirm when it can end a running process or
an agent's work (blocked or working), otherwise act at once. A pane follows it (`busyWhy`: an
agent working or blocked, a shell running a command; Cancel is the default); tabs and workspaces
still always confirm.

### 4.4 Counts and pills

- Outside the Board, counts come from the ⌘J queue (`triageQueue`: blocked, then done and unseen),
  hidden at 0. Where there is room for words they are split, **"N waiting · N done"** (waiting in
  `--amber-text`, done in `--green-text`), because a single "need you" sent the user looking for
  amber rows when the count was Done panes: the focus pill and the Agents column head do this. The
  Board button and Session rows, with only room for a number, show the total.
- A count that names things is also the way to them: the focus pill and the Agents column head
  step to the next one (in the session, for the column head), as ⌘J does.
- Working/done/idle counts live in the Board's column heads, labelled.

## 5. Accessibility checklist

- Every row has an explicit `aria-label`: "Fix login flow, claude, needs input" (not the concatenated
  text of its children).
- The selected row has `aria-current="true"`; collapsible headers are buttons with `aria-expanded`
  and an accessible name that includes their roll-up ("herdr-app, 1 needs you").
- Status: shape or word plus the name; never colour alone (deuteranopia: amber vs green).
- Text ≥ 4.5:1 against its real background (§3.5). Pointer targets ≥ 24px tall, contiguous along a
  list.
- Every action reachable by keyboard (§4.2); a status change announced through one polite live
  region ("2 need you"), not by re-reading the list.
- `user-select: none` on chrome is fine; paths and titles get a "Copy" menu item.

## 6. Engineering constraints for UI changes

- **Selectors return primitives or stable references.** Per-row state (selected, folded, needs you)
  is read inside the row with a boolean selector; no `filter`/`groupBy` inside a zustand selector.
  Every new piece of UI state ships with a `src/renders.test.tsx` case (selection must not
  re-render the sidebar).
- **One refit path.** Anything that changes the terminal's size goes through the same
  observer-driven fit as ⌘B/⇧⌘B; no manual `fit()` calls.
- **No list virtualization** at today's scale (tens of rows): it would break Tab order, `getByRole`
  tests and drag targets. Revisit above ~300 rows.
- **One predicate per meaning.** "Active" and "needs you" come from `activeFilter.ts` and
  `dashboard/triage.ts`; level 2 reuses them.
- **Tests address controls by role and name.** Renaming a control or a row's accessible name updates
  its tests in the same change.

## 7. Applying it: decisions for the current UI

These are the agreed directions; each lands in its own PR. Mockup (source of truth for layout and
copy of §7.1–§7.3; a Design-canvas `.dc.html`, sample data; screenshots are not committed):
[sidebar redesign](assets/2026-10-07-sidebar-redesign-mockup.html).

### 7.1 Level 2: the Agents column

- **Rows**: one line, 28px. `[16px agent mark] title … [mark slot]`; blocked adds the amber tint and
  the word Blocked. No icon tile, no badge line, no unlabelled "1"/"2" tab digits.
- **PANES Active N**: under the column head, the Sessions section's header and vocabulary (one
  toggle, `Active N`: on keeps what Active keeps, off shows All; the head's `+` centres over the rows'
  status marks),
  never scrolled away. Active (the default, persisted) keeps what needs a look: blocked, working,
  done-unseen, an agent whose state herdr cannot read (`?`), an agent idle for under the Active
  window (Settings › General, 15m–4h, default 1h; with its idle time, `12m`, so a Pane just looked at does not vanish), a shell running a command,
  and the selected Pane. It leaves out idle shells and agents idle longer; a Workspace left with
  nothing goes too (an empty one stays, to add to). All shows every Pane in order, the ones Active
  leaves out in quiet text. No per-Workspace fold line: a control that scrolls away cannot be found
  in a long list.
- **Shells** are read by their process (herdr `pane.process_info`): idle when the shell itself holds
  the terminal, else running, named by the command when untitled. Before the first read the title
  decides (`zsh`, `bash`, … and herdr's "Terminal" mean idle). A running shell shows as a normal row
  with no status mark: herdr reports no status for shells, so claiming "working" would be a guess
  (Q3).
- **Order within a Workspace**: the user's tab order; Active only leaves rows out.
- **Orchestrator and lanes**: tabs follow the ct-agent contract, `orch-*` the orchestrator,
  `lane-<slug>` its workers, `brief-*` decision tabs (without an `orch-` tab, the first agent outside
  lanes and briefs). Lanes sit right under the orchestrator, indented, without the `lane:` prefix,
  folded behind a muted "N lanes ›" at the end of its row (tooltip: their states). Folded, a lane
  still shows while it needs input or is selected. A lane's Done is the orchestrator's to read: it
  is not counted in the head chip, ⌘J, the Board count or the sidebar.
- **Workspace header**: 24px, label 12px/600 `--fg-2`, the folder's basename only when one is set
  (never "no folder"), a worst-status dot plus count when folded, "+" on hover/focus only. The header
  is a button that folds the Workspace; fold state persists per Workspace, and a fold never hides a
  blocked Pane (the header shows its dot and ⌘J unfolds it).
- **Tabs**: no bordered group box; Panes of a multi-tab Workspace show the tab name as a muted
  suffix only when it adds something. Tab drag-and-drop stays on the rows; ⌘J and selection unfold.
- **Column head**: Session name and "N need you" (hidden at 0). The raw pane count goes; "+" opens a
  New menu (workspace, agent, shell).
- **Stopped Session**: one line, "Stopped", with a Start button.

### 7.2 The Agent Board entry

The old bordered, tinted strip above SESSIONS that opened the Board is read as the list's title, and nobody
expects it to open a Kanban view. It goes. In its place:

- a labelled **Board** button with a columns (Kanban) icon in the titlebar control cluster, next to
  the sidebar toggle, visible in every layout including focus, carrying the amber "N need you" count
  (hidden at 0);
- **⇧⌘D** and a ⌘K command, "Open Agent Board";
- the Board keeps its overlay behaviour, and its column heads carry the labelled working/done/idle
  counts.

### 7.3 Level 1: the sidebar

**Section structure.** Today BOOKMARKS hangs under the SESSIONS label at the same level as the
Groups, but with a different header style (small caps and a star, against bold Group rows with a
folder). Its rows are indented like a Group's children, so it reads both as a section and as a
Group. A bookmarked Session shows twice and both rows light up when selected, and ungrouped Sessions
trail after the last (possibly nested) Group with no header, reading as its children. The fix:

- **Four sibling sections, one header style**: BOOKMARKS (only when not empty), SESSIONS, MACHINES,
  and QUOTA at the foot, each an 11px/600 caps label in `--fg-2` at x=16 with its fold chevron right
  after it, never at the left edge, where it would share a column with the rows' own chevrons. No fill:
  fill means selection. A 1px `--line` and 12px separate sections. A section's controls sit at the
  header's right end, well apart from its chevron: SESSIONS' `Active N` toggle (it never hides
  a Bookmark) and MACHINES' `+`, which centres over the machines' status dots.
- **Bookmarks are shortcuts to Workspaces, not a container** (ADR 0006). Their rows sit under the
  section header like any section's rows, without a guide line or fold chevron, and keep the user's
  order: the Workspace's status dot in the slot, its name, its Session muted after it, then Blocked /
  Review or its lanes. A click opens the pane behind it. Active never hides one; one whose Workspace
  is gone stays, muted, saying `closed`. A Workspace row's menu bookmarks it.
- **Two columns, one step.** Every row's first glyph sits in a 16px slot at x=16, centred in it: a
  fold chevron, a Bookmark's Workspace dot, a machine icon, a quota tile, or nothing for a Session with
  no Workspaces. Every name starts at x=40 (a Group's after its folder, at 64). A child level steps
  24, so its slot sits under its parent's first letter, with a 1px `--line-2` guide under the
  parent's glyph. `sidebarTree.browser.test.tsx` holds these numbers.
- **A click folds, like a folder in VS Code.** Every click on a Group or on a Session with Workspaces
  folds or unfolds it (a Session also opens), as do the chevron in its slot and ←/→ on the focused
  row. One rule, no click-then-click-again or double-click variants. Folded, a Session
  keeps its Blocked and Review Workspaces and the one holding the selected pane, and counts the rest in
  a last child row, `N more`, which unfolds it. Fold state persists per Session.
- **One selected row.** Selecting a Session highlights the row that was clicked. Its twin (the same
  Session in the other section) shows only the quieter "current" mark (`--hover` fill), so two rows
  are never both "selected".
- **Ungrouped Sessions get a place**: they come first in SESSIONS, before the Groups (or under an
  "Ungrouped" label when Groups exist), never after the last Group where they read as its children.
- Group nesting therefore steps 24px per level, the same step as every other child level.

**Rows.**

- A bookmarked Workspace keeps its row in the tree too (Q4); that row carries a small star after its
  name.
- Machine badge only for remote Machines; local Sessions show none.
- **A Session is the user's area; its Workspaces show under it.** Under each Session the tree lists its
  Workspaces with agent work (Blocked, Review, or In progress; every Workspace under All, the quiet
  ones muted), on the Session's guide line: status dot, name, then the word (Blocked / Review) or
  the lane count. State is the orchestrator's: a lane's Done is not the user's, a blocked lane is. A
  click opens the pane behind the row (the one asking, else the orchestrator), and that Workspace row
  is the lit one.
- So in the tree the Workspace rows carry what needs the user and the Session row has no count or
  tint; a Bookmark row carries its Workspace's word, as its row in the tree does.
- SESSIONS starts on **Active**; the "N hidden · idle or stopped · Show" line lists the rest.
  Like PANES, Active keeps a Session and a Workspace for the Active window after its agent (not a lane)
  stopped, muted with its age (`12m`): the user just looked at it and is likely to return. Rows
  keep the user's order: never re-sort by status (spatial memory).
- The Machines section stays at the bottom and folds by default once more than one Machine exists.
- **Quota at the foot**, outside the scroll, under Machines: one line per signed-in Provider or
  `cta` account (numbered when a Provider has several: "Claude 1", "Claude 2") with its most
  pressing window (a warning one, else the fullest): percent and time to reset in fixed columns,
  amber when it warns (§ quota tone: 90% used, or past 25% and used faster than the window
  elapses). Numbers that cannot be trusted never show: a failed poll, or a `cta` account not polled
  for 30 minutes, reads as a muted reason (`not polled · 1h`, `HTTP 403 · 9h`), and leaves the strip
  after a day.
- The strip **folds** under a QUOTA header like the sections above it (remembered, open by default).
  Folded, the header keeps one line: a full account only counts beside it (`· 1 full`), since it says
  nothing new until it resets; the line goes to the account that warns, else to the fullest one with
  room in plain text. Only when every account is full does it warn (`2 full · 2h`, the soonest reset).
  Untrusted numbers stay out, as in the strip.
- A click opens the **Quota panel** beside the strip: accounts by window (5 hours, Week, Month,
  Other), each trouble row saying what failed, when, and how to fix it; Providers not signed in
  fold into one line at its foot.

## 8. Decisions where the review disagreed

| # | Question | Positions | Decision |
|---|---|---|---|
| D1 | Row height | IA 26px · visual 28 or 32px · platform ≥ 28px for drag targets | **28px**, the same as level 1 |
| D2 | Status words | IA and visual: words only for exceptions · platform: keep words for accessibility | **Only Blocked and Review** keep a word; other states get a distinct shape plus an `aria-label` |
| D3 | Idle mark | platform: a hollow ring · IA and visual: nothing | **Nothing**; idle is the default and the slot keeps titles aligned |
| D4 | Selection style | visual (1): neutral fill, because `--accent` #7c8cff and `--blue` #5b9dff read alike · visual (2): accent fill and a bar | **Neutral** `--active` fill and weight 600, so "selected" never looks like "working" |
| D5 | Grouping | IA (1) and visual: keep Workspaces · IA (2): a flat, status-sorted view by default | **Keep Workspaces**, sorted inside by status at settle points; no status-flat view for now (Q1) |
| D6 | Folding | IA (2): auto-fold quiet Workspaces · platform: never hide blocked work, no accordion | **User-controlled fold**, persisted; idle Panes and shells are always folded; nothing urgent is ever hidden |
| D7 | Board entry | IA: a [Sessions \| Board] switcher or a toolbar button · visual: a nav row with a chevron, or the footer | **Toolbar button** in the titlebar cluster: it is visible in focus mode too and cannot be read as a list header |
| D8 | Dimming | visual: lighter `--fg-3` and opacity · platform: never below 4.5:1 | **Platform**: measured (§3.5); fix the tokens, drop the opacity |

## 9. Product owner decisions (2026-10-07)

- **Q1. A flat, status-sorted level 2?** No, not now. ⌘J, the Board and the in-Workspace status
  order cover the loop; a second view would duplicate the Board and add a toggle. Revisit if the
  user still scans the column after the compact rows ship.
- **Q2. The Board's name and shortcut?** "Board", ⇧⌘D. "Dashboard" promises read-only metrics,
  while the Board is a Kanban to act from. ⌘D stays free because terminals (iTerm) use it to split a
  pane.
- **Q3. Long-running shell commands?** Shown as a normal quiet row, not folded, with no status mark
  (§7.1). herdr gives shells no status, so the app shows that the process runs without claiming
  how it is doing.
- **Q4. A bookmarked Workspace in the tree too?** Yes, as `CONTEXT.md` defines a Bookmark
  (independent of where it sits): the tree stays complete and unbookmarking never moves anything.
  Only the clicked row is "selected"; the tree's Workspace row carries a star (§7.3). (Before ADR 0006
  this asked the same of a bookmarked Session.)
