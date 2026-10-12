# Kept Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Workspace the user keeps stays in its Session after herdr removes it, listed under a folded **Closed** section at the end of the Agents column, and one click makes it again in its folder.

**Architecture:** The sidebar layout file gains `kept: Record<ProjectKey, { folder }>` beside `bookmarks`, keyed `machine/session/label`; pure helpers in `groups.ts` keep it in step with Bookmarks and Session changes. `src/workspaces/kept.ts` (pure) derives the closed keys from a Session snapshot; `src/workspaces/keptActions.ts` (store-aware) reopens one through herdr's `workspace.create` and saves folders. `ClosedSection` renders them in the Agents column.

**Tech Stack:** React 19 + zustand + vitest (jsdom, and browser mode for `*.browser.test.tsx`), Tauri 2 (the layout file is stored as opaque JSON by `src-tauri/src/layout.rs`; no Rust change).

**Spec:** `docs/superpowers/specs/2026-10-13-kept-workspaces-design.md` (ADR: `docs/adr/0008-drover-keeps-closed-workspaces.md`)

## Global Constraints

- Keys: a Kept workspace's key is `projectKey(machineId, session, label)` from `src/sidebar/groups.ts`; never `workspace_id`.
- `Layout.kept` is optional (`kept?: Record<ProjectKey, KeptEntry>`); every reader uses `layout.kept ?? {}`. A helper that changes nothing returns the same `layout` object (the store skips the save on identity).
- Every `groups.ts` function that returns a new layout spreads `...layout` first, so fields a build does not know survive (ADR 0008).
- `src/sidebar/groups.ts` must not import from `src/store/` or `src/workspaces/` (the store imports it). `src/workspaces/kept.ts` imports only types and `groups.ts`. Anything calling herdr or the store lives in `src/workspaces/keptActions.ts`.
- UI copy, exactly: menu item `Keep when closed`, its note when bookmarked `Bookmarked`; section label `Closed`; row menu `Reopen`, `Change folder…`, `Forget`; reopen button aria-label `Reopen <label>`.
- Fold key for the Closed section: `closed:<machineId>/<session>` in `useApp().expanded`, default folded (`?? false`).
- herdr call to reopen: `workspace.create` with `{ cwd: folder, label, focus: false }` (`cwd: null` when the folder is null); then `setFolder` for the new `workspace_id` when the folder is non-null, then `useApp.getState().select(rootPane)`.
- Errors from herdr surface through `useActions().guard` (the action error line); never swallowed.
- Text colours only from existing tokens `--fg-3` / `--fg-2` (both ≥4.5:1 in light and dark); no new colour.

## Review Focus

- Double click on a Closed row: exactly one `workspace.create` (Task 4 test pins it).
- A reopen that fails (folder gone): the row stays under Closed and the error shows (Task 3 test).
- A stopped Session or a disconnected Machine: no Closed rows, and no backfill writes (Task 2 tests).
- Two live Workspaces with the same label: the key is live, not closed (Task 2 test).
- A layout file saved by this build and read again keeps an unknown top-level field (Task 1 test).

---

### Task 1: Layout model: `kept` and unknown fields

**Files:**
- Modify: `src/sidebar/groups.ts` (`Layout`, `parseLayout`, `setBookmarked`, `forgetWhere`, `renameSessionKey`; new `setKept`, `forgetKept`, `renameProjectKey`)
- Test: `src/sidebar/groups.test.ts`, `src/sidebar/groups.store.test.ts`

**Interfaces:**
- Produces:
  - `export interface KeptEntry { folder: string | null }`
  - `Layout.kept?: Record<ProjectKey, KeptEntry>`
  - `setKept(layout: Layout, key: ProjectKey, folder: string | null): Layout` — adds or replaces the entry; same object when equal.
  - `forgetKept(layout: Layout, key: ProjectKey): Layout` — removes the entry and the key's Bookmark.
  - `renameProjectKey(layout: Layout, from: ProjectKey, to: ProjectKey): Layout` — moves the kept entry and the Bookmark (keeping its position).
  - `setBookmarked(layout, key, on, folder: string | null = null)` — on: also adds `kept[key] = { folder }` when missing.

- [ ] **Step 1: Write the failing tests** — append to `src/sidebar/groups.test.ts` (add `forgetKept, renameProjectKey, setKept` to the import from `./groups`):

