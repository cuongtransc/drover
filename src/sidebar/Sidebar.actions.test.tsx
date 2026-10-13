import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({
  machineConnect: vi.fn().mockResolvedValue(undefined),
  sessionsRefresh: vi.fn().mockResolvedValue(undefined),
  sessionStart: vi.fn().mockRejectedValue({ code: "timeout", message: "session x did not start within 10s" }),
  sessionDelete: vi.fn().mockResolvedValue(undefined),
  sessionRename: vi.fn().mockResolvedValue(undefined),
}));
import { machineConnect, sessionDelete, sessionRename, sessionsRefresh, sessionStart } from "../lib/ipc";
import { getFolder, setFolder } from "../workspaces/folder";
import { useApp } from "../store/app";
import { EMPTY_LAYOUT, projectKey, sessionKey, useLayout } from "./groups";
import { useSessionFilter, useShowDefault } from "./activeFilter";
import { Sidebar } from "./Sidebar";
import type { MachineView } from "../lib/types";

const local: MachineView = {
  id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "unknown",
  sessions: [{ name: "x", running: false, status: "unknown", error: null, workspaces: [] }],
};
const set = (machines: MachineView[]) => {
  useLayout.setState({ layout: EMPTY_LAYOUT });
  useApp.setState({ machines: Object.fromEntries(machines.map((m) => [m.id, m])), order: machines.map((m) => m.id), selected: null, expanded: {} });
};

