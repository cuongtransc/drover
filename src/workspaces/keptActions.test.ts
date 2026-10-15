import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({ herdrCall: vi.fn() }));
import { herdrCall } from "../lib/ipc";
import { EMPTY_LAYOUT, projectKey, setKept, useLayout } from "../sidebar/groups";
import { useApp } from "../store/app";
import { getFolder } from "./folder";
import type { MachineView, SessionView } from "../lib/types";
import { isReopenPending, reopenKept, resetReopenPending, saveWorkspaceFolder } from "./keptActions";

const key = projectKey("local", "ct", "infra");
beforeEach(() => {
  resetReopenPending();
  vi.mocked(herdrCall).mockReset();
  localStorage.clear();
  useLayout.setState({ layout: setKept(EMPTY_LAYOUT, key, "/c/infra") });
  useApp.setState({ selected: null, machines: {}, order: [] });
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

describe("reopenKept pending", () => {
  const created = { workspace: { workspace_id: "w7" }, root_pane: { pane_id: "p7" } };
  const closed = { key, label: "infra", folder: "/c/infra" };
  const view = (...labels: string[]): MachineView => {
    const s: SessionView = {
      name: "ct", running: true, loaded: true, status: "idle", error: null,
      workspaces: labels.map((label, i) => ({ workspace_id: "w" + i, label, number: i + 1, status: "idle", tabs: [] })),
    };
    return { id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "idle", sessions: [s] };
  };
  afterEach(() => vi.useRealTimers());

  it("stays pending after create resolves until a snapshot lists the label, so a second click makes no second create", async () => {
    vi.mocked(herdrCall).mockResolvedValue(created);
    await reopenKept("local", "ct", closed);
    expect(isReopenPending(key)).toBe(true);
    await reopenKept("local", "ct", closed);
    expect(herdrCall).toHaveBeenCalledTimes(1);
  });
  it("is no longer pending once a snapshot lists a workspace with that label", async () => {
    vi.mocked(herdrCall).mockResolvedValue(created);
    await reopenKept("local", "ct", closed);
    useApp.setState({ machines: { local: view("web") } });
    expect(isReopenPending(key)).toBe(true);
    useApp.setState({ machines: { local: view("web", "infra") } });
    expect(isReopenPending(key)).toBe(false);
  });
  it("is not pending when the snapshot already lists it as create resolves", async () => {
    useApp.setState({ machines: { local: view("infra") } });
    vi.mocked(herdrCall).mockResolvedValue(created);
    await reopenKept("local", "ct", closed);
    expect(isReopenPending(key)).toBe(false);
  });
  it("expires after 10 s so a lost snapshot cannot lock the row", async () => {
    vi.useFakeTimers();
    vi.mocked(herdrCall).mockResolvedValue(created);
    await reopenKept("local", "ct", closed);
    vi.advanceTimersByTime(9_999);
    expect(isReopenPending(key)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(isReopenPending(key)).toBe(false);
  });
  it("allows a retry right after a failure", async () => {
    vi.mocked(herdrCall).mockRejectedValueOnce({ message: "no such directory" }).mockResolvedValue(created);
    await expect(reopenKept("local", "ct", closed)).rejects.toBeDefined();
    expect(isReopenPending(key)).toBe(false);
    await reopenKept("local", "ct", closed);
    expect(herdrCall).toHaveBeenCalledTimes(2);
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