```ts
describe("kept workspaces", () => {
  const k = projectKey("local", "ai", "drover");
  const other = projectKey("local", "other", "w");
  it("keeps a workspace with its folder and forgets it", () => {
    const a = setKept(EMPTY_LAYOUT, k, "/x/drover");
    expect(a.kept).toEqual({ [k]: { folder: "/x/drover" } });
    expect(setKept(a, k, "/x/drover")).toBe(a);
    expect(setKept(a, k, "/y").kept).toEqual({ [k]: { folder: "/y" } });
    expect(forgetKept(a, k).kept).toEqual({});
    expect(forgetKept(EMPTY_LAYOUT, k)).toBe(EMPTY_LAYOUT);
  });
  it("bookmarking keeps the workspace; unbookmarking leaves it kept", () => {
    const a = setBookmarked(EMPTY_LAYOUT, k, true, "/x/drover");
    expect(a.kept).toEqual({ [k]: { folder: "/x/drover" } });
    const b = setBookmarked(a, k, false);
    expect(b.bookmarks).toEqual([]);
    expect(b.kept).toEqual(a.kept);
  });
  it("bookmarking leaves an existing kept folder alone", () => {
    expect(setBookmarked(setKept(EMPTY_LAYOUT, k, "/old"), k, true, "/new").kept?.[k]).toEqual({ folder: "/old" });
  });
  it("forgetting a bookmarked workspace unbookmarks it", () => {
    const a = forgetKept(setBookmarked(EMPTY_LAYOUT, k, true, null), k);
    expect(a.bookmarks).toEqual([]);
    expect(a.kept).toEqual({});
  });
  it("a renamed workspace carries its kept entry and its bookmark, in place", () => {
    const to = projectKey("local", "ai", "drover-2");
    const base = setBookmarked(setBookmarked(EMPTY_LAYOUT, k, true, "/x"), other, true, null);
    const a = renameProjectKey(base, k, to);
    expect(a.bookmarks).toEqual([to, other]);
    expect(a.kept).toEqual({ [to]: { folder: "/x" }, [other]: { folder: null } });
    expect(renameProjectKey(EMPTY_LAYOUT, k, to)).toBe(EMPTY_LAYOUT);
  });
  it("a renamed Session carries its kept entries; a forgotten Session or Machine drops them", () => {
    const base = setKept(setKept(EMPTY_LAYOUT, k, "/x"), other, null);
    expect(Object.keys(renameSessionKey(base, sessionKey("local", "ai"), sessionKey("local", "ai2")).kept!)).toEqual([
      projectKey("local", "ai2", "drover"), other,
    ]);
    expect(Object.keys(forgetSessions(base, [sessionKey("local", "ai")]).kept!)).toEqual([other]);
    expect(forgetMachine(base, "local").kept).toEqual({});
  });
  it("keeps fields it does not know through every change", () => {
    const x = setKept({ ...EMPTY_LAYOUT, future: 1 } as Layout, k, null);
    const future = (l: Layout) => (l as unknown as { future?: number }).future;
    expect(future(x)).toBe(1);
    expect(future(forgetSessions(x, [sessionKey("local", "ai")]))).toBe(1);
    expect(future(renameSessionKey(x, sessionKey("local", "ai"), sessionKey("local", "b")))).toBe(1);
    expect(future(forgetMachine(x, "local"))).toBe(1);
    expect(future(renameProjectKey(x, k, projectKey("local", "ai", "z")))).toBe(1);
  });
});
```

Append to the `describe("layout file", …)` block of `src/sidebar/groups.store.test.ts`:

```ts
  it("reads kept workspaces, drops malformed entries, and saves unknown fields back", async () => {
    const f = io({ ...l, kept: { "local/x/app": { folder: "/a" }, "local/x/b": { folder: null }, "local/x/c": { folder: 3 }, bad: "no" }, future: { v: 2 } });
    await initLayout(f);
    expect(useLayout.getState().layout.kept).toEqual({ "local/x/app": { folder: "/a" }, "local/x/b": { folder: null } });
    useLayout.getState().update((x) => ({ ...x, bookmarks: [] }));
    await flush();
    expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ future: { v: 2 } }));
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/sidebar/groups.test.ts src/sidebar/groups.store.test.ts`
Expected: FAIL — `setKept is not a function` (and the store test's `kept` undefined).

- [ ] **Step 3: Implement in `src/sidebar/groups.ts`**

- `parseLayout`: return `{ ...p, tree, bookmarks: filtered, kept }` where `kept` keeps only entries whose key passes `isProjectKey` and whose value is an object with `folder` a string or `null`; omit `kept` when the file has none.
- `forgetWhere` and `renameSessionKey`: build the result with `...layout`, and carry `kept` by `sessionOf(key)` exactly as they carry `bookmarks` (same identity rules: unchanged → same object).
- New helpers per the Interfaces block; `renameProjectKey` replaces the Bookmark in place (`map`, not filter + push).

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run src/sidebar/`
Expected: PASS, including the existing Sidebar and groups tests.

- [ ] **Step 5: Commit**

```bash
git add src/sidebar/groups.ts src/sidebar/groups.test.ts src/sidebar/groups.store.test.ts
git commit -m "feat(sidebar): the layout keeps workspaces with their folder, and fields it does not know"
```

---

### Task 2: Closed keys and the Bookmark backfill

**Files:**
- Create: `src/workspaces/kept.ts`, `src/workspaces/kept.test.ts`
- Modify: `src/workspaces/folder.ts` (new `workspaceFolder`), `src/store/app.ts` (`upsertMachine`)
- Test: `src/store/app.test.ts`

**Interfaces:**
- Consumes: `KeptEntry`, `Layout.kept`, `setKept`, `projectKey` (Task 1).
- Produces:
  - `export interface ClosedKept { key: ProjectKey; label: string; folder: string | null }`
  - `closedKept(layout: Layout, machine: MachineView, session: SessionView): ClosedKept[]` — `[]` unless `machine.state === "connected"` and `session.running`; keys of this Session whose label no live Workspace has; sorted by label (`localeCompare`).
  - `backfillKept(layout: Layout, machine: MachineView, folderOf: (session: string, ws: WorkspaceView) => string | null): Layout` — for each bookmarked key of a connected Machine's running Session whose Workspace is live and that has no `kept` entry, `setKept(…, folderOf(...))`. Same object when nothing changes.
  - In `folder.ts`: `workspaceFolder(machineId: string, session: string, ws: WorkspaceView): string | null` = `getFolder(ref) ?? (suggestFolder(ws) || null)`.

- [ ] **Step 1: Write the failing tests** — `src/workspaces/kept.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EMPTY_LAYOUT, projectKey, setBookmarked, setKept } from "../sidebar/groups";
import type { MachineView, SessionView, WorkspaceView } from "../lib/types";
import { backfillKept, closedKept } from "./kept";

