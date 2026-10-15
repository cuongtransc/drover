import { describe, expect, it } from "vitest";
import type { MachineView, PaneView, SessionView, TabView, WorkspaceView } from "../lib/types";
import { sessionProjects } from "./projects";

let n = 0;
const pane = (status: PaneView["status"], agent: string | null = "claude"): PaneView => {
  const id = "p" + ++n;
  return { pane_id: id, terminal_id: "t" + id, title: id, cwd: "/x", agent, status };
};
const tab = (label: string, p: PaneView): TabView => ({ tab_id: label, label, number: 1, status: "idle", panes: [p] });
const ws = (label: string, tabs: TabView[]): WorkspaceView => ({ workspace_id: label, label, number: 1, status: "idle", tabs });
const session = (workspaces: WorkspaceView[], running = true): SessionView => ({ name: "s", running, loaded: running, status: "idle", error: null, workspaces });
const machine = { id: "m", label: "m", kind: "local", state: "connected", error: null, version: "0.9.3", status: "idle", sessions: [] } as MachineView;
const ref = (p: PaneView) => ({ machine_id: "m", session: "s", pane_id: p.pane_id });

describe("sessionProjects", () => {
  it("lists the workspaces with agent work, in their order, by what they need from the user", () => {
    const orch = pane("working");
    const asking = pane("blocked");
    const finished = pane("done");
    const s = session([
      ws("drover", [tab("orch-ux", orch), tab("lane-a", pane("working")), tab("lane-b", pane("done"))]),
      ws("ccpoke", [tab("1", asking)]),
      ws("history", [tab("main", finished)]),
      ws("journal", [tab("1", pane("idle"))]),
      ws("shells", [tab("1", pane("unknown", null))]),
    ]);
    expect(sessionProjects(machine, s, {}, false)).toEqual([
      { id: "drover", label: "drover", state: "working", lanes: 2, target: ref(orch) },
      { id: "ccpoke", label: "ccpoke", state: "blocked", lanes: 0, target: ref(asking) },
      { id: "history", label: "history", state: "review", lanes: 0, target: ref(finished) },
    ]);
  });

  it("puts Blocked before Review before In progress, and opens the pane behind it", () => {
    const orch = pane("done");
    const lane = pane("blocked");
    const s = session([ws("w", [tab("orch-x", orch), tab("lane-y", lane), tab("lane-z", pane("working"))])]);
    expect(sessionProjects(machine, s, {}, false)[0]).toMatchObject({ state: "blocked", target: ref(lane) });
    const seen = session([ws("w", [tab("orch-x", orch), tab("lane-z", pane("working"))])]);
    expect(sessionProjects(machine, seen, {}, false)[0]).toMatchObject({ state: "review", target: ref(orch) });
  });

  it("leaves a lane's Done and a seen Done to the orchestrator: no Review for them", () => {
    const orch = pane("idle");
    const s = session([ws("w", [tab("orch-x", orch), tab("lane-y", pane("done"))])]);
    expect(sessionProjects(machine, s, {}, false)).toEqual([]);
    const done = pane("done");
    const seen = session([ws("w", [tab("1", done)])]);
    expect(sessionProjects(machine, seen, { ["m/s/" + done.pane_id]: true }, false)).toEqual([]);
  });

  it("excludes a lane-only workspace with unseen Done from review and Active", () => {
    const done = pane("done");
    const s = session([ws("lane-only", [tab("lane-caps", done)])]);
    expect(sessionProjects(machine, s, {}, false)).toEqual([]);
    expect(sessionProjects(machine, s, {}, true)).toEqual([
      { id: "lane-only", label: "lane-only", state: "quiet", lanes: 0, target: ref(done) },
    ]);
  });

  it("lists every workspace under All, the quiet ones too, opening the orchestrator or the first pane", () => {
    const idle = pane("idle");
    const sh = pane("unknown", null);
    const s = session([ws("journal", [tab("1", idle)]), ws("shells", [tab("1", sh)])]);
    expect(sessionProjects(machine, s, {}, true)).toEqual([
      { id: "journal", label: "journal", state: "quiet", lanes: 0, target: ref(idle) },
      { id: "shells", label: "shells", state: "quiet", lanes: 0, target: ref(sh) },
    ]);
  });

  it("lists nothing for a stopped session or a machine that is not connected", () => {
    const s = session([ws("w", [tab("1", pane("working"))])], false);
    expect(sessionProjects(machine, s, {}, true)).toEqual([]);
    expect(sessionProjects({ ...machine, state: "error" }, session([ws("w", [tab("1", pane("working"))])]), {}, true)).toEqual([]);
  });
});

describe("sessionProjects, recently active", () => {
  const MIN = 60_000;
  const now = 100 * MIN;
  it("keeps a project whose agent went idle or was seen Done within the Active window (1h by default), with its age", () => {
    const idle = pane("idle");
    const seen = pane("done");
    const old = pane("idle");
    const s = session([ws("a", [tab("1", idle)]), ws("b", [tab("1", seen)]), ws("c", [tab("1", old)])]);
    const since = { ["m/s/" + idle.pane_id]: now - 12 * MIN, ["m/s/" + seen.pane_id]: now - 2 * MIN, ["m/s/" + old.pane_id]: now - 61 * MIN };
    expect(sessionProjects(machine, s, { ["m/s/" + seen.pane_id]: true }, false, since, now)).toEqual([
      { id: "a", label: "a", state: "recent", lanes: 0, target: ref(idle), idleFor: 12 * MIN },
      { id: "b", label: "b", state: "recent", lanes: 0, target: ref(seen), idleFor: 2 * MIN },
    ]);
    // A 10-minute window keeps only the one Done 2 minutes ago.
    expect(sessionProjects(machine, s, { ["m/s/" + seen.pane_id]: true }, false, since, now, 10 * MIN).map((r) => r.id)).toEqual(["b"]);
  });
  it("does not count a recently Done lane in a lane-only workspace as Active", () => {
    const done = pane("done");
    const s = session([ws("lane-only", [tab("lane-caps", done)])]);
    expect(sessionProjects(machine, s, {}, false, { ["m/s/" + done.pane_id]: now - MIN }, now)).toEqual([]);
  });
  it("does not keep a project for its lane going idle", () => {
    const orch = pane("idle");
    const lane = pane("done");
    const s = session([ws("w", [tab("orch-x", orch), tab("lane-y", lane)])]);
    expect(sessionProjects(machine, s, {}, false, { ["m/s/" + lane.pane_id]: now - MIN }, now)).toEqual([]);
  });
});
