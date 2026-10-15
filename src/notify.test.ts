import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./lib/ipc", () => ({ notifyPane: vi.fn().mockResolvedValue(undefined) }));
import { notifyPane } from "./lib/ipc";
import type { MachineView } from "./lib/types";
import { notifyPaneStatus, setNotificationsEnabled, shouldNotify, statusTitle } from "./notify";

const ref = { machine_id: "local", session: "default", pane_id: "w1:p1" };
const ev = (status: any, previous: any) => ({ pane: ref, status, previous, title: "Rewrite" });

describe("shouldNotify", () => {
  it("notifies on blocked/done for other panes", () => {
    expect(shouldNotify(ev("blocked", "working"), null, true, "other", true)).toBe(true);
    expect(shouldNotify(ev("done", "working"), { ...ref, pane_id: "w2:p1" }, true, "other", true)).toBe(true);
  });
  it("tells the user a lane is blocked but not that it is done", () => {
    expect(shouldNotify(ev("blocked", "working"), null, true, "lane", true)).toBe(true);
    expect(shouldNotify(ev("done", "working"), null, true, "lane", true)).toBe(false);
  });
  it("notifies for the selected pane while the window is unfocused", () => {
    expect(shouldNotify(ev("blocked", "working"), ref, true, "other", false)).toBe(true);
    expect(shouldNotify(ev("done", "working"), ref, true, "other", false)).toBe(true);
  });
  it("stays quiet otherwise", () => {
    expect(shouldNotify(ev("working", "idle"), null, true, "other", true)).toBe(false);
    expect(shouldNotify(ev("blocked", "working"), ref, true, "other", true)).toBe(false);
    expect(shouldNotify(ev("blocked", "working"), null, false, "other", true)).toBe(false);
    expect(shouldNotify(ev("done", "done"), null, true, "other", true)).toBe(false);
  });
});

describe("notifyPaneStatus", () => {
  const machines = (label: string): Record<string, MachineView> => ({
    local: {
      id: "local", label: "My Mac", kind: "local", state: "connected", error: null, version: "0.9.3", status: "done",
      sessions: [{ name: "default", running: true, loaded: true, status: "done", error: null, workspaces: [
        { workspace_id: "w1", label: "work", number: 1, status: "done", tabs: [
          { tab_id: "w1:t1", label, number: 1, status: "done", panes: [
            { pane_id: ref.pane_id, terminal_id: "t1", title: "Rewrite", cwd: "/x", agent: "claude", status: "done" },
          ] },
        ] },
      ] }],
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setNotificationsEnabled(true);
  });

  it("sends Blocked as other when the snapshot is missing, falling back to the event title", async () => {
    await notifyPaneStatus(ev("blocked", "working"), null, {});
    expect(notifyPane).toHaveBeenCalledTimes(1);
    expect(notifyPane).toHaveBeenCalledWith(ref, "Rewrite — Blocked", "local › default › Rewrite");
  });

  it("notifies for the selected pane when the window loses focus", async () => {
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    try {
      await notifyPaneStatus(ev("blocked", "working"), ref, machines("1"));
      expect(notifyPane).toHaveBeenCalledTimes(1);
    } finally {
      focus.mockRestore();
    }
  });

  it("does not send Done when the snapshot cannot identify the tab role", async () => {
    await notifyPaneStatus(ev("done", "working"), null, {});
    expect(notifyPane).not.toHaveBeenCalled();
  });

  it("does not send a lane tab's Done", async () => {
    await notifyPaneStatus(ev("done", "working"), null, machines("lane-caps"));
    expect(notifyPane).not.toHaveBeenCalled();
  });

  it("sends a non-lane tab's Done with the agent and Review title", async () => {
    await notifyPaneStatus(ev("done", "working"), null, machines("1"));
    expect(notifyPane).toHaveBeenCalledTimes(1);
    expect(notifyPane).toHaveBeenCalledWith(ref, "claude — Review", "My Mac › default › Rewrite");
  });
});

describe("statusTitle", () => {
  it("uses the user's words", () => {
    expect(statusTitle("blocked")).toBe("Blocked");
    expect(statusTitle("done")).toBe("Review");
  });
});