describe("Sidebar machine actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionFilter.setState({ filter: "all" });
    // Its fixtures name sessions "default" with no agent, which the sidebar hides unless shown.
    useShowDefault.setState({ show: true });
  });
  it("offers Retry for the local machine in error", () => {
    set([{ ...local, state: "error", error: { code: "herdr_not_found", message: "herdr was not found" }, sessions: [] }]);
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(machineConnect).toHaveBeenCalledWith("local");
  });
  it("offers Connect… for an ssh machine in a non-auth error", () => {
    set([{ ...local, id: "box", label: "box", kind: "ssh", state: "error", error: { code: "io", message: "Connection refused" }, sessions: [] }]);
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Connect…" }));
    expect(machineConnect).toHaveBeenCalledWith("box");
  });
  it("refreshes sessions from the machine context menu, local included", () => {
    set([local]);
    render(<Sidebar />);
    fireEvent.contextMenu(within(screen.getByRole("region", { name: "Machines" })).getByText("local"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Refresh sessions" }));
    expect(sessionsRefresh).toHaveBeenCalledWith("local");
  });
  it("creates a new session from the machine context menu", () => {
    set([local]);
    render(<Sidebar />);
    fireEvent.contextMenu(within(screen.getByRole("region", { name: "Machines" })).getByText("local"));
    fireEvent.click(screen.getByRole("menuitem", { name: "New session…" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "x" } });
    expect(screen.getByText(/already exists/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "api" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(sessionStart).toHaveBeenCalledWith("local", "api");
  });
  it("offers no New session on a machine that is not connected", () => {
    set([{ ...local, id: "box", label: "box", kind: "ssh", state: "disconnected", sessions: [] }]);
    render(<Sidebar />);
    fireEvent.contextMenu(within(screen.getByRole("region", { name: "Machines" })).getByText("box"));
    expect(screen.queryByRole("menuitem", { name: "New session…" })).toBeNull();
  });
  it("creates a new session on a chosen machine from the Groups menu", () => {
    set([{ ...local, state: "disconnected" }, { ...local, id: "box", label: "box", kind: "ssh", sessions: [] }]);
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByRole("region", { name: "Groups" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New session…" }));
    expect((screen.getByLabelText("Machine") as HTMLSelectElement).value).toBe("box");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "api" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(sessionStart).toHaveBeenCalledWith("box", "api");
  });
  it("offers no New session in the Groups menu when no machine is connected", () => {
    set([{ ...local, state: "disconnected" }]);
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByRole("region", { name: "Groups" }));
    expect(screen.queryByRole("menuitem", { name: "New session…" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "New group" })).toBeTruthy();
  });
  it("offers New session with a machine picker on a group row", () => {
    set([local]);
    useLayout.setState({ layout: { tree: [{ kind: "group", id: "g", label: "Work", children: [] }], bookmarks: [] } });
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByText("Work"));
    fireEvent.click(screen.getByRole("menuitem", { name: "New session…" }));
    expect(screen.getByLabelText("Machine")).toBeTruthy();
  });
  it("shows a failed inline Start", async () => {
    set([local]);
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Start x" }));
    expect((await screen.findByRole("alert")).textContent).toContain("did not start");
  });
  it("deletes a stopped session after confirming, and forgets its folders", async () => {
    set([local]);
    setFolder({ machine_id: "local", session: "x", workspace_id: "w1" }, "/srv/x");
    setFolder({ machine_id: "local", session: "xy", workspace_id: "w1" }, "/srv/xy");
    useLayout.setState({ layout: { tree: [], bookmarks: [projectKey("local", "x", "app")] } });
    render(<Sidebar />);
    fireEvent.contextMenu(within(screen.getByRole("region", { name: "Sessions" })).getByText("x"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete session…" }));
    expect(sessionDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(sessionDelete).toHaveBeenCalledWith("local", "x");
    await waitFor(() => expect(getFolder({ machine_id: "local", session: "x", workspace_id: "w1" })).toBeNull());
    expect(getFolder({ machine_id: "local", session: "xy", workspace_id: "w1" })).toBe("/srv/xy");
    expect(useLayout.getState().layout.bookmarks).toEqual([]);
  });
  it("offers no Delete for a running session", () => {
    set([{ ...local, sessions: [{ name: "x", running: true, status: "idle", error: null, workspaces: [] }] }]);
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByText("x"));
    expect(screen.queryByRole("menuitem", { name: "Delete session…" })).toBeNull();
  });
  it("renames a stopped session, carrying its group, bookmark and folders over", async () => {
    set([local]);
    setFolder({ machine_id: "local", session: "x", workspace_id: "w1" }, "/srv/x");
    setFolder({ machine_id: "local", session: "xy", workspace_id: "w1" }, "/srv/xy");
    const [kx, ky] = [sessionKey("local", "x"), sessionKey("local", "y")];
    useLayout.setState({ layout: { tree: [{ kind: "group", id: "g", label: "Work", children: [{ kind: "session", key: kx }] }], bookmarks: [projectKey("local", "x", "app")] } });
    render(<Sidebar />);
    fireEvent.contextMenu(within(screen.getByRole("region", { name: "Sessions" })).getByText("x"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename session…" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(sessionRename).toHaveBeenCalledWith("local", "x", "y");
    await waitFor(() => expect(useLayout.getState().layout.bookmarks).toEqual([projectKey("local", "y", "app")]));
    expect(useLayout.getState().layout.tree).toEqual([{ kind: "group", id: "g", label: "Work", children: [{ kind: "session", key: ky }] }]);
    expect(getFolder({ machine_id: "local", session: "y", workspace_id: "w1" })).toBe("/srv/x");
    expect(getFolder({ machine_id: "local", session: "x", workspace_id: "w1" })).toBeNull();
    expect(getFolder({ machine_id: "local", session: "xy", workspace_id: "w1" })).toBe("/srv/xy");
  });
  it("keeps everything when the rename fails", async () => {
    vi.mocked(sessionRename).mockRejectedValueOnce({ code: "herdr_error", message: "could not rename x: y already exists" });
    set([local]);
    const kx = projectKey("local", "x", "app");
    useLayout.setState({ layout: { tree: [], bookmarks: [kx] } });
    render(<Sidebar />);
    fireEvent.contextMenu(within(screen.getByRole("region", { name: "Sessions" })).getByText("x"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename session…" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already exists");
    expect(useLayout.getState().layout.bookmarks).toEqual([kx]);
  });
  it("offers no Rename for a running session or the default one", () => {
    set([{ ...local, sessions: [
      { name: "x", running: true, status: "idle", error: null, workspaces: [] },
      { name: "default", running: false, status: "unknown", error: null, workspaces: [] },
    ] }]);
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByText("x"));
    expect(screen.queryByRole("menuitem", { name: "Rename session…" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.contextMenu(screen.getByText("default"));
    expect(screen.queryByRole("menuitem", { name: "Rename session…" })).toBeNull();
  });
  it("bookmarks a project from its row's menu, unbookmarks it from Bookmarks; a Session has no Bookmark item", () => {
    set([{ ...local, sessions: [{ name: "x", running: true, status: "working", error: null, workspaces: [
      { workspace_id: "w1", label: "app", number: 1, status: "working", tabs: [{ tab_id: "t", label: "1", number: 1, status: "working", panes: [
        { pane_id: "p", terminal_id: "t", title: "p", cwd: "/x", agent: "claude", status: "working" }] }] }] }] }]);
    render(<Sidebar />);
    fireEvent.contextMenu(screen.getByText("x"));
    expect(screen.queryByRole("menuitem", { name: "Bookmark" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.contextMenu(screen.getByRole("button", { name: "app" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Bookmark" }));
    expect(useLayout.getState().layout.bookmarks).toEqual([projectKey("local", "x", "app")]);
    fireEvent.contextMenu(within(screen.getByRole("region", { name: "Bookmarks" })).getByRole("button", { name: /^app/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unbookmark" }));
    expect(useLayout.getState().layout.bookmarks).toEqual([]);
    expect(screen.queryByRole("region", { name: "Bookmarks" })).toBeNull();
  });
  it("creates, renames, nests and deletes groups", async () => {
    set([local]);
    render(<Sidebar />);
    expect(screen.queryByRole("button", { name: "New group" })).toBeNull();
    fireEvent.contextMenu(screen.getByRole("region", { name: "Groups" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New group" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New group" }), { target: { value: " Work " } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByText("Work");
    fireEvent.contextMenu(screen.getByText("Work"));
    fireEvent.click(screen.getByRole("menuitem", { name: "New subgroup" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New subgroup" }), { target: { value: "Sub" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect((await screen.findByText("Sub")).closest("li.group")?.parentElement?.closest("li.group")?.textContent).toContain("Work");
    fireEvent.contextMenu(screen.getByText("Work"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Rename group" }), { target: { value: "Job" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await screen.findByText("Job");
    fireEvent.contextMenu(screen.getByText("Job"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete group" }));
    await waitFor(() => expect(screen.queryByText("Job")).toBeNull());
    expect(screen.getByText("Sub")).toBeTruthy();
  });
});
