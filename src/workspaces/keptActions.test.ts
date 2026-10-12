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
