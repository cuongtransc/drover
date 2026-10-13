import { fireEvent, render, screen, within } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
// No ctc by default: lanes fold by workspace, as before the lane store reported owners.
vi.mock("../lib/ipc", () => ({ herdrCall: vi.fn().mockResolvedValue(undefined), chatLocate: vi.fn(), lanesList: vi.fn().mockRejectedValue(new Error("no ctc")) }));
vi.mock("./transcriptPath", () => ({ copyTranscriptPath: vi.fn() }));
import { herdrCall, lanesList } from "../lib/ipc";
import { copyTranscriptPath } from "./transcriptPath";
import { useLaneOwners } from "./laneOwners";
import { useFilesPanel } from "../files/panelStore";
import { panelWorkspace } from "../files/root";
import { useApp } from "../store/app";
import { itemKey, NO_ITEMS } from "../store/openItems";
import { EMPTY_LAYOUT, projectKey, setBookmarked, setKept, useLayout } from "../sidebar/groups";
import { setFolder } from "../workspaces/folder";
import { isReopenPending, resetReopenPending } from "../workspaces/keptActions";
import { AgentList, workspaceGroups } from "./AgentList";
import { ClosedSection } from "./ClosedSection";
import { Sidebar } from "../sidebar/Sidebar";
import { ActionsProvider, useActions, type Actions } from "../sidebar/actions";
import type { MenuItem } from "../sidebar/ContextMenu";
import { useProtect } from "./protect";
import { useActiveWindow, usePaneFilter } from "./paneFilter";
import type { MachineView, PaneView } from "../lib/types";

const pane = (id: string, title: string, agent: string | null, status: PaneView["status"]): PaneView => ({
  pane_id: id, terminal_id: "t" + id, title, cwd: "/x", agent, status,
});

const m: MachineView = {
  id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "working",
  sessions: [
    { name: "default", running: true, status: "working", error: null, workspaces: [
      { workspace_id: "w1", label: "checkout-api", number: 1, status: "done", tabs: [
        { tab_id: "w1:t1", label: "1", number: 1, status: "done", panes: [pane("p1", "Idempotent payments", "claude", "done")] } ] },
      { workspace_id: "w2", label: "web", number: 2, status: "blocked", tabs: [
        { tab_id: "w2:t1", label: "ui", number: 1, status: "blocked", panes: [pane("p2", "Guard export", "codex", "blocked")] },
        { tab_id: "w2:t2", label: "release", number: 2, status: "idle", panes: [pane("p3", "Tag v1.4.0", null, "unknown"), pane("p4", "Ship flag", "pi", "idle")] } ] },
      { workspace_id: "w3", label: "empty", number: 3, status: "unknown", tabs: [] } ] },
    { name: "other", running: true, status: "idle", error: null, workspaces: [
      { workspace_id: "w9", label: "infra", number: 1, status: "idle", tabs: [
        { tab_id: "w9:t1", label: "1", number: 1, status: "idle", panes: [pane("p9", "Backup", "mystery", "working")] } ] } ] },
  ],
};

describe("workspaceGroups", () => {
  it("groups panes by workspace, naming the tab only when a workspace has several", () => {
    const groups = workspaceGroups(m.sessions[0]);
    expect(groups.map((g) => [g.workspace.workspace_id, g.entries.map((e) => [e.pane.pane_id, e.sub])])).toEqual([
      ["w1", [["p1", ""]]],
      ["w2", [["p2", "ui"], ["p3", "release"], ["p4", "release"]]],
      ["w3", []],
    ]);
  });
});

