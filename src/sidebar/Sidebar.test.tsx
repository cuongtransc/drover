import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({ sessionStart: vi.fn().mockResolvedValue(undefined), sessionStop: vi.fn().mockResolvedValue(undefined), sessionRename: vi.fn(), herdrCall: vi.fn() }));
import { herdrCall, sessionRename, sessionStart, sessionStop } from "../lib/ipc";
import { useProtect } from "../agents/protect";
import { useApp } from "../store/app";
import { resetReopenPending } from "../workspaces/keptActions";
import { EMPTY_LAYOUT, projectKey, sessionKey, setBookmarked, setKept, useLayout } from "./groups";
import { Sidebar } from "./Sidebar";
import { useSessionFilter, useSessionQuery, useShowDefault, useViewOrigin } from "./activeFilter";
import type { MachineView } from "../lib/types";

const m: MachineView = {
  id: "box", label: "devtuf", kind: "ssh", state: "connected", error: null, version: "0.9.3", status: "working",
  sessions: [
    { name: "default", running: true, loaded: true, status: "working", error: null, workspaces: [
      { workspace_id: "w1", label: "drover", number: 1, status: "working", tabs: [
        { tab_id: "w1:t1", label: "1", number: 1, status: "working", panes: [
          { pane_id: "w1:p1", terminal_id: "t", title: "Rewrite", cwd: "/x", agent: "claude", status: "working" } ] } ] } ] },
    { name: "ai-radar", running: false, loaded: false, status: "unknown", error: null, workspaces: [] },
  ],
};
const row = (name: string) => screen.getAllByText(name)[0].closest("button")!;
const work = { kind: "group" as const, id: "g1", label: "Work", children: [{ kind: "session" as const, key: sessionKey("box", "default") }] };

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetReopenPending();
    localStorage.clear();
    useApp.setState({ machines: { box: m }, order: ["box"], selected: null, viewed: null, expanded: {} });
    useLayout.setState({ layout: EMPTY_LAYOUT });
    useSessionFilter.setState({ filter: "all" });
  });
  it("names the machine of remote sessions only", () => {
    const local = { ...m, id: "local", label: "local", kind: "local" as const };
    useApp.setState({ machines: { local }, order: ["local"] });
    render(<Sidebar />);
    expect(row("default").querySelector(".badge-label")).toBeNull();
  });
  it("a bookmarked project row says what its project needs and names its Session", () => {
    const blocked = structuredClone(m);
    blocked.sessions[0].workspaces[0].tabs[0].panes[0].status = "blocked";
    useApp.setState({ machines: { box: blocked }, doneSeen: {} });
    useLayout.setState({ layout: { tree: [], bookmarks: [projectKey("box", "default", "drover")] } });
    render(<Sidebar />);
    const bm = within(screen.getByRole("region", { name: "Bookmarks" })).getByRole("button", { name: "drover, default, blocked" });
    expect(bm.textContent).toBe("droverdefaultBlocked");
    expect(bm.className).toContain("blocked");
    // The Session row carries no count: its project rows say what needs the user.
    expect(within(screen.getByRole("region", { name: "Sessions" })).getByText("default").closest("button")!.querySelector(".need")).toBeNull();
  });
  it("Active keeps a session and its project for a while after its agent stopped, saying how long ago", () => {
    const idle = structuredClone(m);
    idle.sessions[0].workspaces[0].tabs[0].panes[0].status = "idle";
    useApp.setState({ machines: { box: idle }, doneSeen: {}, statusSince: { "box/default/w1:p1": Date.now() - 12 * 60_000 } });
    useSessionFilter.setState({ filter: "active" });
    render(<Sidebar />);
    const project = screen.getByRole("button", { name: "drover, idle 12m" });
    expect(project.className).toContain("recent");
    expect(project.textContent).toBe("drover12m");
    useApp.setState({ statusSince: {} });
  });
  it("lists a session's projects under it: Blocked, Review, the lanes of one in progress", () => {
    const s = structuredClone(m);
    const p = (pane_id: string, status: "working" | "blocked" | "done" | "idle") => ({ pane_id, terminal_id: "t" + pane_id, title: pane_id, cwd: "/x", agent: "claude", status });
    const t = (label: string, pane: ReturnType<typeof p>) => ({ tab_id: label, label, number: 1, status: pane.status, panes: [pane] });
    s.sessions[0].workspaces = [
      { workspace_id: "w1", label: "drover", number: 1, status: "working", tabs: [t("orch-ux", p("o", "idle")), t("lane-a", p("a", "working")), t("lane-b", p("b", "working"))] },
      { workspace_id: "w2", label: "ccpoke", number: 2, status: "blocked", tabs: [t("1", p("c", "blocked"))] },
      { workspace_id: "w3", label: "history", number: 3, status: "done", tabs: [t("1", p("h", "done"))] },
      { workspace_id: "w4", label: "journal", number: 4, status: "idle", tabs: [t("1", p("j", "idle"))] },
    ];
    useApp.setState({ machines: { box: s }, doneSeen: {} });
    useSessionFilter.setState({ filter: "active" });
    render(<Sidebar />);
    const tree = screen.getByRole("region", { name: "Sessions" });
    const rows = within(tree).getAllByRole("button", { name: /^(drover|ccpoke|history|journal)/ });
    expect(rows.map((b) => b.textContent)).toEqual(["drover2 lanes", "ccpokeBlocked", "historyReview"]);
    fireEvent.click(rows[1]);
    expect(useApp.getState().selected).toEqual({ machine_id: "box", session: "default", pane_id: "c" });
    expect(rows[1].getAttribute("aria-current")).toBe("true");
    expect(within(tree).getByText("default").closest("button")!.getAttribute("aria-current")).toBeNull();
    fireEvent.click(rows[0]);
    expect(useApp.getState().selected?.pane_id).toBe("o");
    // All lists the quiet projects too.
    fireEvent.click(screen.getByRole("button", { name: /^Active/ }));
    expect(within(tree).getByRole("button", { name: "journal" }).className).toContain("quiet");
  });
  it("puts Bookmarks first; a click opens the project's pane and lights only that row", () => {
    useLayout.setState({ layout: { tree: [work], bookmarks: [projectKey("box", "default", "drover")] } });
    render(<Sidebar />);
    const sections = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(sections.indexOf("Bookmarks")).toBeLessThan(sections.indexOf("Sessions"));
    const bm = within(screen.getByRole("region", { name: "Bookmarks" })).getByRole("button", { name: /^drover/ });
    const inTree = within(screen.getByRole("region", { name: "Sessions" })).getByRole("button", { name: "drover" });
    // In the tree the bookmarked project carries the star.
    expect(inTree.querySelector("[aria-label='bookmarked']")).toBeTruthy();
    fireEvent.click(bm);
    expect(useApp.getState().selected).toEqual({ machine_id: "box", session: "default", pane_id: "w1:p1" });
    expect(bm.getAttribute("aria-current")).toBe("true");
    expect(inTree.getAttribute("aria-current")).toBeNull();
    fireEvent.click(inTree);
    expect(inTree.getAttribute("aria-current")).toBe("true");
    expect(bm.getAttribute("aria-current")).toBeNull();
  });
  it("lists sessions no group holds before the groups", () => {
    // A running one: a stopped Session goes last (stoppedFold.ts).
    useApp.setState({ machines: { box: { ...m, sessions: [m.sessions[0], { ...m.sessions[1], running: true }] } } });
    useLayout.setState({ layout: { tree: [work], bookmarks: [] } });
    render(<Sidebar />);
    const labels = [...within(screen.getByRole("region", { name: "Sessions" })).getAllByRole("list")[0].children].map((li) => li.textContent);
    expect(labels[0]).toContain("ai-radar");
    expect(labels[1]).toContain("Work");
  });
  it("folds Machines by default once there is more than one", () => {
    const local = { ...m, id: "local", label: "local", kind: "local" as const, sessions: [] };
    useApp.setState({ machines: { box: m, local }, order: ["local", "box"] });
    render(<Sidebar />);
    expect(screen.getByRole("button", { name: /Machines/ }).getAttribute("aria-expanded")).toBe("false");
  });
  it("Active shows only sessions with agent work, keeps the viewed one, and Show brings the rest back", () => {
    render(<Sidebar />);
    expect(row("ai-radar")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Active 1" }));
    expect(screen.queryByText("ai-radar")).toBeNull();
    expect(row("default")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("drover:settings")!).sessionFilter).toBe("active");
    expect(screen.getByText("1 hidden · idle or stopped")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(row("ai-radar")).toBeTruthy();
    expect(useSessionFilter.getState().filter).toBe("all");
  });
  it("Active keeps the session being viewed whatever its state", () => {
    useApp.setState({ viewed: { machine_id: "box", session: "ai-radar" } });
    useSessionFilter.setState({ filter: "active" });
    render(<Sidebar />);
    expect(row("ai-radar")).toBeTruthy();
    expect(screen.queryByText(/hidden · idle or stopped/)).toBeNull();
  });
  it("shows sessions with a machine badge and machines without sessions", () => {
    render(<Sidebar />);
    expect(row("default").querySelector(".badge-label")?.textContent).toBe("devtuf");
    const machines = screen.getByRole("region", { name: "Machines" });
    expect(within(machines).getByText("devtuf")).toBeTruthy();
    expect(within(machines).queryByText("default")).toBeNull();
    expect(within(machines).queryByText("drover")).toBeNull();
    expect(screen.queryByRole("region", { name: "Bookmarks" })).toBeNull();
  });
  it("renders sessions inside their group and collapses it", () => {
    useLayout.setState({ layout: { tree: [work], bookmarks: [] } });
    render(<Sidebar />);
    expect(row("default").closest("li.group")?.textContent).toContain("Work");
    fireEvent.click(screen.getByText("Work"));
    expect(useApp.getState().expanded["group:g1"]).toBe(false);
    expect(screen.queryByText("default")).toBeNull();
    expect(screen.getByText("ai-radar")).toBeTruthy();
  });
  it("keeps a bookmarked project while Active hides its Session, and one whose Workspace is gone, closed", () => {
    useLayout.setState({ layout: { tree: [], bookmarks: [projectKey("box", "ai-radar", "old"), projectKey("box", "default", "drover")] } });
    useSessionFilter.setState({ filter: "active" });
    render(<Sidebar />);
    expect(within(screen.getByRole("region", { name: "Sessions" })).queryByText("ai-radar")).toBeNull();
    const bm = screen.getByRole("region", { name: "Bookmarks" });
    const closed = within(bm).getByRole("button", { name: "old, ai-radar, closed" });
    expect(closed.textContent).toBe("oldai-radarclosed");
    expect(closed.className).toContain("closed");
    fireEvent.click(closed);
    expect(useApp.getState().selected).toBeNull();
  });
  it("does not reopen a running Session's closed Bookmark that was never kept", () => {
    // The Session is live and running, so the only thing stopping the reopen is the absent kept entry.
    const key = projectKey("box", "default", "old");
    useLayout.setState({ layout: { tree: [], bookmarks: [key] } });
    render(<Sidebar />);
    const closed = within(screen.getByRole("region", { name: "Bookmarks" })).getByRole("button", { name: "old, default, closed" });
    fireEvent.click(closed);
    expect(herdrCall).not.toHaveBeenCalled();
    expect(useApp.getState().selected).toBeNull();
  });
  it("keeps renamed Session entries when its snapshot arrives before the rename resolves", async () => {
    const oldKey = projectKey("box", "ai-radar", "app");
    const newKey = projectKey("box", "radar", "app");
    useLayout.setState({ layout: setBookmarked(EMPTY_LAYOUT, oldKey, true, "/app") });
    let resolve!: () => void;
    vi.mocked(sessionRename).mockReturnValue(new Promise<void>((r) => (resolve = r)));
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Start ai-radar" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename session…" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "radar" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    act(() => useApp.getState().upsertMachine({ ...m, sessions: m.sessions.map((s) => s.name === "ai-radar" ? { ...s, name: "radar" } : s) }));
    expect(useLayout.getState().layout.kept).toEqual({ [oldKey]: { folder: "/app" } });
    expect(useLayout.getState().layout.bookmarks).toEqual([oldKey]);
    await act(async () => resolve());
    expect(useLayout.getState().layout.kept).toEqual({ [newKey]: { folder: "/app" } });
    expect(useLayout.getState().layout.bookmarks).toEqual([newKey]);
  });
  it("keeps the source protected when an overlapping Session rename rejects before the first resolves", async () => {
    useLayout.setState({ layout: setBookmarked(EMPTY_LAYOUT, "box/ai-radar/app", true, "/app") });
    let resolve!: () => void;
    vi.mocked(sessionRename)
      .mockReturnValueOnce(new Promise<void>((r) => (resolve = r)))
      .mockRejectedValueOnce(new Error("second rename failed"));
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Start ai-radar" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename session…" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "radar" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    try {
      fireEvent.contextMenu(screen.getByRole("button", { name: "Start ai-radar" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Rename session…" }));
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "other-radar" } });
      fireEvent.click(screen.getByRole("button", { name: "Rename" }));
      await waitFor(() => expect(screen.getByText("second rename failed")).toBeTruthy());
      act(() => useApp.getState().upsertMachine({ ...m, sessions: m.sessions.map((s) => s.name === "ai-radar" ? { ...s, name: "radar" } : s) }));
      expect(useLayout.getState().layout.kept).toEqual({ "box/ai-radar/app": { folder: "/app" } });
      expect(useLayout.getState().layout.bookmarks).toEqual(["box/ai-radar/app"]);
    } finally {
      await act(async () => resolve());
    }
    expect(useLayout.getState().layout.kept).toEqual({ "box/radar/app": { folder: "/app" } });
    expect(useLayout.getState().layout.bookmarks).toEqual(["box/radar/app"]);
  });
  it("leaves layout keys unchanged if a Session rename fails", async () => {
    const key = projectKey("box", "ai-radar", "app");
    useLayout.setState({ layout: setBookmarked(EMPTY_LAYOUT, key, true, "/app") });
    vi.mocked(sessionRename).mockRejectedValue(new Error("rename failed"));
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Start ai-radar" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename session…" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "radar" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(screen.getByText("rename failed")).toBeTruthy());
    expect(useLayout.getState().layout.kept).toEqual({ [key]: { folder: "/app" } });
    expect(useLayout.getState().layout.bookmarks).toEqual([key]);
  });
  it("leaves both Sessions' kept entries and Bookmarks unchanged when renaming into an existing Session fails", async () => {
    const destination = { ...m.sessions[1], name: "radar" };
    const machine = { ...m, sessions: [...m.sessions, destination] };
    // Two stopped Sessions fold into one row: open it, for ai-radar's row.
    useApp.setState({ machines: { box: machine }, expanded: { "stopped:root": true } });
    const layout = {
      tree: [],
      bookmarks: ["box/ai-radar/app", "box/ai-radar/source", "box/radar/app", "box/radar/destination"],
      kept: {
        "box/ai-radar/app": { folder: "/source-app" },
        "box/ai-radar/source": { folder: "/source" },
        "box/radar/app": { folder: "/destination-app" },
        "box/radar/destination": { folder: "/destination" },
      },
    };
    useLayout.setState({ layout });
    let reject!: (e: Error) => void;
    vi.mocked(sessionRename).mockReturnValue(new Promise<void>((_, r) => (reject = r)));
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Start ai-radar" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename session…" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "radar" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await act(async () => reject(new Error("destination exists")));
    expect(screen.getByText("destination exists")).toBeTruthy();
    expect(useLayout.getState().layout).toEqual(layout);
    // A subsequent real deletion must not be hidden by a leaked pending marker.
    act(() => useApp.getState().upsertMachine({ ...machine, sessions: machine.sessions.filter((s) => s.name !== "ai-radar") }));
    expect(useLayout.getState().layout.kept).toEqual({
      "box/radar/app": { folder: "/destination-app" },
      "box/radar/destination": { folder: "/destination" },
    });
    expect(useLayout.getState().layout.bookmarks).toEqual(["box/radar/app", "box/radar/destination"]);
  });
  it("bookmarking the second duplicate stores the first workspace's folder", () => {
    const duplicate = structuredClone(m);
    const first = duplicate.sessions[0].workspaces[0];
    const second = structuredClone(first);
    second.workspace_id = "w2";
    second.tabs[0].panes[0].cwd = "/second";
    duplicate.sessions[0].workspaces.push(second);
    useApp.setState({ machines: { box: duplicate } });
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getAllByRole("button", { name: "drover" })[1]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Bookmark" }));
    expect(useLayout.getState().layout.kept).toEqual({ "box/default/drover": { folder: "/x" } });
  });
  it("bookmarking from an open duplicate menu uses the surviving first workspace's folder", () => {
    const duplicate = structuredClone(m);
    const first = duplicate.sessions[0].workspaces[0];
    const second = structuredClone(first);
    second.workspace_id = "w2";
    second.tabs[0].panes[0].cwd = "/second";
    duplicate.sessions[0].workspaces.push(second);
    useApp.setState({ machines: { box: duplicate } });
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getAllByRole("button", { name: "drover" })[1]);
    const snapshot = structuredClone(duplicate);
    snapshot.sessions[0].workspaces.shift();
    act(() => useApp.getState().upsertMachine(snapshot));
    fireEvent.click(screen.getByRole("menuitem", { name: "Bookmark" }));
    expect(useLayout.getState().layout.kept).toEqual({ "box/default/drover": { folder: "/second" } });
    expect(useLayout.getState().layout.bookmarks).toEqual(["box/default/drover"]);
  });
  it("bookmarking a project keeps its workspace with its folder", () => {
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "drover" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Bookmark" }));
    expect(useLayout.getState().layout.kept).toEqual({ [projectKey("box", "default", "drover")]: { folder: "/x" } });
  });
  it("reopens a closed bookmarked workspace that is kept", async () => {
    const key = projectKey("box", "default", "old");
    useLayout.setState({ layout: setKept({ tree: [], bookmarks: [key] }, key, "/c/old") });
    let release!: (v: unknown) => void;
    vi.mocked(herdrCall).mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(<Sidebar />);
    fireEvent.click(within(screen.getByRole("region", { name: "Bookmarks" })).getByRole("button", { name: "old, default, closed" }));
    // Origin and the herdr call happen before workspace.create settles, so moving setOrigin after
    // the await would fail here.
    expect(herdrCall).toHaveBeenCalledWith("box", "default", "workspace.create", { cwd: "/c/old", label: "old", focus: false });
    expect(useViewOrigin.getState().from).toBe("bookmarks");
    release({ workspace: { workspace_id: "w5" }, root_pane: { pane_id: "w5:p1" } });
    await waitFor(() => expect(useApp.getState().selected).toEqual({ machine_id: "box", session: "default", pane_id: "w5:p1" }));
  });
  it("does not reopen a kept Bookmark whose running Session has no snapshot yet", () => {
    // machines.rs reports workspaces: [] for a running Session until its first watcher view arrives.
    const key = projectKey("box", "default", "old");
    useLayout.setState({ layout: setKept({ tree: [], bookmarks: [key] }, key, "/c/old") });
    const unknown = structuredClone(m);
    unknown.sessions[0] = { ...unknown.sessions[0], loaded: false, workspaces: [] };
    useApp.setState({ machines: { box: unknown } });
    render(<Sidebar />);
    const closed = within(screen.getByRole("region", { name: "Bookmarks" })).getByRole("button", { name: "old, default, closed" });
    fireEvent.click(closed);
    expect(herdrCall).not.toHaveBeenCalled();
  });
  it("reopens a closed kept Bookmark once when it is double clicked", async () => {
    const key = projectKey("box", "default", "old");
    useLayout.setState({ layout: setKept({ tree: [], bookmarks: [key] }, key, "/c/old") });
    let release!: (v: unknown) => void;
    vi.mocked(herdrCall).mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(<Sidebar />);
    const closed = within(screen.getByRole("region", { name: "Bookmarks" })).getByRole("button", { name: "old, default, closed" }) as HTMLButtonElement;
    fireEvent.click(closed);
    fireEvent.click(closed);
    expect(herdrCall).toHaveBeenCalledTimes(1);
    expect(closed.getAttribute("aria-disabled")).toBe("true");
    fireEvent.contextMenu(closed);
    fireEvent.click(screen.getByRole("menuitem", { name: "Unbookmark" }));
    expect(useLayout.getState().layout.bookmarks).toEqual([]);
    expect(useLayout.getState().layout.kept?.[key]).toEqual({ folder: "/c/old" });
    release({ workspace: { workspace_id: "w5" }, root_pane: { pane_id: "w5:p1" } });
    await waitFor(() => expect(useApp.getState().selected).toEqual({ machine_id: "box", session: "default", pane_id: "w5:p1" }));
    expect(herdrCall).toHaveBeenCalledTimes(1);
  });
  it("views a running session on click", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText("default"));
    expect(useApp.getState().viewed).toEqual({ machine_id: "box", session: "default" });
    // The pane it opened is in drover: that project's row is the one lit.
    expect(screen.getByRole("button", { name: "drover" }).className).toContain("active");
  });
  it("selecting a pane views its session", () => {
    useApp.getState().select({ machine_id: "box", session: "default", pane_id: "w1:p1" });
    expect(useApp.getState().viewed).toEqual({ machine_id: "box", session: "default" });
  });
  it("starts and views a stopped session on click", async () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByText("ai-radar"));
    expect(sessionStart).toHaveBeenCalledWith("box", "ai-radar");
    await waitFor(() => expect(useApp.getState().viewed).toEqual({ machine_id: "box", session: "ai-radar" }));
  });
  it("names the protected panes before stopping their session, and unprotects them on Stop", () => {
    useProtect.setState({ marks: { "box/default/w1:p1": true } });
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByText("default"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop session" }));
    const dialog = screen.getByRole("dialog", { name: "Stop session" });
    expect(within(dialog).getByText("Rewrite")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Unprotect and close" }));
    expect(sessionStop).toHaveBeenCalledWith("box", "default");
    expect(useProtect.getState().marks["box/default/w1:p1"]).toBe(false);
  });
  it("names the agents still working before stopping their session, Cancel first", () => {
    useProtect.setState({ marks: {} });
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByText("default"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Stop session" }));
    const dialog = screen.getByRole("dialog", { name: "Stop session" });
    expect([...dialog.querySelectorAll(".busy-list li")].map((li) => li.textContent)).toEqual(["Rewrite · Claude working"]);
    expect(document.activeElement?.textContent).toBe("Cancel");
  });
  it("ignores clicks on sessions of a machine that is not connected", () => {
    useApp.setState({ machines: { box: { ...m, state: "disconnected" } } });
    render(<Sidebar />);
    fireEvent.click(screen.getByText("default"));
    expect(useApp.getState().viewed).toBeNull();
    expect(row("default").getAttribute("aria-disabled")).toBe("true");
    fireEvent.contextMenu(screen.getByText("default"));
    expect(screen.getByRole("menuitem", { name: "Move to group…" })).toBeTruthy();
    for (const name of ["Delete session…", "Start session", "Stop session", "New workspace…"])
      expect(screen.queryByRole("menuitem", { name })).toBeNull();
  });
});

describe("Sidebar tree", () => {
  const p = (pane_id: string, status: "working" | "blocked" | "done" | "idle") => ({ pane_id, terminal_id: "t" + pane_id, title: pane_id, cwd: "/x", agent: "claude", status });
  const t = (label: string, pane: ReturnType<typeof p>) => ({ tab_id: label, label, number: 1, status: pane.status, panes: [pane] });
  const projects = () => {
    const s = structuredClone(m);
    s.sessions[0].workspaces = [
      { workspace_id: "w1", label: "drover", number: 1, status: "working", tabs: [t("1", p("o", "working"))] },
      { workspace_id: "w2", label: "ccpoke", number: 2, status: "blocked", tabs: [t("1", p("c", "blocked"))] },
      { workspace_id: "w3", label: "journal", number: 3, status: "idle", tabs: [t("1", p("j", "idle"))] },
    ];
    return s;
  };
  beforeEach(() => {
    useApp.setState({ machines: { box: projects() }, order: ["box"], selected: null, viewed: null, expanded: {}, doneSeen: {} });
    useLayout.setState({ layout: EMPTY_LAYOUT });
    useSessionFilter.setState({ filter: "all" });
  });
  const tree = () => screen.getByRole("region", { name: "Sessions" });
  const projectNames = () => [...tree().querySelectorAll(".project-row")].map((b) => b.textContent);

  it("folds a Session's projects, keeping the one that asks, and counts the rest in a row that unfolds it", () => {
    render(<Sidebar />);
    const fold = within(tree()).getByRole("button", { name: "Fold default" });
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(fold);
    expect(useApp.getState().expanded[`session:${sessionKey("box", "default")}`]).toBe(false);
    expect(projectNames()).toEqual(["ccpokeBlocked", "2 more"]);
    expect(within(tree()).getByRole("button", { name: "Unfold default" }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(within(tree()).getByRole("button", { name: "2 more" }));
    expect(projectNames()).toEqual(["drover", "ccpokeBlocked", "journal"]);
  });

  it("folded, still shows the project holding the selected pane", () => {
    useApp.setState({ expanded: { [`session:${sessionKey("box", "default")}`]: false }, selected: { machine_id: "box", session: "default", pane_id: "j" } });
    useViewOrigin.setState({ from: "sessions" });
    render(<Sidebar />);
    expect(projectNames()).toEqual(["ccpokeBlocked", "journal", "1 more"]);
  });

  it("folds and unfolds a Session row with the arrow keys", () => {
    render(<Sidebar />);
    const session = within(tree()).getByText("default").closest("button")!;
    fireEvent.keyDown(session, { key: "ArrowLeft" });
    expect(projectNames()).toEqual(["ccpokeBlocked", "2 more"]);
    fireEvent.keyDown(session, { key: "ArrowRight" });
    expect(projectNames()).toHaveLength(3);
  });

  it("opens a Session and folds or unfolds it on every click, like a folder in VS Code", () => {
    render(<Sidebar />);
    const session = within(tree()).getByText("default").closest("button")!;
    fireEvent.click(session);
    expect(useApp.getState().viewed).toMatchObject({ machine_id: "box", session: "default" });
    // Folded, it keeps the project now on screen and the one that asks.
    expect(projectNames()).toEqual(["drover", "ccpokeBlocked", "1 more"]);
    fireEvent.click(session);
    expect(projectNames()).toHaveLength(3);
  });

  it("gives no fold control to a Session without projects", () => {
    render(<Sidebar />);
    expect(within(tree()).queryByRole("button", { name: /fold ai-radar/i })).toBeNull();
  });

  it("filters with one Active toggle that names how many sessions it keeps", () => {
    render(<Sidebar />);
    const active = within(tree()).getByRole("button", { name: "Active 1" });
    expect(active.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(active);
    expect(useSessionFilter.getState().filter).toBe("active");
    expect(active.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(active);
    expect(useSessionFilter.getState().filter).toBe("all");
  });

});

describe("Sessions filter", () => {
  const p = (id: string, agent: string | null = "claude") => ({ pane_id: id, terminal_id: "t" + id, title: id, cwd: "/x", agent, status: "idle" as const });
  const ws = (id: string, label: string, agent: string | null = "claude") =>
    ({ workspace_id: id, label, number: 1, status: "idle" as const, tabs: [{ tab_id: id + ":t", label: "1", number: 1, status: "idle" as const, panes: [p(id + "p", agent)] }] });
  const s = (name: string, workspaces: ReturnType<typeof ws>[]) => ({ name, running: true, loaded: true, status: "idle" as const, error: null, workspaces });
  const local: MachineView = { id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "idle",
    sessions: [s("default", [ws("w0", "~", null)]), s("w-xb", [ws("w1", "notes")]), s("w-wd", [ws("w2", "bmf-oms"), ws("w3", "xbit-specs")])] };
  const dev: MachineView = { ...local, id: "dev", label: "ct-dev", kind: "ssh",
    sessions: [s("default", [ws("w4", "~", null)]), s("dw-wd", [ws("w5", "bmf-oms")])] };
  const sessions = () => within(screen.getByRole("region", { name: "Sessions" }));
  const names = () => sessions().queryAllByText(/^(default|w-xb|w-wd|dw-wd)$/).map((e) => e.textContent);
  const input = () => sessions().getByRole("searchbox", { name: "Filter sessions" });

  beforeEach(() => {
    localStorage.clear();
    useApp.setState({ machines: { local, dev }, order: ["local", "dev"], selected: null, viewed: null, expanded: {} });
    useLayout.setState({ layout: EMPTY_LAYOUT });
    useSessionFilter.setState({ filter: "active" });
    useSessionQuery.setState({ query: "", machine: null });
    useShowDefault.setState({ show: false });
  });

  it("hides herdr's default Session while it has no agent, unless Settings shows it", () => {
    useSessionFilter.setState({ filter: "all" });
    const { rerender } = render(<Sidebar />);
    expect(names()).toEqual(["w-xb", "w-wd", "dw-wd"]);
    act(() => useShowDefault.getState().setShow(true));
    rerender(<Sidebar />);
    expect(names()).toEqual(["default", "w-xb", "w-wd", "default", "dw-wd"]);
  });

  it("narrows the tree to the words typed, past Active, showing a Session's matching Workspaces", () => {
    render(<Sidebar />);
    expect(names()).toEqual([]);
    fireEvent.change(input(), { target: { value: "xb" } });
    expect(names()).toEqual(["w-xb", "w-wd"]);
    // w-wd is kept for one Workspace: only that one is listed under it
    expect(sessions().queryByRole("button", { name: /^bmf-oms/ })).toBeNull();
    expect(sessions().getByRole("button", { name: /^xbit-specs/ })).toBeTruthy();
    fireEvent.change(input(), { target: { value: "default" } });
    expect(names()).toEqual(["default", "default"]);
  });

  it("Esc clears the words, and a second Esc leaves the field", () => {
    render(<Sidebar />);
    input().focus();
    fireEvent.change(input(), { target: { value: "bmf" } });
    fireEvent.keyDown(input(), { key: "Escape" });
    expect((input() as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input());
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(document.activeElement).not.toBe(input());
  });

  it("a machine chip keeps that machine's Sessions, with the words too; a second click shows every machine", () => {
    useSessionFilter.setState({ filter: "all" });
    render(<Sidebar />);
    const chip = sessions().getByRole("button", { name: "ct-dev" });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(names()).toEqual(["dw-wd"]);
    fireEvent.change(input(), { target: { value: "bmf" } });
    expect(names()).toEqual(["dw-wd"]);
    fireEvent.click(chip);
    expect(names()).toEqual(["w-wd", "dw-wd"]);
  });

  it("offers no machine chips with a single machine", () => {
    useApp.setState({ machines: { local }, order: ["local"] });
    render(<Sidebar />);
    expect(sessions().queryByRole("button", { name: "local" })).toBeNull();
  });

  it("says what it filtered by when nothing matches", () => {
    render(<Sidebar />);
    fireEvent.click(sessions().getByRole("button", { name: "ct-dev" }));
    fireEvent.change(input(), { target: { value: "vault" } });
    expect(sessions().getByText('No session on ct-dev matches "vault"')).toBeTruthy();
  });
});

describe("Stopped Sessions fold", () => {
  const stopped = (name: string) => ({ name, running: false, status: "unknown" as const, error: null, workspaces: [] });
  const box: MachineView = { ...m, sessions: [m.sessions[0], stopped("old-a"), stopped("old-b"), stopped("old-c")] };
  const sessions = () => within(screen.getByRole("region", { name: "Sessions" }));
  const S = (name: string) => ({ kind: "session" as const, key: sessionKey("box", name) });

  beforeEach(() => {
    localStorage.clear();
    useApp.setState({ machines: { box }, order: ["box"], selected: null, viewed: null, expanded: {} });
    useLayout.setState({ layout: EMPTY_LAYOUT });
    useSessionFilter.setState({ filter: "all" });
    useSessionQuery.setState({ query: "", machine: null });
  });

  it("folds two or more stopped Sessions into one row that names them, and a click opens it", () => {
    render(<Sidebar />);
    const fold = sessions().getByRole("button", { name: "3 stopped · old-a, old-b, old-c" });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(sessions().queryByText("old-a")).toBeNull();
    fireEvent.click(fold);
    expect(useApp.getState().expanded["stopped:root"]).toBe(true);
    const open = sessions().getByRole("button", { name: "3 stopped" });
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(row("old-a")).toBeTruthy();
  });

  it("folds each group's stopped Sessions on their own, and leaves a lone one as a row, last", () => {
    useLayout.setState({ layout: { bookmarks: [], tree: [
      S("old-c"),
      { kind: "group", id: "g1", label: "Work", children: [S("old-a"), S("default"), S("old-b")] },
    ] } });
    render(<Sidebar />);
    expect(sessions().getByRole("button", { name: "2 stopped · old-a, old-b" })).toBeTruthy();
    // old-c is the root's only stopped Session: a row of its own, after the Work group
    const rows = [...screen.getByRole("region", { name: "Sessions" }).querySelectorAll(".group > .row .label, .tree > li.session > .row .label")];
    expect(rows.map((r) => r.textContent)).toEqual(["Work", "old-c"]);
    fireEvent.click(sessions().getByRole("button", { name: "2 stopped · old-a, old-b" }));
    expect(useApp.getState().expanded["stopped:g1"]).toBe(true);
  });

  it("keeps the viewed Session in its place", () => {
    useApp.setState({ viewed: { machine_id: "box", session: "old-b" } });
    render(<Sidebar />);
    expect(row("old-b")).toBeTruthy();
    expect(sessions().getByRole("button", { name: "2 stopped · old-a, old-c" })).toBeTruthy();
  });

  it("shows stopped Sessions the words find as rows, not folded", () => {
    useSessionQuery.setState({ query: "old" });
    render(<Sidebar />);
    expect(sessions().queryByRole("button", { name: /stopped/ })).toBeNull();
    expect(row("old-a")).toBeTruthy();
  });

  it("Show under Active opens the folds it brings back", () => {
    useLayout.setState({ layout: { bookmarks: [], tree: [{ kind: "group", id: "g1", label: "Work", children: [S("old-a"), S("old-b")] }] } });
    useSessionFilter.setState({ filter: "active" });
    render(<Sidebar />);
    fireEvent.click(sessions().getByRole("button", { name: "Show" }));
    expect(sessions().getByRole("button", { name: "2 stopped" }).getAttribute("aria-expanded")).toBe("true");
    expect(row("old-a")).toBeTruthy();
  });

  it("opens a fold that a stopped Session was just moved into", () => {
    useLayout.setState({ layout: { bookmarks: [], tree: [S("old-c"), { kind: "group", id: "g1", label: "Work", children: [S("old-a"), S("old-b")] }] } });
    render(<Sidebar />);
    expect(sessions().getByRole("button", { name: "2 stopped · old-a, old-b" })).toBeTruthy();
    act(() => useLayout.setState({ layout: { bookmarks: [], tree: [{ kind: "group", id: "g1", label: "Work", children: [S("old-a"), S("old-b"), S("old-c")] }] } }));
    expect(sessions().getByRole("button", { name: "3 stopped" }).getAttribute("aria-expanded")).toBe("true");
    expect(row("old-c")).toBeTruthy();
  });

  it("does not open a fold when a Session stops where it is", () => {
    const running = { ...box, sessions: [m.sessions[0], stopped("old-a"), stopped("old-b"), { ...stopped("old-c"), running: true, status: "idle" as const }] };
    useApp.setState({ machines: { box: running } });
    render(<Sidebar />);
    act(() => useApp.setState({ machines: { box } }));
    expect(sessions().getByRole("button", { name: "3 stopped · old-a, old-b, old-c" }).getAttribute("aria-expanded")).toBe("false");
  });
});