const ws = (id: string, label: string): WorkspaceView => ({
  workspace_id: id, label, number: 1, status: "idle",
  tabs: [{ tab_id: id + ":t", label: "1", number: 1, status: "idle", panes: [{ pane_id: id + ":p", terminal_id: "t", title: "zsh", cwd: "/c/" + label, agent: null, status: "idle" }] }],
});
const session = (name: string, running: boolean, ...w: WorkspaceView[]): SessionView => ({ name, running, status: "idle", error: null, workspaces: w });
const machine = (state: MachineView["state"], ...s: SessionView[]): MachineView => ({
  id: "local", label: "local", kind: "local", state, error: null, version: "0.9.3", status: "idle", sessions: s,
});
const k = (label: string, s = "ct") => projectKey("local", s, label);

describe("closedKept", () => {
  const layout = setKept(setKept(setKept(setKept(EMPTY_LAYOUT, k("zeta"), "/z"), k("agent"), null), k("infra"), "/i"), k("x", "other"), "/x");
  it("lists this Session's kept workspaces no live workspace carries, by label", () => {
    const s = session("ct", true, ws("w1", "infra"));
    expect(closedKept(layout, machine("connected", s), s)).toEqual([
      { key: k("agent"), label: "agent", folder: null },
      { key: k("zeta"), label: "zeta", folder: "/z" },
    ]);
  });
  it("counts a label two live workspaces share as live", () => {
    const s = session("ct", true, ws("w1", "zeta"), ws("w2", "zeta"), ws("w3", "agent"));
    expect(closedKept(layout, machine("connected", s), s).map((c) => c.label)).toEqual(["infra"]);
  });
  it("lists nothing for a stopped Session or a Machine that is not connected", () => {
    const stopped = session("ct", false);
    expect(closedKept(layout, machine("connected", stopped), stopped)).toEqual([]);
    const s = session("ct", true);
    expect(closedKept(layout, machine("connecting", s), s)).toEqual([]);
  });
  it("lists nothing without kept workspaces", () => {
    const s = session("ct", true);
    expect(closedKept(EMPTY_LAYOUT, machine("connected", s), s)).toEqual([]);
  });
});

describe("backfillKept", () => {
  const folderOf = (_s: string, w: WorkspaceView) => "/c/" + w.label;
  it("keeps a live bookmarked workspace that is not kept yet, with its folder", () => {
    const layout = { ...EMPTY_LAYOUT, bookmarks: [k("infra"), k("gone")] };
    const m = machine("connected", session("ct", true, ws("w1", "infra")));
    expect(backfillKept(layout, m, folderOf).kept).toEqual({ [k("infra")]: { folder: "/c/infra" } });
  });
  it("changes nothing when every live bookmark is kept, or the snapshot is not authoritative", () => {
    const kept = setBookmarked(EMPTY_LAYOUT, k("infra"), true, "/old");
    const m = machine("connected", session("ct", true, ws("w1", "infra")));
    expect(backfillKept(kept, m, folderOf)).toBe(kept);
    const bare = { ...EMPTY_LAYOUT, bookmarks: [k("infra")] };
    expect(backfillKept(bare, machine("error", session("ct", true, ws("w1", "infra"))), folderOf)).toBe(bare);
    expect(backfillKept(bare, machine("connected", session("ct", false, ws("w1", "infra"))), folderOf)).toBe(bare);
  });
});
```

Append to `src/store/app.test.ts` (reuse its machine fixture helpers; the test name says what to pin):

```ts
  it("keeps a live bookmarked workspace when a snapshot lists it, with its folder", () => {
    const key = projectKey("local", "default", "drover");
    useLayout.setState({ layout: { ...EMPTY_LAYOUT, bookmarks: [key] } });
    useApp.getState().upsertMachine(machine);
    expect(useLayout.getState().layout.kept).toEqual({ [key]: { folder: "/x" } });
  });