describe("AgentList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReopenPending();
    vi.mocked(herdrCall).mockResolvedValue(undefined);
    localStorage.clear();
    useProtect.setState({ marks: {} });
    useApp.setState({ machines: { local: m }, order: ["local"], selected: null, viewed: { machine_id: "local", session: "default" }, expanded: {}, doneSeen: {}, statusSince: {} });
    usePaneFilter.setState({ filter: "active" });
    useLayout.setState({ layout: EMPTY_LAYOUT });
  });

  const ago = (ms: number) => Date.now() - ms;
  const MIN = 60_000;
  const rowsOf = (group: string) =>
    [...screen.getByRole("group", { name: group }).querySelectorAll(".agent-card")].map((b) => b.getAttribute("aria-label"));

  it("shows, in Active, the panes that need a look as one-line rows named by their status", () => {
    render(<AgentList />);
    expect(screen.getByRole("button", { name: "Idempotent payments, claude, review" })).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "Idempotent payments, claude, review" })).getByText("Review")).toBeTruthy();
    const input = screen.getByRole("button", { name: "Guard export, codex, blocked" });
    expect(within(input).getByText("Blocked")).toBeTruthy();
    // A shell running something (its title is not a shell's name) stays, unmarked.
    expect(screen.getByRole("button", { name: "Tag v1.4.0, shell" })).toBeTruthy();
    // Idle with no recent change: hidden, and no per-workspace fold line names it.
    expect(screen.queryByText("Ship flag")).toBeNull();
    expect(document.querySelector(".ws-quiet")).toBeNull();
    expect(screen.queryByText(/^(DONE|IDLE|WORKING)$/)).toBeNull();
  });

  it("heads the panes with one Active N toggle, on by default, like the Sessions section", () => {
    render(<AgentList />);
    const active = screen.getByRole("button", { name: "Active 3" });
    expect(active.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(active);
    expect(active.getAttribute("aria-pressed")).toBe("false");
    expect(rowsOf("web")).toEqual(["Guard export, codex, blocked", "Tag v1.4.0, shell", "Ship flag, pi, idle"]);
    expect(screen.getByRole("button", { name: "Ship flag, pi, idle" }).className).toContain("quiet");
    expect(screen.getByRole("button", { name: "Guard export, codex, blocked" }).className).not.toContain("quiet");
    expect(JSON.parse(localStorage.getItem("drover:settings")!).paneFilter).toBe("all");
  });

  it("keeps an agent idle under the Active window (1h by default), with its idle time", () => {
    useApp.setState({ statusSince: { "local/default/p4": ago(12 * MIN) } });
    render(<AgentList />);
    const row = screen.getByRole("button", { name: "Ship flag, pi, idle" });
    expect(within(row).getByText("12m").getAttribute("title")).toBe("Idle for 12m");
  });

  it("hides an agent idle for longer than the Active window", () => {
    useApp.setState({ statusSince: { "local/default/p4": ago(61 * MIN) } });
    render(<AgentList />);
    expect(screen.queryByText("Ship flag")).toBeNull();
  });

  it("follows the Active window set in Settings", () => {
    useApp.setState({ statusSince: { "local/default/p4": ago(20 * MIN) } });
    useActiveWindow.setState({ minutes: 15 });
    render(<AgentList />);
    expect(screen.queryByText("Ship flag")).toBeNull();
    useActiveWindow.setState({ minutes: 60 });
  });

  it("names a pane's tab only in its tooltip", () => {
    render(<AgentList />);
    const guard = screen.getByRole("button", { name: "Guard export, codex, blocked" });
    expect(guard.querySelector(".agent-card-sub")).toBeNull();
    expect(guard.getAttribute("title")).toBe("ui · /x");
  });

  it("never hides the selected pane", () => {
    useApp.setState({ selected: { machine_id: "local", session: "default", pane_id: "p4" } });
    render(<AgentList />);
    expect(screen.getByRole("button", { name: "Ship flag, pi, idle" }).getAttribute("aria-current")).toBe("true");
  });

  it("hides a workspace whose panes are all hidden, but not an empty one", () => {
    useApp.setState({ viewed: { machine_id: "local", session: "other" } });
    const quiet = structuredClone(m);
    quiet.sessions[1].workspaces[0].tabs[0].panes[0].status = "idle";
    useApp.setState({ machines: { local: quiet } });
    render(<AgentList />);
    expect(screen.queryByRole("group", { name: "infra" })).toBeNull();
    expect(screen.getByRole("button", { name: "Active 0" })).toBeTruthy();
  });

  it("hides a plain shell", () => {
    const shell = structuredClone(m);
    shell.sessions[0].workspaces[1].tabs[1].panes[0].title = "zsh";
    useApp.setState({ machines: { local: shell } });
    render(<AgentList />);
    expect(screen.queryByText("zsh")).toBeNull();
  });

  it("keeps an agent herdr cannot read in view, marked unknown", () => {
    // Started through a wrapper: herdr names the agent from its session but reports no state.
    const mm = structuredClone(m);
    Object.assign(mm.sessions[0].workspaces[1].tabs[1].panes[0], { agent: "claude", status: "unknown", busy: null });
    useApp.setState({ machines: { local: mm } });
    render(<AgentList />);
    const row = screen.getByRole("button", { name: "Tag v1.4.0, claude, state unknown" });
    expect(row.querySelector(".mark-unknown")?.getAttribute("title")).toMatch(/can't read/);
  });

  it("hides an untitled shell (herdr's \"Terminal\") like a named one", () => {
    const shell = structuredClone(m);
    shell.sessions[0].workspaces[1].tabs[1].panes[0].title = "Terminal";
    useApp.setState({ machines: { local: shell } });
    render(<AgentList />);
    expect(screen.queryByText("Terminal")).toBeNull();
  });

  it("reads a shell's state from its process, not its title, once herdr reported it", () => {
    const shell = structuredClone(m);
    const pane = shell.sessions[0].workspaces[1].tabs[1].panes[0];
    // Idle at its prompt though a program left its title behind.
    Object.assign(pane, { title: "Tag v1.4.0", busy: false });
    useApp.setState({ machines: { local: shell } });
    const { unmount } = render(<AgentList />);
    expect(screen.queryByText("Tag v1.4.0")).toBeNull();
    unmount();
    // Running a command though untitled.
    Object.assign(pane, { title: "Terminal", busy: true });
    useApp.setState({ machines: { local: structuredClone(shell) } });
    render(<AgentList />);
    expect(screen.getByRole("button", { name: "Terminal, shell" })).toBeTruthy();
  });

  it("shows what a shell does after its name, muted, and names it in the row's label", () => {
    const shell = structuredClone(m);
    Object.assign(shell.sessions[0].workspaces[1].tabs[1].panes[0], { title: "dev", activity: "pnpm vite --port 1441", busy: true });
    useApp.setState({ machines: { local: shell } });
    render(<AgentList />);
    const row = screen.getByRole("button", { name: "dev · pnpm vite --port 1441, shell" });
    expect(within(row).getByText("dev").className).toContain("has-activity");
    const activity = within(row).getByText("pnpm vite --port 1441");
    expect(activity.className).toBe("agent-card-activity");
    expect(activity.previousElementSibling?.textContent).toBe("dev");
  });

  it("shows no activity for a shell without one, or for an agent", () => {
    const shell = structuredClone(m);
    Object.assign(shell.sessions[0].workspaces[1].tabs[1].panes[0], { title: "dev", activity: null, busy: true });
    useApp.setState({ machines: { local: shell } });
    const { container } = render(<AgentList />);
    expect(screen.getByRole("button", { name: "dev, shell" })).toBeTruthy();
    expect(container.querySelector(".agent-card-activity")).toBeNull();
  });

  it("folds a workspace from its header, keeping what needs the user counted on it", () => {
    render(<AgentList />);
    const head = screen.getByRole("button", { name: "web" });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(head);
    expect(screen.getByRole("button", { name: "web, 1 needs you" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Guard export")).toBeNull();
  });

  it("heads the column with what waits and what is done, and steps through them in this session", () => {
    render(<AgentList />);
    expect(document.querySelector(".agents-head .count")).toBeNull();
    const chip = screen.getByRole("button", { name: "1 blocked, 1 review: go to the next one in this session" });
    expect(chip.textContent).toBe("1 blocked · 1 review");
    // Waiting for input first, then Done and unseen.
    fireEvent.click(chip);
    expect(useApp.getState().selected).toEqual({ machine_id: "local", session: "default", pane_id: "p2" });
    fireEvent.click(screen.getByRole("button", { name: /in this session/ }));
    expect(useApp.getState().selected).toEqual({ machine_id: "local", session: "default", pane_id: "p1" });
  });

  it("starts a stopped session from the column", () => {
    useApp.setState({ machines: { local: { ...m, sessions: [{ ...m.sessions[0], running: false, workspaces: [] }] } } });
    render(<AgentList />);
    expect(screen.getByText("Stopped")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start default" })).toBeTruthy();
  });

  it("falls back to a monogram for an unknown agent", () => {
    useApp.setState({ viewed: { machine_id: "local", session: "other" } });
    render(<AgentList />);
    expect(screen.getByRole("img", { name: "mystery" }).textContent).toBe("M");
    expect(screen.getByRole("button", { name: "Backup, mystery, in progress" })).toBeTruthy();
  });

  it("selects a pane on click and marks it active", () => {
    render(<AgentList />);
    fireEvent.click(screen.getByText("Guard export"));
    expect(useApp.getState().selected).toEqual({ machine_id: "local", session: "default", pane_id: "p2" });
    expect(screen.getByText("Guard export").closest("button")?.className).toContain("active");
  });

  it("shows a header per workspace with its folder, empty workspaces included", () => {
    setFolder({ machine_id: "local", session: "default", workspace_id: "w1" }, "/Users/me/checkout-api/");
    render(<AgentList />);
    const w1 = screen.getByRole("group", { name: "checkout-api" });
    expect(within(w1).getByText("checkout-api", { selector: ".ws-folder" })).toBeTruthy();
    expect(within(w1).getByText("Idempotent payments")).toBeTruthy();
    expect(within(screen.getByRole("group", { name: "web" })).getAllByRole("listitem")).toHaveLength(2);
    // An absent folder is not labelled.
    expect(screen.queryByText("no folder")).toBeNull();
    expect(screen.getByRole("group", { name: "empty" }).querySelector(".ws-folder")).toBeNull();
    expect(screen.getByRole("button", { name: "New agent in empty" })).toBeTruthy();
  });

  it("keeps the panes of a multi-pane tab together, leaving single-pane tabs bare", () => {
    // Both panes of the "release" tab shown: one working agent, one shell running something.
    const busy = structuredClone(m);
    busy.sessions[0].workspaces[1].tabs[1].panes[1].status = "working";
    useApp.setState({ machines: { local: busy } });
    render(<AgentList />);
    const tab = screen.getByRole("group", { name: "Tab release" });
    expect(tab.className).toContain("tab-group");
    expect(within(tab).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Tag v1.4.0"),
      expect.stringContaining("Ship flag"),
    ]);
    expect(screen.queryByRole("group", { name: "Tab ui" })).toBeNull();
    expect(screen.getByText("Guard export").closest(".tab-group")).toBeNull();
  });

  it("opens the new agent dialog from the header button", () => {
    render(<AgentList />);
    fireEvent.click(screen.getByRole("button", { name: "New agent in web" }));
    expect(screen.getByRole("dialog", { name: "New agent" })).toBeTruthy();
    expect(screen.getByText("New agent in web", { selector: "h3" })).toBeTruthy();
  });

  it("opens the new workspace dialog from the session header", () => {
    render(<AgentList />);
    fireEvent.click(screen.getByRole("button", { name: "New workspace" }));
    expect(screen.getByRole("dialog", { name: "New workspace" })).toBeTruthy();
    expect(screen.getByText("New workspace in default", { selector: "h3" })).toBeTruthy();
  });

  it("offers no new workspace button on a stopped session", () => {
    useApp.setState({ machines: { local: { ...m, sessions: [{ ...m.sessions[0], running: false }] } } });
    render(<AgentList />);
    expect(screen.queryByRole("button", { name: "New workspace" })).toBeNull();
  });

  it("changes the folder from the header menu", () => {
    render(<AgentList />);
    fireEvent.contextMenu(screen.getByText("web", { selector: ".ws-label" }));
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["New claude", "New pi", "New shell", "Browse files", "Change folder…", "Rename workspace…", "Close workspace"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Change folder…" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "/srv/web" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(within(screen.getByRole("group", { name: "web" })).getByText("web", { selector: ".ws-folder" })).toBeTruthy();
  });

  it("Browse files selects a pane of the workspace and focuses the file tree", () => {
    useFilesPanel.setState(useFilesPanel.getInitialState(), true);
    render(<AgentList />);
    fireEvent.contextMenu(screen.getByText("web", { selector: ".ws-label" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Browse files" }));
    expect(useApp.getState().selected).toEqual({ machine_id: "local", session: "default", pane_id: "p2" });
    expect(useFilesPanel.getState().focusTick).toBe(1);
  });

  it("Browse files keeps the selected pane when it is already in that workspace", () => {
    useFilesPanel.setState(useFilesPanel.getInitialState(), true);
    useApp.setState({ selected: { machine_id: "local", session: "default", pane_id: "p4" } });
    render(<AgentList />);
    fireEvent.contextMenu(screen.getByText("web", { selector: ".ws-label" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Browse files" }));
    expect(useApp.getState().selected?.pane_id).toBe("p4");
    expect(useFilesPanel.getState().focusTick).toBe(1);
  });

  it("Browse files leaves a file item of another workspace for the selected pane", () => {
    useFilesPanel.setState(useFilesPanel.getInitialState(), true);
    const file = { kind: "file" as const, ws: { machine_id: "local", session: "default", workspace_id: "w1" }, root: "/x", rel: "a.md" };
    useApp.setState({
      selected: { machine_id: "local", session: "default", pane_id: "p4" },
      openItems: { items: [file], preview: null, active: itemKey(file) },
    });
    render(<AgentList />);
    fireEvent.contextMenu(screen.getByText("web", { selector: ".ws-label" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Browse files" }));
    expect(useApp.getState().selected?.pane_id).toBe("p4");
    expect(panelWorkspace(useApp.getState())).toEqual({ machine_id: "local", session: "default", workspace_id: "w2" });
    expect(useFilesPanel.getState().focusTick).toBe(1);
  });

  it("pins the pane's tab on double click", () => {
    useApp.setState({ openItems: NO_ITEMS });
    render(<AgentList />);
    fireEvent.click(screen.getByText("Guard export"));
    fireEvent.doubleClick(screen.getByText("Guard export"));
    expect(useApp.getState().openItems.items).toEqual([{ kind: "agent", ref: { machine_id: "local", session: "default", pane_id: "p2" } }]);
    expect(useApp.getState().openItems.preview).toBeNull();
  });

  it("starts an agent from the header menu in the workspace folder", () => {
    setFolder({ machine_id: "local", session: "default", workspace_id: "w2" }, "/srv/web");
    render(<AgentList />);
    fireEvent.contextMenu(screen.getByText("web", { selector: ".ws-label" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New pi" }));
    expect(herdrCall).toHaveBeenCalledWith("local", "default", "tab.create", { workspace_id: "w2", cwd: "/srv/web", label: "pi", focus: false });
  });

  // The menu's entries in order, a line between groups as "—".
  const menuEntries = () =>
    [...screen.getByRole("menu").children].map((li) => (li.getAttribute("role") === "separator" ? "—" : li.querySelector("button")!.textContent));

  it("offers pane and tab actions in the card menu, grouped", () => {
    render(<AgentList />);
    fireEvent.contextMenu(screen.getByText("Tag v1.4.0"));
    // A shell pane has no agent group: no fork, no transcript.
    expect(menuEntries()).toEqual(["Rename pane…", "Split right", "Split down", "Protect", "Close pane", "—", "Rename tab…", "Close tab"]);
    expect(screen.getByRole("menuitemcheckbox", { name: "Protect" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("menuitem", { name: "Split right" }));
    expect(herdrCall).toHaveBeenCalledWith("local", "default", "pane.split", { target_pane_id: "p3", direction: "right" });
  });

  it("groups a Claude pane's agent actions, and closes its one-pane tab without asking", () => {
    render(<AgentList />);
    fireEvent.contextMenu(screen.getByText("Idempotent payments"));
    expect(menuEntries()).toEqual([
      "Rename pane…", "Split right", "Split down", "Protect", "—",
      "Fork session", "Fork into a new worktree", "Copy transcript path", "—",
      "Rename tab…", "Close tab",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Close tab" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(herdrCall).toHaveBeenCalledWith("local", "default", "pane.close", { pane_id: "p1" });
  });

  it("copies a pi pane's transcript path, without offering a fork", () => {
    usePaneFilter.setState({ filter: "all" });
    render(<AgentList />);
    fireEvent.contextMenu(screen.getByText("Ship flag"));
    expect(screen.queryByRole("menuitem", { name: "Fork session" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy transcript path" }));
    expect(copyTranscriptPath).toHaveBeenCalledWith({ machine_id: "local", session: "default", pane_id: "p4" });
  });

  it("closes a pane from its card button without asking, naming a one-pane tab's as Close tab", () => {
    render(<AgentList />);
    expect(screen.getByRole("button", { name: "Close tab Idempotent payments" }).title).toBe("Close tab");
    expect(screen.getByRole("button", { name: "Close pane Tag v1.4.0" }).title).toBe("Close pane");
    // A done agent has nothing running: closed at once.
    fireEvent.click(screen.getByRole("button", { name: "Close tab Idempotent payments" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(herdrCall).toHaveBeenCalledWith("local", "default", "pane.close", { pane_id: "p1" });
  });

  describe("closing a tab or workspace with work running", () => {
    const busyIn = (dialog: HTMLElement) =>
      [...dialog.querySelectorAll(".busy-list li")].map((li) => li.textContent);

    it("names the panes with work running when closing their workspace, Cancel first", () => {
      render(<AgentList />);
      fireEvent.contextMenu(screen.getByText("web", { selector: ".ws-label" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Close workspace" }));
      const dialog = screen.getByRole("dialog", { name: "Close workspace" });
      expect(within(dialog).getByText("It has work running, which ends too:")).toBeTruthy();
      expect(busyIn(dialog)).toEqual(["Guard export · Codex waiting for you", "Tag v1.4.0 · running a command"]);
      expect(document.activeElement?.textContent).toBe("Cancel");
      expect(within(dialog).getByRole("button", { name: "Close" }).className).toBe("btn btn-danger-text");
    });

    it("names only the busy panes of a tab", () => {
      usePaneFilter.setState({ filter: "all" });
      render(<AgentList />);
      fireEvent.contextMenu(screen.getByText("Tag v1.4.0"));
      fireEvent.click(screen.getByRole("menuitem", { name: "Close tab" }));
      // Ship flag, the tab's idle pi, is not named.
      expect(busyIn(screen.getByRole("dialog", { name: "Close tab" }))).toEqual(["Tag v1.4.0 · running a command"]);
    });

    it("closes a workspace at once when nothing runs and nothing is protected", () => {
      render(<AgentList />);
      fireEvent.contextMenu(screen.getByText("checkout-api", { selector: ".ws-label" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Close workspace" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(herdrCall).toHaveBeenCalledWith("local", "default", "workspace.close", { workspace_id: "w1" });
    });

    it("closes a tab of several panes at once when they are all idle", () => {
      // Tag v1.4.0's shell is back at its prompt (herdr says not busy); Ship flag's pi is idle.
      const idle: MachineView = { ...m, sessions: [{ ...m.sessions[0], workspaces: m.sessions[0].workspaces.map((w) =>
        w.workspace_id !== "w2" ? w : { ...w, tabs: w.tabs.map((t) => ({ ...t, panes: t.panes.map((p) => (p.pane_id === "p3" ? { ...p, busy: false } : p)) })) }) }, m.sessions[1]] };
      useApp.setState({ machines: { local: idle } });
      usePaneFilter.setState({ filter: "all" });
      render(<AgentList />);
      fireEvent.contextMenu(screen.getByText("Ship flag"));
      fireEvent.click(screen.getByRole("menuitem", { name: "Close tab" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(herdrCall).toHaveBeenCalledWith("local", "default", "tab.close", { tab_id: "w2:t2" });
    });

    it("names a protected pane once, among the protected", () => {
      useProtect.getState().set("local/default/p2", true);
      render(<AgentList />);
      fireEvent.contextMenu(screen.getByText("web", { selector: ".ws-label" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Close workspace" }));
      expect(busyIn(screen.getByRole("dialog", { name: "Close workspace" }))).toEqual(["Tag v1.4.0 · running a command"]);
    });
  });

  describe("closing a pane with work running", () => {
    const withStatus = (status: PaneView["status"]): MachineView => ({ ...m, sessions: [{ ...m.sessions[0], workspaces: m.sessions[0].workspaces.map((w) =>
      w.workspace_id !== "w1" ? w : { ...w, tabs: w.tabs.map((t) => ({ ...t, panes: t.panes.map((p) => ({ ...p, status })) })) }) }, m.sessions[1]] });

    it("asks before closing a working agent, Cancel first, and closes nothing on Cancel", () => {
      useApp.setState({ machines: { local: withStatus("working") } });
      render(<AgentList />);
      fireEvent.click(screen.getByRole("button", { name: "Close tab Idempotent payments" }));
      const dialog = screen.getByRole("dialog", { name: "Close tab" });
      expect(within(dialog).getByText('Close tab "Idempotent payments"? Claude is working: closing ends its turn.')).toBeTruthy();
      expect(document.activeElement?.textContent).toBe("Cancel");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(herdrCall).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Close tab Idempotent payments" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
      expect(herdrCall).toHaveBeenCalledWith("local", "default", "pane.close", { pane_id: "p1" });
    });

    it("asks before closing an agent waiting for the user, from the menu too", () => {
      render(<AgentList />);
      fireEvent.contextMenu(screen.getByText("Guard export"));
      fireEvent.click(screen.getByRole("menuitem", { name: "Close tab" }));
      expect(within(screen.getByRole("dialog", { name: "Close tab" })).getByText('Close tab "Guard export"? Codex is waiting for you: closing ends it.')).toBeTruthy();
      expect(herdrCall).not.toHaveBeenCalled();
    });

    it("asks before closing a shell that is running something", () => {
      render(<AgentList />);
      fireEvent.click(screen.getByRole("button", { name: "Close pane Tag v1.4.0" }));
      expect(within(screen.getByRole("dialog", { name: "Close pane" })).getByText('Close pane "Tag v1.4.0"? It is running a command: closing stops it.')).toBeTruthy();
      expect(herdrCall).not.toHaveBeenCalled();
    });
  });

  describe("fork", () => {
    it("offers Fork session and Fork into a new worktree on a done Claude pane", () => {
      render(<AgentList />);
      fireEvent.contextMenu(screen.getByText("Idempotent payments"));
      expect((screen.getByRole("menuitem", { name: "Fork session" }) as HTMLButtonElement).disabled).toBe(false);
      expect((screen.getByRole("menuitem", { name: "Fork into a new worktree" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("turns both off on a busy Claude pane, saying why", () => {
      const busy: MachineView = { ...m, sessions: [{ ...m.sessions[0], workspaces: m.sessions[0].workspaces.map((w) =>
        w.workspace_id !== "w1" ? w : { ...w, tabs: w.tabs.map((t) => ({ ...t, panes: t.panes.map((p) => ({ ...p, status: "working" as const })) })) }) }, m.sessions[1]] };
      useApp.setState({ machines: { local: busy } });
      render(<AgentList />);
      fireEvent.contextMenu(screen.getByText("Idempotent payments"));
      const menu = screen.getByRole("menu");
      expect((within(menu).getByRole("menuitem", { name: "Fork session" }) as HTMLButtonElement).disabled).toBe(true);
      expect((within(menu).getByRole("menuitem", { name: "Fork into a new worktree" }) as HTMLButtonElement).disabled).toBe(true);
      expect(within(menu).getByText("Busy: a fork now would run its unfinished command again. Fork once it finishes.")).toBeTruthy();
    });

    it("shows why a fork was refused", async () => {
      vi.mocked(herdrCall).mockImplementation(async (_m, _s, method) => (method === "agent.get" ? { agent: { agent_session: null } } : undefined));
      render(<AgentList />);
      fireEvent.contextMenu(screen.getByText("Idempotent payments"));
      fireEvent.click(screen.getByRole("menuitem", { name: "Fork session" }));
      expect(await screen.findByText("herdr has not reported this pane's session yet")).toBeTruthy();
      expect(herdrCall).not.toHaveBeenCalledWith("local", "default", "tab.create", expect.anything());
    });
  });

  describe("protect", () => {
    // w2's "release" tab renamed orch-release: its agent (Ship flag) is the orchestrator.
    const withOrch: MachineView = { ...m, sessions: [{ ...m.sessions[0], workspaces: m.sessions[0].workspaces.map((w) =>
      w.workspace_id !== "w2" ? w : { ...w, tabs: w.tabs.map((t) => (t.tab_id === "w2:t2" ? { ...t, label: "orch-release" } : t)) }) }, m.sessions[1]] };
    const menuOf = (title: string) => {
      fireEvent.contextMenu(screen.getByText(title));
      return screen.getByRole("menu");
    };

    it("protects an orchestrator by default: a lock instead of the close button, Close pane turned off with the reason", () => {
      useApp.setState({ machines: { local: withOrch } });
      usePaneFilter.setState({ filter: "all" });
      render(<AgentList />);
      expect(screen.getByLabelText("Protected: Ship flag")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Close pane Ship flag" })).toBeNull();
      const menu = menuOf("Ship flag");
      const close = within(menu).getByRole("menuitem", { name: "Close pane" }) as HTMLButtonElement;
      expect(close.disabled).toBe(true);
      expect(within(menu).getByText("Protected: unprotect it to close")).toBeTruthy();
      expect(within(menu).getByRole("menuitemcheckbox", { name: "Protected" }).getAttribute("aria-checked")).toBe("true");
    });

    it("unprotects from the menu, and the close button comes back", () => {
      useApp.setState({ machines: { local: withOrch } });
      usePaneFilter.setState({ filter: "all" });
      render(<AgentList />);
      fireEvent.click(within(menuOf("Ship flag")).getByRole("menuitemcheckbox", { name: "Protected" }));
      expect(screen.queryByLabelText("Protected: Ship flag")).toBeNull();
      expect(screen.getByRole("button", { name: "Close pane Ship flag" })).toBeTruthy();
      expect(useProtect.getState().marks["local/default/p4"]).toBe(false);
    });

    it("protects any pane from its menu, and remembers it", () => {
      render(<AgentList />);
      fireEvent.click(within(menuOf("Tag v1.4.0")).getByRole("menuitemcheckbox", { name: "Protect" }));
      expect(screen.getByLabelText("Protected: Tag v1.4.0")).toBeTruthy();
      expect(JSON.parse(localStorage.getItem("drover:protected")!)).toEqual({ "local/default/p3": true });
    });

    it("refuses to close a tab holding a protected pane until the user unprotects it in the dialog", () => {
      useProtect.getState().set("local/default/p3", true);
      render(<AgentList />);
      fireEvent.click(within(menuOf("Tag v1.4.0")).getByRole("menuitem", { name: "Close tab" }));
      const dialog = screen.getByRole("dialog", { name: "Close tab" });
      expect(within(dialog).getByText("Tag v1.4.0")).toBeTruthy();
      expect(document.activeElement?.textContent).toBe("Cancel");
      // Cancel is the default action: filled; closing stays a plain button in red text.
      expect(within(dialog).getByRole("button", { name: "Cancel" }).className).toBe("btn btn-primary");
      expect(within(dialog).getByRole("button", { name: "Unprotect and close" }).className).toBe("btn btn-danger-text");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(herdrCall).not.toHaveBeenCalled();
      fireEvent.click(within(menuOf("Tag v1.4.0")).getByRole("menuitem", { name: "Close tab" }));
      fireEvent.click(screen.getByRole("button", { name: "Unprotect and close" }));
      expect(herdrCall).toHaveBeenCalledWith("local", "default", "tab.close", { tab_id: "w2:t2" });
      expect(useProtect.getState().marks["local/default/p3"]).toBe(false);
    });

    it("names the protected panes when closing their workspace", () => {
      useProtect.getState().set("local/default/p2", true);
      render(<AgentList />);
      fireEvent.contextMenu(screen.getByText("web", { selector: ".ws-label" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Close workspace" }));
      const dialog = screen.getByRole("dialog", { name: "Close workspace" });
      expect(within(dialog).getByText("Guard export")).toBeTruthy();
      expect(within(dialog).getByRole("button", { name: "Unprotect and close" })).toBeTruthy();
    });

    it("turns off a protected one-pane tab's Close tab with the reason, as Close pane is", () => {
      useProtect.getState().set("local/default/p2", true);
      render(<AgentList />);
      const menu = menuOf("Guard export");
      expect((within(menu).getByRole("menuitem", { name: "Close tab" }) as HTMLButtonElement).disabled).toBe(true);
      expect(within(menu).getByText("Protected: unprotect it to close")).toBeTruthy();
      expect(within(menu).queryByRole("menuitem", { name: "Close pane" })).toBeNull();
    });

    it("keeps the plain confirmation when nothing in the tab is protected", () => {
      render(<AgentList />);
      fireEvent.click(within(menuOf("Tag v1.4.0")).getByRole("menuitem", { name: "Close tab" }));
      const dialog = screen.getByRole("dialog", { name: "Close tab" });
      expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
      expect(within(dialog).queryByRole("button", { name: "Unprotect and close" })).toBeNull();
    });
  });

  it("asks for a session when none is viewed", () => {
    useApp.setState({ viewed: null });
    render(<AgentList />);
    expect(screen.getByText("Select a session")).toBeTruthy();
  });

  const keyOf = (label: string) => projectKey("local", "default", label);
  const closed = () => screen.getByRole("region", { name: "Closed workspaces" });
  const keep = (...labels: string[]) =>
    useLayout.setState({ layout: labels.reduce((l, x) => setKept(l, keyOf(x), "/c/" + x), EMPTY_LAYOUT) });

  it("lists closed kept workspaces under a folded Closed section, under Active and All, not counted", () => {
    keep("agent", "web", "smarthomes");
    render(<AgentList />);
    const toggle = within(closed()).getByRole("button", { name: /Closed/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("Closed workspaces2");
    expect(within(closed()).queryByText("agent", { selector: ".closed-label" })).toBeNull();
    expect(screen.getByRole("button", { name: "Active 3" })).toBeTruthy();
    fireEvent.click(toggle);
    expect(useApp.getState().expanded["closed:local/default"]).toBe(true);
    expect([...closed().querySelectorAll(".closed-label")].map((b) => b.textContent)).toEqual(["agent", "smarthomes"]);
    expect([...closed().querySelectorAll(".ws-folder")].map((b) => b.textContent)).toEqual(["agent", "smarthomes"]);
    act(() => usePaneFilter.setState({ filter: "all" }));
    expect(within(closed()).getByText("agent", { selector: ".closed-label" })).toBeTruthy();
  });

  it("shows no Closed section without closed kept workspaces", () => {
    keep("web");
    render(<AgentList />);
    expect(screen.queryByRole("region", { name: "Closed workspaces" })).toBeNull();
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
    fireEvent.click(within(closed()).getByText("agent", { selector: ".closed-label" }));
    expect(vi.mocked(herdrCall).mock.calls.filter((c) => c[2] === "workspace.create")).toEqual([
      ["local", "default", "workspace.create", { cwd: "/c/agent", label: "agent", focus: false }],
    ]);
    await act(async () => done({ workspace: { workspace_id: "w4" }, root_pane: { pane_id: "p40" } }));
    expect(useApp.getState().selected).toEqual({ machine_id: "local", session: "default", pane_id: "p40" });
  });

  it("issues no second create after create resolves and before the snapshot lists the workspace, from Closed and Bookmark", async () => {
    useLayout.setState({ layout: setBookmarked(EMPTY_LAYOUT, keyOf("agent"), true, "/c/agent") });
    useApp.setState({ expanded: { "closed:local/default": true } });
    vi.mocked(herdrCall).mockResolvedValue({ workspace: { workspace_id: "w4" }, root_pane: { pane_id: "p40" } });
    render(<><AgentList /><Sidebar /></>);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reopen agent" })));
    fireEvent.click(screen.getByRole("button", { name: "Reopen agent" }));
    fireEvent.click(screen.getByRole("button", { name: "agent, default, closed" }));
    expect(vi.mocked(herdrCall).mock.calls.filter((c) => c[2] === "workspace.create")).toHaveLength(1);
  });

  it("issues no second create while a reopen is pending, from the row menu too", async () => {
    keep("agent");
    let done!: (v: unknown) => void;
    vi.mocked(herdrCall).mockImplementation(() => new Promise((r) => (done = r)));
    useApp.setState({ expanded: { "closed:local/default": true } });
    let actions!: Actions;
    function CaptureActions() { actions = useActions()!; return null; }
    render(<ActionsProvider><CaptureActions /><ClosedSection machineId="local" session={m.sessions[0]} /></ActionsProvider>);
    const menu = vi.spyOn(actions, "menu");
    const row = within(closed()).getByText("agent", { selector: ".closed-label" }).closest(".closed-row")!;
    fireEvent.contextMenu(row);
    const capturedReopen = (menu.mock.calls[0][1].find((i) => i !== "sep" && i.label === "Reopen") as MenuItem).onSelect;
    fireEvent.click(screen.getByRole("button", { name: "Reopen agent" }));
    act(() => capturedReopen());
    fireEvent.contextMenu(row);
    const item = screen.getByRole("menuitem", { name: "Reopen" });
    expect((item as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(item);
    expect(vi.mocked(herdrCall).mock.calls.filter((c) => c[2] === "workspace.create")).toEqual([
      ["local", "default", "workspace.create", { cwd: "/c/agent", label: "agent", focus: false }],
    ]);
    await act(async () => done({ workspace: { workspace_id: "w4" }, root_pane: { pane_id: "p40" } }));
  });

  it.each(["closed", "bookmark"])("shares reopen protection across Closed and Bookmark, starting from %s", async (start) => {
    useLayout.setState({ layout: setBookmarked(EMPTY_LAYOUT, keyOf("agent"), true, "/c/agent") });
    useApp.setState({ expanded: { "closed:local/default": true } });
    let done!: (v: unknown) => void;
    vi.mocked(herdrCall).mockReturnValue(new Promise((r) => (done = r)));
    render(<><AgentList /><Sidebar /></>);
    const closedButton = screen.getByRole("button", { name: "Reopen agent" });
    const bookmark = screen.getByRole("button", { name: "agent, default, closed" });
    fireEvent.click(start === "closed" ? closedButton : bookmark);
    expect(bookmark.getAttribute("aria-disabled")).toBe("true");
    expect((closedButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(start === "closed" ? bookmark : closedButton);
    expect(vi.mocked(herdrCall).mock.calls.filter((c) => c[2] === "workspace.create")).toHaveLength(1);
    await act(async () => done({ workspace: { workspace_id: "w4" }, root_pane: { pane_id: "p40" } }));
  });
  it("renders a malformed kept label without throwing", () => {
    useLayout.setState({ layout: { ...EMPTY_LAYOUT, kept: { "local/default/%": { folder: "/a" } } } });
    useApp.setState({ expanded: { "closed:local/default": true } });
    render(<AgentList />);
    expect(within(closed()).getByText("%", { selector: ".closed-label" })).toBeTruthy();
  });
  it("keeping the second duplicate stores the first workspace's folder", () => {
    const duplicate = structuredClone(m);
    const second = structuredClone(duplicate.sessions[0].workspaces[1]);
    second.workspace_id = "w4";
    second.tabs[0].panes[0].cwd = "/second";
    duplicate.sessions[0].workspaces.push(second);
    useApp.setState({ machines: { local: duplicate } });
    render(<AgentList />);
    fireEvent.contextMenu(screen.getAllByRole("group", { name: "web" })[1].querySelector(".ws-head")!);
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Keep when closed" }));
    expect(useLayout.getState().layout.kept).toEqual({ "local/default/web": { folder: "/x" } });
  });
  it("forgets a closed workspace from its menu, unbookmarking it", () => {
    useLayout.setState({ layout: setBookmarked(EMPTY_LAYOUT, keyOf("agent"), true, "/c/agent") });
    useApp.setState({ expanded: { "closed:local/default": true } });
    render(<AgentList />);
    fireEvent.contextMenu(within(closed()).getByText("agent", { selector: ".closed-label" }));
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

  it("carries a kept workspace and its bookmark to its new name on rename", async () => {
    useLayout.setState({ layout: setBookmarked(setKept(EMPTY_LAYOUT, keyOf("web"), "/c/web"), keyOf("web"), true) });
    render(<AgentList />);
    let done!: (v: unknown) => void;
    vi.mocked(herdrCall).mockImplementation(() => new Promise((r) => (done = r)));
    fireEvent.contextMenu(screen.getByRole("group", { name: "web" }).querySelector(".ws-head")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename workspace…" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "web-2" } });
    act(() => fireEvent.click(screen.getByRole("button", { name: "Rename" })));
    expect(herdrCall).toHaveBeenCalledWith("local", "default", "workspace.rename", { workspace_id: "w2", label: "web-2" });
    // Nothing moves until the rename resolves.
    expect(useLayout.getState().layout.kept).toEqual({ [keyOf("web")]: { folder: "/c/web" } });
    expect(useLayout.getState().layout.bookmarks).toEqual([keyOf("web")]);
    await act(async () => done({}));
    expect(useLayout.getState().layout.kept).toEqual({ [keyOf("web-2")]: { folder: "/c/web" } });
    expect(useLayout.getState().layout.bookmarks).toEqual([keyOf("web-2")]);
  });

  const renameWeb = () => {
    fireEvent.contextMenu(screen.getAllByRole("group", { name: "web" })[0].querySelector(".ws-head")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename workspace…" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "web-2" } });
    act(() => fireEvent.click(screen.getByRole("button", { name: "Rename" })));
  };

  it("does not read the old label as closed, or reopen it, while a snapshot with the new label beats the rename", async () => {
    useLayout.setState({ layout: setBookmarked(setKept(EMPTY_LAYOUT, keyOf("web"), "/c/web"), keyOf("web"), true) });
    useApp.setState({ expanded: { "closed:local/default": true } });
    render(<><AgentList /><Sidebar /></>);
    let done!: (v: unknown) => void;
    vi.mocked(herdrCall).mockImplementation(() => new Promise((r) => (done = r)));
    renameWeb();
    const renamed = structuredClone(m);
    renamed.sessions[0].workspaces[1].label = "web-2";
    act(() => useApp.setState({ machines: { local: renamed } }));
    expect(screen.queryByRole("region", { name: "Closed workspaces" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "web, default, closed" }));
    expect(vi.mocked(herdrCall).mock.calls.filter((c) => c[2] === "workspace.create")).toHaveLength(0);
    await act(async () => done({}));
    expect(useLayout.getState().layout.kept).toEqual({ [keyOf("web-2")]: { folder: "/c/web" } });
    expect(useLayout.getState().layout.bookmarks).toEqual([keyOf("web-2")]);
    expect(isReopenPending(keyOf("web"))).toBe(false);
    expect(isReopenPending(keyOf("web-2"))).toBe(false);
  });

  it("leaves the layout untouched, clears the guard and shows the error when the rename is rejected", async () => {
    const before = setBookmarked(setKept(EMPTY_LAYOUT, keyOf("web"), "/c/web"), keyOf("web"), true);
    useLayout.setState({ layout: before });
    render(<AgentList />);
    vi.mocked(herdrCall).mockRejectedValue({ message: "workspace web-2 already exists" });
    renameWeb();
    expect((await screen.findByRole("alert")).textContent).toContain("already exists");
    expect(useLayout.getState().layout).toBe(before);
    expect(isReopenPending(keyOf("web"))).toBe(false);
    expect(isReopenPending(keyOf("web-2"))).toBe(false);
    // A closed web is reopenable again once the guard is gone.
    const gone = structuredClone(m);
    gone.sessions[0].workspaces.splice(1, 1);
    act(() => useApp.setState({ machines: { local: gone } }));
    expect(screen.getByRole("region", { name: "Closed workspaces" })).toBeTruthy();
  });

  it("keeps the kept entry and Bookmark on a label another live workspace still carries", async () => {
    const dup = structuredClone(m);
    const second = structuredClone(dup.sessions[0].workspaces[1]);
    second.workspace_id = "w4";
    dup.sessions[0].workspaces.push(second);
    useApp.setState({ machines: { local: dup } });
    useLayout.setState({ layout: setBookmarked(setKept(EMPTY_LAYOUT, keyOf("web"), "/c/web"), keyOf("web"), true) });
    render(<AgentList />);
    vi.mocked(herdrCall).mockResolvedValue({});
    renameWeb();
    await act(async () => {});
    expect(herdrCall).toHaveBeenCalledWith("local", "default", "workspace.rename", { workspace_id: "w2", label: "web-2" });
    expect(useLayout.getState().layout.kept).toEqual({ [keyOf("web")]: { folder: "/c/web" } });
    expect(useLayout.getState().layout.bookmarks).toEqual([keyOf("web")]);
  });
});

describe("AgentList lanes", () => {
  const tab = (id: string, label: string, panes: PaneView[]) => ({ tab_id: id, label, number: 1, status: "idle" as const, panes });
  const lanes: MachineView = {
    ...m,
    sessions: [
      { name: "default", running: true, status: "working", error: null, workspaces: [
        { workspace_id: "w1", label: "bmf-oms", number: 1, status: "working", tabs: [
          tab("t1", "main-orches", [pane("o", "BMF-OMS review", "claude", "working")]),
          tab("t2", "lane-caps", [pane("l1", "π - lane: caps — Wave 2", "pi", "working")]),
          tab("t3", "lane-search", [pane("l2", "π - lane: search — Wave 2", "pi", "done")]),
          tab("t4", "lane-ipscope", [pane("l3", "lane: ipscope — Wave 2", "claude", "blocked")]),
          tab("t5", "2", [pane("s", "cargo watch", null, "unknown")]),
        ] } ] },
    ],
  };
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useApp.setState({ machines: { local: lanes }, order: ["local"], selected: null, viewed: { machine_id: "local", session: "default" }, expanded: {}, doneSeen: {}, statusSince: {} });
    usePaneFilter.setState({ filter: "active" });
  });
  const rows = () => [...document.querySelectorAll(".agent-card")].map((b) => b.getAttribute("aria-label"));

  it("folds lanes under their orchestrator, surfacing only a lane that needs input", () => {
    render(<AgentList />);
    expect(rows()).toEqual(["BMF-OMS review, claude, in progress", "ipscope — Wave 2, claude, blocked", "cargo watch, shell"]);
    const toggle = screen.getByRole("button", { name: "3 lanes" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("title")).toBe("1 in progress, 1 done, 1 blocked");
    expect(screen.getByRole("button", { name: "ipscope — Wave 2, claude, blocked" }).closest("li")?.className).toContain("lane-row");
  });

  it("keeps the lane toggle clear of the row's age and status word: they sit left of its slot", () => {
    const idle = structuredClone(lanes);
    idle.sessions[0].workspaces[0].tabs[0].panes[0].status = "idle";
    useApp.setState({ machines: { local: idle }, statusSince: { "local/default/o": Date.now() - 5 * 60_000 } });
    const { unmount } = render(<AgentList />);
    const card = screen.getByRole("button", { name: /^BMF-OMS review/ });
    const order = [...card.children].map((c) => c.className);
    const slot = order.findIndex((c) => c.includes("lane-slot"));
    expect(slot).toBeGreaterThan(order.findIndex((c) => c.includes("row-age")));
    expect(card.querySelector(".lane-slot")?.textContent).toBe(screen.getByRole("button", { name: "3 lanes" }).textContent);
    unmount();
    const blocked = structuredClone(lanes);
    blocked.sessions[0].workspaces[0].tabs[0].panes[0].status = "blocked";
    useApp.setState({ machines: { local: blocked } });
    render(<AgentList />);
    const b = [...screen.getByRole("button", { name: /^BMF-OMS review/ }).children].map((c) => c.className);
    expect(b.findIndex((c) => c.includes("lane-slot"))).toBeGreaterThan(b.findIndex((c) => c.includes("agent-input")));
    expect(b.findIndex((c) => c.includes("lane-slot"))).toBeLessThan(b.findIndex((c) => c.includes("mark-blocked")));
  });

  it("opens every lane under the orchestrator, in tab order", () => {
    render(<AgentList />);
    fireEvent.click(screen.getByRole("button", { name: "3 lanes" }));
    expect(rows()).toEqual([
      "BMF-OMS review, claude, in progress",
      "caps — Wave 2, pi, in progress",
      "search — Wave 2, pi, done",
      "ipscope — Wave 2, claude, blocked",
      "cargo watch, shell",
    ]);
    const done = screen.getByRole("button", { name: "search — Wave 2, pi, done" });
    expect(within(done).queryByText("Review")).toBeNull();
    expect(done.querySelector(".agent-review")).toBeNull();
    expect(screen.getByRole("button", { name: "3 lanes" }).getAttribute("title")).toBe("1 in progress, 1 done, 1 blocked");
  });

  it("shows a lane-only Done as plain done, not Review, visually or accessibly", () => {
    const only = structuredClone(lanes);
    only.sessions[0].workspaces[0].tabs = [only.sessions[0].workspaces[0].tabs[2]];
    useApp.setState({ machines: { local: only } });
    usePaneFilter.setState({ filter: "all" });
    render(<AgentList />);
    // Its LANE badge says what the title's prefix did.
    const row = screen.getByRole("button", { name: "search — Wave 2, pi, done" });
    expect(within(row).queryByText("Review")).toBeNull();
    expect(row.querySelector(".agent-review")).toBeNull();
    expect(screen.queryByRole("button", { name: /pi, review/ })).toBeNull();
  });

  it("keeps a selected lane in view while folded", () => {
    useApp.setState({ selected: { machine_id: "local", session: "default", pane_id: "l1" } });
    render(<AgentList />);
    expect(rows()).toContain("caps — Wave 2, pi, in progress");
  });

  it("leaves an unseen Done lane out of a folded workspace's needs-you badge in All", () => {
    const idle = structuredClone(lanes);
    const ws = idle.sessions[0].workspaces[0];
    ws.tabs[0].panes[0].status = "idle";
    ws.tabs = [ws.tabs[0], ws.tabs[2]];
    useApp.setState({ machines: { local: idle } });
    usePaneFilter.setState({ filter: "all" });
    render(<AgentList />);
    fireEvent.click(screen.getByRole("button", { name: "bmf-oms" }));
    expect(screen.getByRole("button", { name: "bmf-oms" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("group", { name: "bmf-oms" }).querySelector(".need")).toBeNull();
  });

  it("counts a blocked lane but not an unseen Done lane on a folded workspace", () => {
    usePaneFilter.setState({ filter: "all" });
    render(<AgentList />);
    fireEvent.click(screen.getByRole("button", { name: "bmf-oms" }));
    expect(screen.getByRole("button", { name: "bmf-oms, 1 needs you" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("group", { name: "bmf-oms" }).querySelector(".need")?.textContent).toBe("1");
  });

  it.each([false, true])("counts a non-lane's Done only when unseen on a folded workspace (seen: %s)", (seen) => {
    const done = structuredClone(lanes);
    done.sessions[0].workspaces[0].tabs[0].panes[0].status = "done";
    useApp.setState({ machines: { local: done }, doneSeen: seen ? { "local/default/o": true } : {} });
    usePaneFilter.setState({ filter: "all" });
    render(<AgentList />);
    fireEvent.click(screen.getByRole("button", { name: "bmf-oms" }));
    const label = seen ? "bmf-oms, 1 needs you" : "bmf-oms, 2 need you";
    expect(screen.getByRole("button", { name: label }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("group", { name: "bmf-oms" }).querySelector(".need")?.textContent).toBe(seen ? "1" : "2");
  });

  it("leaves a lane's done to the orchestrator: the head chip counts only what waits on the user", () => {
    render(<AgentList />);
    expect(screen.getByRole("button", { name: /go to the next one/ }).textContent).toBe("1 blocked");
    expect(screen.getByRole("button", { name: "Active 3" })).toBeTruthy();
  });
});

describe("AgentList tab reordering", () => {
  const dt = () => {
    const data: Record<string, string> = {};
    return { data, types: [] as string[], effectAllowed: "", dropEffect: "",
      setData(t: string, v: string) { data[t] = v; this.types.push(t); }, getData: (t: string) => data[t] ?? "", setDragImage() {} };
  };
  const card = (title: string) => screen.getByText(title).closest("button")!;
  const drag = (from: HTMLElement, to: HTMLElement) => {
    const dataTransfer = dt();
    fireEvent.dragStart(from, { dataTransfer });
    fireEvent.dragEnter(to, { dataTransfer });
    fireEvent.dragOver(to, { dataTransfer });
    fireEvent.drop(to, { dataTransfer });
    fireEvent.dragEnd(from, { dataTransfer });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useApp.setState({ machines: { local: m }, order: ["local"], selected: null, viewed: { machine_id: "local", session: "default" }, doneSeen: {}, expanded: {}, statusSince: {} });
    // The idle "Ship flag" is hidden in Active; these tests drag onto it.
    usePaneFilter.setState({ filter: "all" });
  });

  it("moves a tab after the tab it is dropped on", () => {
    render(<AgentList />);
    // jsdom rects are empty, so every drop lands after the target.
    drag(card("Guard export"), card("Ship flag"));
    expect(herdrCall).toHaveBeenCalledWith("local", "default", "tab.move", { tab_id: "w2:t1", insert_index: 2 });
    expect(document.querySelector(".drop-before, .drop-after")).toBeNull();
  });

  it("shows the indicator on the whole tab while dragging over one of its panes", () => {
    const busy = structuredClone(m);
    busy.sessions[0].workspaces[1].tabs[1].panes[1].status = "working";
    useApp.setState({ machines: { local: busy } });
    render(<AgentList />);
    const dataTransfer = dt();
    fireEvent.dragStart(card("Guard export"), { dataTransfer });
    fireEvent.dragOver(card("Tag v1.4.0"), { dataTransfer });
    expect(screen.getByRole("group", { name: "Tab release" }).className).toContain("drop-after");
  });

  it("does nothing when the drop leaves the tab in place", () => {
    render(<AgentList />);
    drag(card("Tag v1.4.0"), card("Ship flag"));
    drag(card("Guard export"), card("Guard export"));
    expect(herdrCall).not.toHaveBeenCalled();
  });

  it("refuses a drop on another workspace", () => {
    render(<AgentList />);
    drag(card("Idempotent payments"), card("Guard export"));
    expect(herdrCall).not.toHaveBeenCalled();
    expect(document.querySelector(".drop-before, .drop-after")).toBeNull();
  });
});

describe("AgentList lanes by owner (ctc lane list)", () => {
  const tab = (id: string, label: string, panes: PaneView[]) => ({ tab_id: id, label, number: 1, status: "idle" as const, panes });
  // The reported bug: lanes owned by the plain "claude" tab folded under the orch- tab of the same workspace.
  const machine: MachineView = {
    ...m,
    sessions: [
      { name: "default", running: true, status: "working", error: null, workspaces: [
        { workspace_id: "w1", label: "vault", number: 1, status: "working", tabs: [
          tab("t1", "orch-xbit-vault-engine", [pane("w1:tP", "Vault rollout", "claude", "working")]),
          tab("t2", "claude", [pane("w1:p8", "Rate limits", "claude", "working")]),
          tab("t3", "lane-a", [pane("w1:pA", "lane: a", "pi", "working")]),
          tab("t4", "lane-b", [pane("w1:pB", "lane: b", "pi", "working")]),
          tab("t5", "lane-c", [pane("w1:pC", "lane: c", "pi", "working")]),
          tab("t6", "brief-1010-fees", [pane("w1:pF", "brief: fees", "claude", "working")]),
        ] } ] },
    ],
  };
  const owned = (pane_id: string, owner: string | null) => ({ lane_id: "lane-" + pane_id, herdr_session: "default", pane_id, owner });
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useLaneOwners.setState({ byMachine: {} });
    useApp.setState({ machines: { local: machine }, order: ["local"], selected: null, viewed: { machine_id: "local", session: "default" }, expanded: {}, doneSeen: {}, statusSince: {} });
    usePaneFilter.setState({ filter: "all" });
  });
  const card = (name: RegExp) => screen.getByRole("button", { name });

  it("folds each lane under the pane that owns it, not the workspace's orch- tab; an orphan stays on top", async () => {
    vi.mocked(lanesList).mockResolvedValue([owned("w1:pA", "default/w1:p8"), owned("w1:pB", "default/w1:p8"), owned("w1:pC", null)]);
    render(<AgentList />);
    const toggle = await screen.findByRole("button", { name: "2 lanes" });
    expect(toggle.closest("li")).toBe(card(/^Rate limits/).closest("li"));
    expect(card(/^Vault rollout/).closest("li")?.className).not.toContain("has-lanes");
    // Folded: a and b are hidden; c, an orphan, shows on its own with its marker.
    expect(screen.queryByRole("button", { name: /^a, pi/ })).toBeNull();
    const orphan = card(/^c, pi/).closest("li")!;
    expect(orphan.className).not.toContain("lane-row");
    expect(within(orphan).getByRole("img", { name: "Orphan lane" })).toBeTruthy();
    fireEvent.click(toggle);
    expect([...document.querySelectorAll(".agent-card")].map((b) => b.getAttribute("aria-label")?.split(",")[0])).toEqual([
      "Vault rollout", "Rate limits", "a", "b", "c", "fees",
    ]);
  });

  it("says 1 lane, not 1 lanes", async () => {
    vi.mocked(lanesList).mockResolvedValue([owned("w1:pA", "default/w1:p8"), owned("w1:pB", null), owned("w1:pC", null)]);
    render(<AgentList />);
    expect((await screen.findByRole("button", { name: "1 lane" })).closest("li")).toBe(card(/^Rate limits/).closest("li"));
  });

  it("marks a lane orphan when its owner pane is gone", async () => {
    vi.mocked(lanesList).mockResolvedValue([owned("w1:pA", "default/w1:gone"), owned("w1:pB", "default/w1:p8"), owned("w1:pC", "default/w1:p8")]);
    render(<AgentList />);
    await screen.findByRole("button", { name: "2 lanes" });
    expect(within(card(/^a, pi/).closest("li")!).getByRole("img", { name: "Orphan lane" })).toBeTruthy();
  });

  it("marks a role with an icon only where nothing else says it, the session title staying the main text", async () => {
    vi.mocked(lanesList).mockResolvedValue([owned("w1:pA", "default/w1:p8"), owned("w1:pB", "default/w1:p8"), owned("w1:pC", "default/w1:p8")]);
    render(<AgentList />);
    // Before the store answers, the lanes fold by workspace under the orch- tab: wait for the move.
    await vi.waitFor(() => expect(card(/^Rate limits/).closest("li")?.className).toContain("has-lanes"));
    fireEvent.click(screen.getByRole("button", { name: "3 lanes" }));
    const mark = (name: RegExp) => card(name).querySelector(".role-mark")?.getAttribute("aria-label") ?? null;
    // The orch- tab without lanes and the brief carry a mark; the pane with lanes has its "3 lanes"
    // toggle and a lane its place under it, so neither does. No text tag is left on any row.
    expect([mark(/^Vault rollout/), mark(/^Rate limits/), mark(/^a, pi/), mark(/^fees/)]).toEqual(["Orchestrator", null, null, "Brief"]);
    expect(document.querySelector(".role-badge")).toBeNull();
    expect(card(/^Vault rollout/).querySelector(".agent-card-title")?.textContent).toBe("Vault rollout");
  });

  it("falls back to folding by workspace when ctc fails, with nothing marked orphan", async () => {
    render(<AgentList />);
    await vi.waitFor(() => expect(lanesList).toHaveBeenCalledWith("local"));
    expect(card(/^Vault rollout/).closest("li")?.className).toContain("has-lanes");
    expect(screen.getByRole("button", { name: "3 lanes" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Orphan lane" })).toBeNull();
  });
});
