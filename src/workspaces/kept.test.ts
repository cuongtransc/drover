import { describe, expect, it } from "vitest";
import { EMPTY_LAYOUT, LAYOUT_KEY, loadLayout, projectKey, setBookmarked, setKept } from "../sidebar/groups";
import type { MachineView, SessionView, WorkspaceView } from "../lib/types";
import { backfillKept, closedKept } from "./kept";

const ws = (id: string, label: string): WorkspaceView => ({
  workspace_id: id, label, number: 1, status: "idle",
  tabs: [{ tab_id: id + ":t", label: "1", number: 1, status: "idle", panes: [{ pane_id: id + ":p", terminal_id: "t", title: "zsh", cwd: "/c/" + label, agent: null, status: "idle" }] }],
});
const session = (name: string, running: boolean, ...w: WorkspaceView[]): SessionView => ({ name, running, loaded: running, status: "idle", error: null, workspaces: w });
const machine = (state: MachineView["state"], ...s: SessionView[]): MachineView => ({
  id: "local", label: "local", kind: "local", state, error: null, version: "0.9.3", status: "idle", sessions: s,
});
const k = (label: string, s = "ct") => projectKey("local", s, label);

describe("closedKept", () => {
  const layout = setKept(setKept(setKept(setKept(EMPTY_LAYOUT, k("zeta"), "/z"), k("agent"), null), k("infra"), "/i"), k("x", "other"), "/x");
  it("lists this Session's kept workspaces no live workspace carries, by label", () => {
    const s = session("ct", true, ws("w1", "infra"));
    expect(closedKept(layout, machine("connected", s), s)).toEqual([
      { key: k("agent"), label: "agent", folder: null },
      { key: k("zeta"), label: "zeta", folder: "/z" },
    ]);
  });
  it("ignores kept entries of a shape this build does not understand", () => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({
      tree: [], bookmarks: [],
      kept: { [k("agent")]: { folder: "/a" }, [k("odd")]: { folder: 3 }, [k("noFolder")]: { tint: "blue" }, [k("str")]: "no" },
    }));
    const loaded = loadLayout();
    const s = session("ct", true, ws("w1", "infra"));
    expect(closedKept(loaded, machine("connected", s), s).map((c) => c.label)).toEqual(["agent"]);
    localStorage.clear();
  });
  it("counts a label two live workspaces share as live", () => {
    const s = session("ct", true, ws("w1", "zeta"), ws("w2", "zeta"), ws("w3", "agent"));
    expect(closedKept(layout, machine("connected", s), s).map((c) => c.label)).toEqual(["infra"]);
  });
  it("lists nothing for a stopped Session or a Machine that is not connected", () => {
    const stopped = session("ct", false);
    expect(closedKept(layout, machine("connected", stopped), stopped)).toEqual([]);
    const s = session("ct", true);
    expect(closedKept(layout, machine("probing", s), s)).toEqual([]);
  });
  it("lists nothing for a running Session whose first view has not arrived (no workspaces yet)", () => {
    const s = { ...session("ct", true), loaded: false };
    expect(closedKept(layout, machine("connected", s), s)).toEqual([]);
  });
  it("lists every kept workspace of a running Session whose last workspace closed", () => {
    const s = session("ct", true);
    expect(closedKept(layout, machine("connected", s), s).map((c) => c.label)).toEqual(["agent", "infra", "zeta"]);
  });
  it("lists nothing for a Session with an error", () => {
    const s = { ...session("ct", true, ws("w1", "infra")), error: { code: "io", message: "boom" } };
    expect(closedKept(layout, machine("connected", s), s)).toEqual([]);
  });
  it("handles a malformed label defensively even without parsing", () => {
    const s = session("ct", true, ws("w1", "infra"));
    expect(closedKept({ ...EMPTY_LAYOUT, kept: { "local/ct/%": { folder: "/a" } } }, machine("connected", s), s)).toEqual([
      { key: "local/ct/%", label: "%", folder: "/a" },
    ]);
  });
  it("lists nothing without kept workspaces", () => {
    const s = session("ct", true, ws("w1", "infra"));
    expect(closedKept(EMPTY_LAYOUT, machine("connected", s), s)).toEqual([]);
  });
});

describe("backfillKept", () => {
  const folderOf = (_s: string, w: WorkspaceView) => "/c/" + w.label;
  it("keeps a live bookmarked workspace that is not kept yet, with its folder", () => {
    const layout = { ...EMPTY_LAYOUT, bookmarks: [k("infra"), k("gone")] };
    const m = machine("connected", session("ct", true, ws("w1", "infra")));
    expect(backfillKept(layout, m, folderOf).kept).toEqual({ [k("infra")]: { folder: "/c/infra" } });
  });
  it("backfills the first duplicate label's folder, not the second's", () => {
    const first = ws("w1", "infra");
    const second = ws("w2", "infra");
    first.tabs[0].panes[0].cwd = "/first";
    second.tabs[0].panes[0].cwd = "/second";
    const layout = { ...EMPTY_LAYOUT, bookmarks: [k("infra")] };
    expect(backfillKept(layout, machine("connected", session("ct", true, first, second)), (_s, w) => w.tabs[0].panes[0].cwd).kept).toEqual({
      [k("infra")]: { folder: "/first" },
    });
  });
  it("changes nothing when every live bookmark is kept, or the snapshot is not authoritative", () => {
    const kept = setBookmarked(EMPTY_LAYOUT, k("infra"), true, "/old");
    const m = machine("connected", session("ct", true, ws("w1", "infra")));
    expect(backfillKept(kept, m, folderOf)).toBe(kept);
    const bare = { ...EMPTY_LAYOUT, bookmarks: [k("infra")] };
    expect(backfillKept(bare, machine("error", session("ct", true, ws("w1", "infra"))), folderOf)).toBe(bare);
    expect(backfillKept(bare, machine("connected", session("ct", false, ws("w1", "infra"))), folderOf)).toBe(bare);
  });
});