```

(Inside `describe("app store", …)`; `machine` is the file's fixture, Workspace `drover` whose panes' `cwd` is `/x`. Add `projectKey` to the existing import from `../sidebar/groups`.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/workspaces/kept.test.ts src/store/app.test.ts`
Expected: FAIL — cannot resolve `./kept`; the app test's `kept` undefined.

- [ ] **Step 3: Implement** `closedKept` and `backfillKept` in `src/workspaces/kept.ts`, `workspaceFolder` in `folder.ts`, and in `upsertMachine` (after the `pruneFolders` loop): `useLayout.getState().update((l) => backfillKept(l, v, (s, w) => workspaceFolder(v.id, s, w)))`.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run src/workspaces src/store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workspaces/kept.ts src/workspaces/kept.test.ts src/workspaces/folder.ts src/store/app.ts src/store/app.test.ts
git commit -m "feat(workspaces): closed kept workspaces of a Session; live Bookmarks are kept"
```

---

### Task 3: Reopen and save a folder

**Files:**
- Create: `src/workspaces/keptActions.ts`, `src/workspaces/keptActions.test.ts`
- Modify: `src/sidebar/actions.tsx` (`changeFolder` signature, the `folder` dialog), `src/files/FilesPanel.tsx:199,221`, `src/agents/AgentList.tsx:358`

**Interfaces:**
- Consumes: `ClosedKept` (Task 2), `setKept`, `projectKey`, `useLayout` (Task 1), `setFolder`, `WorkspaceRef` (`folder.ts`), `herdrCall` (`../lib/ipc`).
- Produces:
  - `reopenKept(machineId: string, session: string, c: ClosedKept): Promise<void>` — the herdr call and selection in Global Constraints; rejects with herdr's error.
  - `saveWorkspaceFolder(ref: WorkspaceRef, label: string, path: string): void` — `setFolder(ref, path)`; when `projectKey(ref.machine_id, ref.session, label)` is kept, also `setKept(…, path.trim() || null)`.
  - `Actions.changeFolder(machineId: string, initial: string, save: (path: string) => void): void` — replaces `(ref, initial)`; the dialog's `folderOn` is `machineId`, its submit calls `save(v)` when `v.trim()`.

- [ ] **Step 1: Write the failing tests** — `src/workspaces/keptActions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({ herdrCall: vi.fn() }));
import { herdrCall } from "../lib/ipc";
import { EMPTY_LAYOUT, projectKey, setKept, useLayout } from "../sidebar/groups";
import { useApp } from "../store/app";
import { getFolder } from "./folder";
import { reopenKept, saveWorkspaceFolder } from "./keptActions";

const key = projectKey("local", "ct", "infra");
beforeEach(() => {
  vi.mocked(herdrCall).mockReset();
  localStorage.clear();
  useLayout.setState({ layout: setKept(EMPTY_LAYOUT, key, "/c/infra") });
  useApp.setState({ selected: null });
});

describe("reopenKept", () => {
  it("makes the workspace again with its label in its folder and selects its terminal", async () => {
    vi.mocked(herdrCall).mockResolvedValue({ workspace: { workspace_id: "w7" }, root_pane: { pane_id: "p7" } });
    await reopenKept("local", "ct", { key, label: "infra", folder: "/c/infra" });
    expect(herdrCall).toHaveBeenCalledWith("local", "ct", "workspace.create", { cwd: "/c/infra", label: "infra", focus: false });
    expect(getFolder({ machine_id: "local", session: "ct", workspace_id: "w7" })).toBe("/c/infra");
    expect(useApp.getState().selected).toEqual({ machine_id: "local", session: "ct", pane_id: "p7" });
  });
  it("lets herdr pick the folder when none is kept", async () => {
    vi.mocked(herdrCall).mockResolvedValue({ workspace: { workspace_id: "w8" }, root_pane: { pane_id: "p8" } });
    await reopenKept("local", "ct", { key, label: "infra", folder: null });
    expect(herdrCall).toHaveBeenCalledWith("local", "ct", "workspace.create", { cwd: null, label: "infra", focus: false });
    expect(getFolder({ machine_id: "local", session: "ct", workspace_id: "w8" })).toBeNull();
  });
  it("rejects with herdr's error and keeps the workspace kept", async () => {
    vi.mocked(herdrCall).mockRejectedValue({ message: "no such directory: /c/infra" });
    await expect(reopenKept("local", "ct", { key, label: "infra", folder: "/c/infra" })).rejects.toEqual({ message: "no such directory: /c/infra" });
    expect(useLayout.getState().layout.kept?.[key]).toEqual({ folder: "/c/infra" });
    expect(useApp.getState().selected).toBeNull();
  });
});

