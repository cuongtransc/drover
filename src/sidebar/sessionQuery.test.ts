import { describe, expect, it } from "vitest";
import type { MachineView, PaneView, SessionView } from "../lib/types";
import type { RNode, RSession } from "./groups";
import { isIdleDefault, matchSession, queryResolved, queryWords } from "./sessionQuery";

const pane = (agent: string | null): PaneView => ({ pane_id: "p", terminal_id: "t", title: "zsh", cwd: "/x", agent, status: "idle" });
const ws = (id: string, label: string, agent: string | null = "claude") =>
  ({ workspace_id: id, label, number: 1, status: "idle" as const, tabs: [{ tab_id: id + ":t", label: "1", number: 1, status: "idle" as const, panes: [pane(agent)] }] });
const session = (name: string, workspaces = [ws("w1", "drover")], running = true): SessionView => ({ name, running, status: "idle", error: null, workspaces });
const dev = { id: "dev", label: "ct-dev", kind: "ssh", state: "connected", error: null, version: "0.9.3", status: "idle", sessions: [] } as MachineView;
const local = { ...dev, id: "local", label: "local", kind: "local" } as MachineView;

describe("queryWords", () => {
  it("splits on spaces, lower-cased, and drops empty words", () => {
    expect(queryWords("  XB  vault ")).toEqual(["xb", "vault"]);
    expect(queryWords("   ")).toEqual([]);
  });
});

describe("matchSession", () => {
  const s = session("dw-xb", [ws("w1", "xbit-vault-engine"), ws("w2", "notes")]);
  it("keeps the whole Session when the words find its name, its machine or one of its groups", () => {
    expect(matchSession(dev, s, [], ["xb"])).toBe("all");
    expect(matchSession(dev, s, [], ["ct-dev"])).toBe("all");
    expect(matchSession(dev, s, ["Work"], ["work"])).toBe("all");
  });
  it("keeps only the Workspaces the words find, a word on the Session counting for each", () => {
    expect(matchSession(dev, s, [], ["vault"])).toEqual(["w1"]);
    expect(matchSession(dev, s, [], ["dev", "notes"])).toEqual(["w2"]);
  });
  it("finds nothing when one word matches nowhere", () => {
    expect(matchSession(dev, s, [], ["xb", "bmf"])).toBeNull();
    expect(matchSession(local, s, [], ["ct-dev"])).toBeNull();
  });
  it("matches a substring, not a scattered subsequence", () => {
    expect(matchSession(dev, s, [], ["dxb"])).toBeNull();
  });
});

describe("queryResolved", () => {
  const n = (machine: MachineView, s: SessionView): RSession => ({ kind: "session", key: `${machine.id}/${s.name}`, machine, session: s });
  const a = n(dev, session("dw-xb", [ws("w1", "xbit-vault-engine")]));
  const b = n(local, session("w-wd", [ws("w2", "bmf-oms"), ws("w3", "xb-notes")]));
  const c = n(local, session("ca", [ws("w4", "ca-trader")]));
  const tree: RNode[] = [a, { kind: "group", id: "g", label: "Work", children: [b, { kind: "group", id: "e", label: "Empty", children: [c] }] }];

  it("keeps matching Sessions in order, drops emptied groups, and marks Workspace-only matches", () => {
    const r = queryResolved({ tree, bookmarks: [] }, ["xb"]);
    expect(r.tree).toEqual([a, { kind: "group", id: "g", label: "Work", children: [{ ...b, match: ["w3"] }] }]);
  });
  it("a group's label keeps every Session under it", () => {
    const r = queryResolved({ tree, bookmarks: [] }, ["work"]);
    expect(r.tree).toEqual([{ kind: "group", id: "g", label: "Work", children: [b, { kind: "group", id: "e", label: "Empty", children: [c] }] }]);
  });
  it("leaves Bookmarks whole", () => {
    expect(queryResolved({ tree, bookmarks: [] }, ["zzz"])).toEqual({ tree: [], bookmarks: [] });
  });
});

describe("isIdleDefault", () => {
  it("is herdr's default Session with no agent: stopped, empty or only shells", () => {
    expect(isIdleDefault(session("default", [], false))).toBe(true);
    expect(isIdleDefault(session("default", [ws("w1", "~", null)]))).toBe(true);
  });
  it("is not a default Session with an agent, nor any other Session", () => {
    expect(isIdleDefault(session("default", [ws("w1", "~", null), ws("w2", "x", "claude")]))).toBe(false);
    expect(isIdleDefault(session("w-xb", [], false))).toBe(false);
  });
});
