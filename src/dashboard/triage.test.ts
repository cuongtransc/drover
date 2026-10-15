import { describe, expect, it } from "vitest";
import type { MachineView, PaneView } from "../lib/types";
import { stepTriage, triageQueue } from "./triage";

const pane = (id: string, status: PaneView["status"], agent: string | null = "claude"): PaneView => ({
  pane_id: id, terminal_id: "t" + id, title: "pane " + id, cwd: "/x", agent, status,
});
const machine = (id: string, panes: PaneView[], over: Partial<MachineView> = {}): MachineView => ({
  id, label: id, kind: "local", state: "connected", error: null, version: "0.9.3", status: "idle",
  sessions: [{ name: "s", running: true, loaded: true, status: "idle", error: null, workspaces: [
    { workspace_id: "w1", label: "ws", number: 1, status: "idle", tabs: [
      { tab_id: "w1:t1", label: "1", number: 1, status: "idle", panes } ] } ] }],
  ...over,
});
const key = (m: string, p: string) => `${m}/s/${p}`;

describe("triageQueue", () => {
  it("puts waiting panes first, longest waiting first, then unseen Done panes, oldest first", () => {
    const machines = {
      a: machine("a", [pane("b1", "blocked"), pane("d1", "done"), pane("w", "working"), pane("b2", "blocked")]),
      z: machine("z", [pane("b3", "blocked"), pane("d2", "done"), pane("d3", "done"), pane("sh", "blocked", null)]),
    };
    const since = { [key("a", "b1")]: 300, [key("a", "b2")]: 100, [key("a", "d1")]: 500, [key("z", "d2")]: 200 };
    const seen = { [key("z", "d3")]: true as const };
    expect(triageQueue(machines, ["a", "z"], seen, since).map((c) => c.key)).toEqual([
      key("a", "b2"), key("a", "b1"), key("z", "b3"), // no time: after the timed ones
      key("z", "d2"), key("a", "d1"),
    ]);
  });

  it("leaves a lane's Done to its orchestrator but keeps a lane that waits", () => {
    const m = machine("a", []);
    m.sessions[0].workspaces[0].tabs = [
      { tab_id: "t1", label: "lane-caps", number: 1, status: "idle", panes: [pane("ld", "done"), pane("lb", "blocked")] },
      { tab_id: "t2", label: "1", number: 2, status: "idle", panes: [pane("d", "done")] },
    ];
    expect(triageQueue({ a: m }, ["a"], {}, {}).map((c) => c.key)).toEqual([key("a", "lb"), key("a", "d")]);
  });

  it("is empty when nothing waits", () => {
    expect(triageQueue({ a: machine("a", [pane("w", "working")]) }, ["a"], {}, {})).toEqual([]);
  });
});

describe("stepTriage", () => {
  const q = ["p1", "p2", "p3"];
  it("moves from the selected pane and wraps both ways", () => {
    expect(stepTriage(q, "p1", 0, 1)).toBe(1);
    expect(stepTriage(q, "p3", 2, 1)).toBe(0);
    expect(stepTriage(q, "p1", 0, -1)).toBe(2);
  });
  it("goes on from the last step when the selected pane left the queue", () => {
    // p2 was a Done pane: selecting it marked it seen, so it is gone and p3 slid into its place.
    expect(stepTriage(["p1", "p3"], "p2", 1, 1)).toBe(1);
    expect(stepTriage(["p1", "p3"], "p2", 1, -1)).toBe(0);
    expect(stepTriage(["p1"], "p9", 4, 1)).toBe(0);
  });
  it("starts at the head with nothing selected and has nowhere to go when empty", () => {
    expect(stepTriage(q, null, -1, 1)).toBe(0);
    expect(stepTriage(q, null, -1, -1)).toBe(2);
    expect(stepTriage([], "p1", 0, 1)).toBe(-1);
  });
});
