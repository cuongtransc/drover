import { beforeEach, describe, expect, it } from "vitest";
import type { MachineView, PaneView, WorkspaceView } from "../lib/types";
import { useApp } from "../store/app";
import { isProtected, loadMarks, protectedIn, pruneMarks, useProtect, watchProtectPrune } from "./protect";

const pane = (pane_id: string, title = pane_id, agent: string | null = "claude"): PaneView =>
  ({ pane_id, terminal_id: "t" + pane_id, title, cwd: null, agent, status: "idle" }) as PaneView;
const ws = (workspace_id: string, tabs: [string, PaneView[]][]): WorkspaceView => ({
  workspace_id, label: workspace_id, number: 1, status: "idle",
  tabs: tabs.map(([label, panes], i) => ({ tab_id: `${workspace_id}:t${i}`, label, number: i + 1, status: "idle", panes })),
});
const machine = (state: MachineView["state"], workspaces: WorkspaceView[], running = true): MachineView =>
  ({ id: "m", label: "m", kind: "local", state, error: null, version: null, status: "idle",
    sessions: [{ name: "s", running, status: "idle", error: null, workspaces }] }) as MachineView;

beforeEach(() => {
  localStorage.clear();
  useProtect.setState({ marks: {} });
});

describe("isProtected", () => {
  it("protects an orchestrator by default, any other pane only when marked, and honours an unmark", () => {
    expect(isProtected({}, "m/s/p1", true)).toBe(true);
    expect(isProtected({}, "m/s/p2", false)).toBe(false);
    expect(isProtected({ "m/s/p2": true }, "m/s/p2", false)).toBe(true);
    expect(isProtected({ "m/s/p1": false }, "m/s/p1", true)).toBe(false);
  });
});

describe("useProtect", () => {
  it("remembers a choice across a reload", () => {
    useProtect.getState().set("m/s/p2", true);
    useProtect.getState().set("m/s/p1", false);
    expect(loadMarks()).toEqual({ "m/s/p2": true, "m/s/p1": false });
  });

  it("reads a broken store as no marks", () => {
    localStorage.setItem("drover:protected", "{not json");
    expect(loadMarks()).toEqual({});
    localStorage.setItem("drover:protected", JSON.stringify({ "m/s/p1": "yes", "m/s/p2": true }));
    expect(loadMarks()).toEqual({ "m/s/p2": true });
  });
});

describe("protectedIn", () => {
  const w = ws("w1", [["orch-app", [pane("p1", "Main")]], ["2", [pane("p2", "Helper"), pane("p3", "Shell", null)]]]);

  it("lists the orchestrator of an orch- tab and the marked panes, in order", () => {
    expect(protectedIn("m", "s", [w], {}).map((p) => p.title)).toEqual(["Main"]);
    expect(protectedIn("m", "s", [w], { "m/s/p3": true }).map((p) => [p.key, p.title])).toEqual([["m/s/p1", "Main"], ["m/s/p3", "Shell"]]);
    expect(protectedIn("m", "s", [w], { "m/s/p1": false })).toEqual([]);
  });

  it("counts the inferred orchestrator of a workspace with lanes", () => {
    const lanes = ws("w2", [["1", [pane("q1", "Lead")]], ["lane-a", [pane("q2", "lane: a")]]]);
    expect(protectedIn("m", "s", [lanes], {}).map((p) => p.title)).toEqual(["Lead"]);
  });
});

describe("pruneMarks", () => {
  it("drops marks of panes gone from a connected machine's running session, and keeps the rest", () => {
    const marks = { "m/s/p1": true, "m/s/gone": true, "m/other/p9": true, "x/s/p1": true };
    expect(pruneMarks(marks, machine("connected", [ws("w1", [["1", [pane("p1")]]])]))).toEqual({ "m/s/p1": true, "m/other/p9": true, "x/s/p1": true });
  });

  it("keeps every mark while the machine is offline or the session is stopped", () => {
    const marks = { "m/s/gone": true };
    expect(pruneMarks(marks, machine("disconnected", []))).toBe(marks);
    expect(pruneMarks(marks, machine("connected", [], false))).toBe(marks);
  });
});

describe("watchProtectPrune", () => {
  it("drops a gone pane's mark when its machine's snapshot arrives, and stops when unsubscribed", () => {
    useProtect.getState().set("m/s/p1", true);
    useProtect.getState().set("m/s/gone", true);
    const stop = watchProtectPrune();
    useApp.setState({ machines: { m: machine("connected", [ws("w1", [["1", [pane("p1")]]])]) } });
    expect(useProtect.getState().marks).toEqual({ "m/s/p1": true });
    expect(loadMarks()).toEqual({ "m/s/p1": true });
    stop();
    useProtect.getState().set("m/s/later", true);
    useApp.setState({ machines: { m: machine("connected", [ws("w1", [["1", [pane("p2")]]])]) } });
    expect(useProtect.getState().marks["m/s/later"]).toBe(true);
  });
});
