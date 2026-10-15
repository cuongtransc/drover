import { describe, expect, it, vi } from "vitest";
import type { MachineView, PaneView, SessionView } from "../lib/types";
import { filterResolved, isActiveSession, needYouCount } from "./activeFilter";
import type { RNode, RSession } from "./groups";

const pane = (id: string, status: PaneView["status"], agent: string | null = "claude"): PaneView => ({
  pane_id: id, terminal_id: "t" + id, title: id, cwd: "/x", agent, status,
});
const session = (name: string, panes: PaneView[], running = true): SessionView => ({
  name, running, loaded: running, status: "idle", error: null,
  workspaces: [{ workspace_id: "w1", label: "ws", number: 1, status: "idle", tabs: [{ tab_id: "w1:t1", label: "1", number: 1, status: "idle", panes }] }],
});
const machine = { id: "m", label: "m", kind: "local", state: "connected", error: null, version: "0.9.3", status: "idle", sessions: [] } as MachineView;

describe("isActiveSession", () => {
  it("keeps a running session with an agent waiting, working, or Done and unseen", () => {
    expect(isActiveSession(machine, session("a", [pane("p", "blocked")]), {})).toBe(true);
    expect(isActiveSession(machine, session("a", [pane("p", "working")]), {})).toBe(true);
    expect(isActiveSession(machine, session("a", [pane("p", "done")]), {})).toBe(true);
  });
  it("drops idle, seen-Done, shell-only and stopped sessions", () => {
    expect(isActiveSession(machine, session("a", [pane("p", "idle")]), {})).toBe(false);
    expect(isActiveSession(machine, session("a", [pane("p", "done")]), { "m/a/p": true })).toBe(false);
    expect(isActiveSession(machine, session("a", [pane("p", "blocked", null)]), {})).toBe(false);
    expect(isActiveSession(machine, session("a", [pane("p", "working")], false), {})).toBe(false);
    expect(isActiveSession({ ...machine, state: "error" }, session("a", [pane("p", "working")]), {})).toBe(false);
  });
});

describe("lanes", () => {
  const lanes = (status: PaneView["status"]): SessionView => ({
    ...session("a", []),
    workspaces: [{ workspace_id: "w1", label: "ws", number: 1, status: "idle", tabs: [{ tab_id: "t", label: "lane-x", number: 1, status: "idle", panes: [pane("p", status)] }] }],
  });
  it("counts a lane only while it works or waits, not its Done", () => {
    expect(isActiveSession(machine, lanes("done"), {})).toBe(false);
    expect(needYouCount(machine, lanes("done"), {})).toBe(0);
    expect(needYouCount(machine, lanes("blocked"), {})).toBe(1);
    expect(isActiveSession(machine, lanes("working"), {})).toBe(true);
  });
});

describe("filterResolved", () => {
  const s = (key: string): RSession => ({ kind: "session", key, machine, session: session(key, []) });
  const tree: RNode[] = [
    { kind: "group", id: "g", label: "G", children: [s("a"), { kind: "group", id: "e", label: "E", children: [s("b")] }] },
    s("c"),
  ];
  it("keeps the order, hides emptied groups and counts the hidden sessions", () => {
    const r = filterResolved({ tree, bookmarks: [] }, (s) => s.key === "a");
    expect(r.tree).toEqual([{ kind: "group", id: "g", label: "G", children: [s("a")] }]);
    expect(r.hidden).toBe(2);
  });
});

describe("useSessionFilter", () => {
  it("starts on Active unless the user chose All", async () => {
    vi.resetModules();
    localStorage.removeItem("drover:settings");
    expect((await import("./activeFilter")).useSessionFilter.getState().filter).toBe("active");
    vi.resetModules();
    localStorage.setItem("drover:settings", JSON.stringify({ sessionFilter: "all" }));
    expect((await import("./activeFilter")).useSessionFilter.getState().filter).toBe("all");
    localStorage.removeItem("drover:settings");
  });
});

describe("isActiveSession, recently active", () => {
  const MIN = 60_000;
  it("keeps a session whose agent changed within the Active window (1h by default)", () => {
    const s = session("a", [pane("p", "idle")]);
    expect(isActiveSession(machine, s, {}, { "m/a/p": 100 * MIN - 5 * MIN }, 100 * MIN)).toBe(true);
    expect(isActiveSession(machine, s, {}, { "m/a/p": 100 * MIN - 59 * MIN }, 100 * MIN)).toBe(true);
    expect(isActiveSession(machine, s, {}, { "m/a/p": 100 * MIN - 61 * MIN }, 100 * MIN)).toBe(false);
    expect(isActiveSession(machine, s, {}, { "m/a/p": 100 * MIN - 20 * MIN }, 100 * MIN, 15 * MIN)).toBe(false);
    expect(isActiveSession(machine, s, {}, {}, 100 * MIN)).toBe(false);
  });
});

describe("filterResolved, keepGroups", () => {
  const s = (key: string): RSession => ({ kind: "session", key, machine, session: session(key, []) });
  it("keeps every group, emptied or empty, as All shows them", () => {
    const tree: RNode[] = [{ kind: "group", id: "g", label: "G", children: [s("a")] }, { kind: "group", id: "e", label: "E", children: [] }];
    const r = filterResolved({ tree, bookmarks: [] }, () => false, true);
    expect(r.tree).toEqual([{ kind: "group", id: "g", label: "G", children: [] }, { kind: "group", id: "e", label: "E", children: [] }]);
  });
});