describe("saveWorkspaceFolder", () => {
  const ref = { machine_id: "local", session: "ct", workspace_id: "w1" };
  it("writes a kept workspace's folder to the layout too", () => {
    saveWorkspaceFolder(ref, "infra", "/new");
    expect(getFolder(ref)).toBe("/new");
    expect(useLayout.getState().layout.kept?.[key]).toEqual({ folder: "/new" });
  });
  it("leaves the layout alone for a workspace that is not kept", () => {
    const before = useLayout.getState().layout;
    saveWorkspaceFolder(ref, "web", "/web");
    expect(getFolder(ref)).toBe("/web");
    expect(useLayout.getState().layout).toBe(before);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/workspaces/keptActions.test.ts`
Expected: FAIL — cannot resolve `./keptActions`.

- [ ] **Step 3: Implement** `keptActions.ts`; change `Actions.changeFolder` and the `folder` dialog in `actions.tsx`; update the three callers: `AgentList.tsx:358` and `FilesPanel.tsx:221` pass `(path) => saveWorkspaceFolder(ref, ws.label, path)`, and FilesPanel's **Set as workspace folder** (`:199`) calls `saveWorkspaceFolder(ref, label, root.path)` (`label` is already computed at `:169`).

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run src/workspaces src/files src/agents src/sidebar && pnpm typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/workspaces/keptActions.ts src/workspaces/keptActions.test.ts src/sidebar/actions.tsx src/files/FilesPanel.tsx src/agents/AgentList.tsx
git commit -m "feat(workspaces): reopen a kept workspace; a kept workspace's folder follows Change folder"
```

---

### Task 4: The Closed section and Keep when closed

**Files:**
- Create: `src/agents/ClosedSection.tsx`
- Modify: `src/agents/AgentList.tsx` (`WorkspaceGroup` menu and rename; `SessionPanes` renders the section), `src/styles.css` (after the `.ws-head` rules, ~line 557)
- Test: `src/agents/AgentList.test.tsx`

**Interfaces:**
- Consumes: `closedKept` (Task 2), `reopenKept`, `saveWorkspaceFolder` (Task 3), `setKept`, `forgetKept`, `renameProjectKey`, `projectKey`, `useLayout` (Task 1), `workspaceFolder` (Task 2).
- Produces: `ClosedSection({ machineId, session }: { machineId: string; session: SessionView })`.

Markup (the tests rely on these roles and names):
- `<section className="closed-ws" aria-label="Closed">`
- header: `<button className="closed-toggle" aria-expanded={open}>` containing a `ChevronIcon` (rotated 90° when open), the text `Closed`, and `<span className="project-meta">{n}</span>`.
- open: per key, `<div className="ws-head closed-row" onContextMenu=…>` with `<button className="ws-label closed-label" title={folder ?? undefined} disabled={pending}>{label}</button>`, `<span className="ws-folder">{folder ? folderName(folder) : ""}</span>`, `<button className="ws-add" aria-label={`Reopen ${label}`} disabled={pending}><TerminalIcon /></button>`. A hollow dot before the label as in the mockup (`.closed-dot`).
- A key is `pending` from the click until `reopenKept` settles (component state `Set<ProjectKey>`); the call goes through `a.guard`.
- Row menu: `Reopen`, `Change folder…` (`a.changeFolder(machineId, folder ?? "", (p) => setKept(…, p.trim() || null))`), `Forget` (`forgetKept`).

CSS (tokens only): `.closed-ws { margin-top: var(--s-4); border-top: 1px solid var(--line-2); }`; `.closed-toggle` styled like `.panes-head .section-label` (11px, 600, uppercase, `.04em`, `color: var(--fg-3)`), `display: flex; gap: 6px; align-items: center`; `.closed-label { color: var(--fg-3); font-weight: 500; }`; `.closed-dot { width: 7px; height: 7px; border-radius: 50%; border: 1px solid var(--fg-3); box-sizing: border-box; flex: none; }`; `.closed-row .ws-add { opacity: 1; }`.

- [ ] **Step 1: Write the failing tests** — in `src/agents/AgentList.test.tsx`, import `EMPTY_LAYOUT, projectKey, setBookmarked, setKept, useLayout` from `../sidebar/groups`, add `useLayout.setState({ layout: EMPTY_LAYOUT });` to the `beforeEach`, then add inside `describe("AgentList", …)`:

```tsx
  const keyOf = (label: string) => projectKey("local", "default", label);
  const closed = () => screen.getByRole("region", { name: "Closed" });
  const keep = (...labels: string[]) =>
    useLayout.setState({ layout: labels.reduce((l, x) => setKept(l, keyOf(x), "/c/" + x), EMPTY_LAYOUT) });

  it("lists closed kept workspaces under a folded Closed section, under Active and All, not counted", () => {
    keep("agent", "web", "smarthomes");
    render(<AgentList />);
    const toggle = within(closed()).getByRole("button", { name: /Closed/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("Closed2");
    expect(within(closed()).queryByText("agent")).toBeNull();
    expect(screen.getByRole("button", { name: "Active 3" })).toBeTruthy();
    fireEvent.click(toggle);
    expect(useApp.getState().expanded["closed:local/default"]).toBe(true);
    expect([...closed().querySelectorAll(".closed-label")].map((b) => b.textContent)).toEqual(["agent", "smarthomes"]);
    act(() => usePaneFilter.setState({ filter: "all" }));
    expect(within(closed()).getByText("agent")).toBeTruthy();
  });

  it("shows no Closed section without closed kept workspaces", () => {
    keep("web");
    render(<AgentList />);
    expect(screen.queryByRole("region", { name: "Closed" })).toBeNull();
  });

  it("reopens a closed workspace once, however often it is clicked", async () => {
    keep("agent");
    let done!: (v: unknown) => void;
    vi.mocked(herdrCall).mockImplementation(() => new Promise((r) => (done = r)));
    useApp.setState({ expanded: { "closed:local/default": true } });
    render(<AgentList />);
    const reopen = screen.getByRole("button", { name: "Reopen agent" });
    fireEvent.click(reopen);
    fireEvent.click(reopen);
    fireEvent.click(within(closed()).getByText("agent"));
    expect(vi.mocked(herdrCall).mock.calls.filter((c) => c[2] === "workspace.create")).toEqual([
      ["local", "default", "workspace.create", { cwd: "/c/agent", label: "agent", focus: false }],
    ]);
    await act(async () => done({ workspace: { workspace_id: "w4" }, root_pane: { pane_id: "p40" } }));
    expect(useApp.getState().selected).toEqual({ machine_id: "local", session: "default", pane_id: "p40" });
  });

  it("forgets a closed workspace from its menu, unbookmarking it", () => {
    useLayout.setState({ layout: setBookmarked(EMPTY_LAYOUT, keyOf("agent"), true, "/c/agent") });
    useApp.setState({ expanded: { "closed:local/default": true } });
    render(<AgentList />);
    fireEvent.contextMenu(within(closed()).getByText("agent"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Forget" }));
    expect(useLayout.getState().layout.kept).toEqual({});
    expect(useLayout.getState().layout.bookmarks).toEqual([]);
  });

  it("keeps a workspace from its header menu, and cannot unkeep a bookmarked one", () => {
    render(<AgentList />);
    const head = screen.getByRole("group", { name: "web" }).querySelector(".ws-head")!;
    fireEvent.contextMenu(head);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Keep when closed" }));
    expect(useLayout.getState().layout.kept).toEqual({ [keyOf("web")]: { folder: "/x" } });
    act(() => useLayout.setState({ layout: setBookmarked(useLayout.getState().layout, keyOf("web"), true) }));
    fireEvent.contextMenu(head);
    const item = screen.getByRole("menuitemcheckbox", { name: /Keep when closed/ });
    expect(item.getAttribute("aria-checked")).toBe("true");
    expect((item as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Bookmarked")).toBeTruthy();
  });

  it("carries a kept workspace to its new name on rename", async () => {
    keep("web");
    render(<AgentList />);
    fireEvent.contextMenu(screen.getByRole("group", { name: "web" }).querySelector(".ws-head")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename workspace…" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "web-2" } });
    await act(async () => fireEvent.submit(screen.getByRole("textbox").closest("form")!));
    expect(herdrCall).toHaveBeenCalledWith("local", "default", "workspace.rename", { workspace_id: "w2", label: "web-2" });
    expect(useLayout.getState().layout.kept).toEqual({ [keyOf("web-2")]: { folder: "/c/web" } });
  });
```

(`act` comes from `react`; add `import { act } from "react";`. The `/x` folder in the header test is the fixture panes' `cwd`, which `workspaceFolder` falls back to. If `TextDialog`'s input or form is reached differently in existing rename tests in this file, follow that pattern.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/agents/AgentList.test.tsx`
Expected: FAIL — no region named `Closed`; no `Keep when closed` item.

- [ ] **Step 3: Implement**

- `ClosedSection.tsx` per the markup above; reads `useLayout((s) => s.layout)` and computes `closedKept(layout, machine, session)` (machine from `useApp((s) => s.machines[machineId])`); returns `null` when the list is empty.
- `SessionPanes`: render `<ClosedSection machineId={machineId} session={session} />` as the last child of `.agents-list` whenever `session.running`, after whichever of the empty-state paragraph or the groups shows.
- `WorkspaceGroup` menu: insert before **Close workspace** a `{ label: "Keep when closed", checked: kept, disabled: bookmarked, note: bookmarked ? "Bookmarked" : undefined, onSelect: … }` toggling `setKept(l, key, workspaceFolder(machineId, session, ws))` / `forgetKept`. Pick the icon `ArchiveIcon` if `src/ui/icons.tsx` has one; otherwise add `ArchiveIcon` there (box lid + body + slot: `<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/><path d="M10 12h4"/>`).
- **Rename workspace…**: after `workspace.rename` resolves, `useLayout.getState().update((l) => renameProjectKey(l, projectKey(machineId, session, ws.label), projectKey(machineId, session, label)))`.
- CSS as above.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run src/agents && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/ClosedSection.tsx src/agents/AgentList.tsx src/agents/AgentList.test.tsx src/styles.css src/ui/icons.tsx
git commit -m "feat(agents): Closed section lists kept workspaces; Keep when closed on the header"
```

---

### Task 5: Bookmarks keep and reopen

**Files:**
- Modify: `src/sidebar/ProjectRows.tsx` (bookmark item passes the folder), `src/sidebar/BookmarkRow.tsx` (closed + kept → reopen)
- Test: `src/sidebar/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `setBookmarked(layout, key, on, folder)` (Task 1), `workspaceFolder` (Task 2), `reopenKept` (Task 3), `useViewOrigin` (`./activeFilter`).

- [ ] **Step 1: Write the failing tests** — in `src/sidebar/Sidebar.test.tsx`, extend the `vi.mock("../lib/ipc", …)` factory with `herdrCall: vi.fn()` and import it; import `setKept` from `./groups`; add:

```tsx
  it("bookmarking a project keeps its workspace with its folder", () => {
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "drover" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Bookmark" }));
    expect(useLayout.getState().layout.kept).toEqual({ [projectKey("box", "default", "drover")]: { folder: "/x" } });
  });
  it("reopens a closed bookmarked workspace that is kept", async () => {
    const key = projectKey("box", "default", "old");
    useLayout.setState({ layout: setKept({ tree: [], bookmarks: [key] }, key, "/c/old") });
    vi.mocked(herdrCall).mockResolvedValue({ workspace: { workspace_id: "w5" }, root_pane: { pane_id: "w5:p1" } });
    render(<Sidebar />);
    fireEvent.click(within(screen.getByRole("region", { name: "Bookmarks" })).getByRole("button", { name: "old, default, closed" }));
    await waitFor(() => expect(useApp.getState().selected).toEqual({ machine_id: "box", session: "default", pane_id: "w5:p1" }));
    expect(herdrCall).toHaveBeenCalledWith("box", "default", "workspace.create", { cwd: "/c/old", label: "old", focus: false });
    expect(useViewOrigin.getState().from).toBe("bookmarks");
  });
```

The existing test "keeps a bookmarked project … closed" stays and keeps proving that a closed Bookmark without a kept entry does nothing on click.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/sidebar/Sidebar.test.tsx`
Expected: FAIL — `kept` undefined; `herdrCall` not called.

- [ ] **Step 3: Implement**

- `ProjectRows`: the Bookmark item calls `setBookmarked(l, key, !marked, folder)` where `folder` is `workspaceFolder(machineId, session, ws)` for the row's Workspace (`ws` found in the Session by `r.id`; pass the `SessionView` down if the component lacks it).
- `BookmarkRow.open`: when `!row` and the Session is live and running and `layout.kept?.[b.key]` exists, `setOrigin("bookmarks")` then `a?.guard(() => reopenKept(machineId, sessionName, { key: b.key, label: b.label, folder }))`; otherwise unchanged.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm vitest run src/sidebar && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sidebar/ProjectRows.tsx src/sidebar/BookmarkRow.tsx src/sidebar/Sidebar.test.tsx
git commit -m "feat(sidebar): a Bookmark keeps its workspace; a closed kept Bookmark reopens it"
```

---

### Task 6: Real-browser layout and the UI map

**Files:**
- Create: `src/agents/closedSection.browser.test.tsx`
- Modify: `src/docs/uiMap.surfaces.ts`, `src/docs/uiMap.capture.tsx` (sample data), regenerated `docs/design/ui-map.html` and `docs/design/assets/ui-map-*.png|json`

- [ ] **Step 1: Write the browser test** — `src/agents/closedSection.browser.test.tsx`:

```tsx
import "../styles.css";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ClosedSection } from "./ClosedSection";
import { EMPTY_LAYOUT, projectKey, setKept, useLayout } from "../sidebar/groups";
import { useApp } from "../store/app";
import type { MachineView } from "../lib/types";

it("fits a long closed workspace's label and folder beside its Reopen button at the default column width, light and dark", async () => {
  const session = { name: "ct", running: true, status: "idle" as const, error: null, workspaces: [] };
  const machine: MachineView = { id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "idle", sessions: [session] };
  useApp.setState({ machines: { local: machine }, order: ["local"], expanded: { "closed:local/ct": true } });
  const label = "ct-smarthomes-and-a-very-long-name";
  useLayout.setState({ layout: setKept(EMPTY_LAYOUT, projectKey("local", "ct", label), "/Users/me/Dev/" + label) });
  document.body.innerHTML = "";
  const col = document.createElement("aside");
  col.className = "agents";
  col.style.width = "288px";
  const list = document.createElement("div");
  list.className = "agents-list";
  col.appendChild(list);
  document.body.appendChild(col);
  await act(async () => createRoot(list).render(<ClosedSection machineId="local" session={session} />));
  for (const theme of ["light", "dark"]) {
    document.documentElement.dataset.theme = theme;
    const row = col.querySelector(".closed-row")!.getBoundingClientRect();
    const name = col.querySelector(".closed-label")!.getBoundingClientRect();
    const folder = col.querySelector(".closed-row .ws-folder")!.getBoundingClientRect();
    const btn = col.querySelector(".closed-row .ws-add")!.getBoundingClientRect();
    expect(name.right).toBeLessThanOrEqual(folder.left + 0.5);
    expect(folder.right).toBeLessThanOrEqual(btn.left + 0.5);
    expect(btn.right).toBeLessThanOrEqual(row.right + 0.5);
    expect(list.scrollWidth).toBe(list.clientWidth);
  }
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run --config vitest.browser.config.ts src/agents/closedSection.browser.test.tsx`
Expected: PASS (fix the CSS from Task 4 if it fails; the test is the contract).

- [ ] **Step 3: Add the surface and sample data**

- `uiMap.surfaces.ts`: after **Pane row**, `{ group: "Agents column", name: "Closed section", selector: ".closed-ws", at: [0, 0.5], d: [96, 0], what: "CLOSED and its count: the Session's kept workspaces herdr removed; a click opens one again.", code: "src/agents/ClosedSection.tsx" }`.
- `uiMap.capture.tsx`: in the setup `act`, keep a closed workspace for Session `ct`: `useLayout.setState((s) => ({ layout: setKept({ ...s.layout, bookmarks: [...] }, projectKey("local", "ct", "ct-cli-old"), "/Users/me/ct-cli-old") }))` (keep the existing bookmarks expression; import `setKept`).

- [ ] **Step 4: Regenerate and check**

Run: `mise run docs:ui-map > /tmp/ui-map-$(date +%s).log 2>&1; echo exit=$?`
Expected: `exit=0`; open `docs/design/assets/ui-map-light.png` and `-dark.png` and see the Closed section numbered.

- [ ] **Step 5: Commit**

```bash
git add src/agents/closedSection.browser.test.tsx src/docs/uiMap.surfaces.ts src/docs/uiMap.capture.tsx docs/design
git commit -m "docs(ui-map): the Closed section; browser test for its row layout"
```

---

### Task 7: Gate and real-app check

- [ ] **Step 1: Full gate**

Run: `mise run ci > /tmp/kept-ci-$(date +%s).log 2>&1; echo exit=$?`
Expected: `exit=0` and the log ends `ci passed`.

- [ ] **Step 2: Browser tests**

Run: `mise run test:browser > /tmp/kept-browser-$(date +%s).log 2>&1; echo exit=$?`
Expected: `exit=0`.

- [ ] **Step 3: Real app** — `mise run app:install`, then in Drover:
  1. Agents column, a Workspace header → right-click → **Keep when closed**. Expect: nothing changes on screen; `~/Library/Application Support/dev.cuongtransc.drover/` layout JSON has the key under `kept` with the folder.
  2. Close that Workspace's last Pane. Expect: the Workspace leaves the list; **Closed 1** appears at the end, folded.
  3. Open Closed, click the row. Expect: the Workspace reappears last in the list with one Terminal, selected; `pwd` in it prints the kept folder; Closed disappears.
  4. Bookmark another Workspace, close it, click its Bookmark (`closed`). Expect: it reopens and is selected.
  5. Light and dark: Closed text readable.

- [ ] **Step 4: Record the outcome** in the PR description (each step, what was seen).
