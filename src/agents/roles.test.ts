import { describe, expect, it } from "vitest";
import type { PaneView } from "../lib/types";
import { laneTitle, paneRoles, sessionRoles, tabRole, type LaneRecord } from "./roles";

const p = (agent: string | null): PaneView => ({ pane_id: "x", terminal_id: "t", title: "x", cwd: null, agent, status: "idle" });

describe("roles", () => {
  it("reads a tab's role from its label", () => {
    expect([tabRole("orch-drover"), tabRole("lane-caps"), tabRole("brief-pricing"), tabRole("1"), tabRole("main-orches")]).toEqual([
      "orch", "lane", "brief", null, null,
    ]);
  });
  it("puts lanes under the orch- tab's agent", () => {
    expect(paneRoles([{ tabLabel: "1", pane: p("claude") }, { tabLabel: "orch-x", pane: p("claude") }, { tabLabel: "lane-a", pane: p("pi") }])).toEqual([
      null, "orch", "lane",
    ]);
  });
  it("takes the first agent outside lanes and briefs when no tab is named orch-", () => {
    expect(paneRoles([{ tabLabel: "1", pane: p(null) }, { tabLabel: "brief-q", pane: p("claude") }, { tabLabel: "main-orches", pane: p("claude") }, { tabLabel: "lane-a", pane: p("pi") }])).toEqual([
      null, null, "orch", "lane",
    ]);
  });
  it("leaves lanes ordinary panes without an orchestrator, and a workspace without lanes alone", () => {
    expect(paneRoles([{ tabLabel: "lane-a", pane: p("pi") }, { tabLabel: "1", pane: p(null) }])).toEqual([null, null]);
    expect(paneRoles([{ tabLabel: "orch-x", pane: p("claude") }])).toEqual([null]);
  });
  it("drops the lane prefix from a title", () => {
    expect(laneTitle("π - lane: caps — Wave 2")).toBe("caps — Wave 2");
    expect(laneTitle("lane: ipscope — Wave 2")).toBe("ipscope — Wave 2");
    expect(laneTitle("brief: pricing — fee model")).toBe("pricing — fee model");
    expect(laneTitle("Orchestrator")).toBe("Orchestrator");
  });
});

describe("sessionRoles: a lane folds under the pane that owns it (ctc lane list)", () => {
  const pane = (id: string, agent: string | null = "claude"): PaneView => ({ pane_id: id, terminal_id: "t" + id, title: id, cwd: null, agent, status: "idle" });
  const lane = (pane_id: string, owner: string | null): LaneRecord => ({ lane_id: "lane-" + pane_id, herdr_session: "s", pane_id, owner });
  // The bug's shape: an orch- tab and a plain "claude" tab in one workspace; the lanes are the claude tab's.
  const ws1 = [
    { tabLabel: "orch-xbit-vault-engine", pane: pane("w1:tP") },
    { tabLabel: "claude", pane: pane("w1:p8") },
    { tabLabel: "lane-a", pane: pane("w1:pA", "pi") },
    { tabLabel: "lane-b", pane: pane("w1:pB", "pi") },
  ];

  it("puts each lane under the pane in its owner, not under the workspace's orch- tab", () => {
    const roles = sessionRoles("s", [ws1], [lane("w1:pA", "s/w1:p8"), lane("w1:pB", "s/w1:p8")]);
    expect(roles).toEqual([[
      { role: null },
      { role: "orch" },
      { role: "lane", owner: "w1:p8" },
      { role: "lane", owner: "w1:p8" },
    ]]);
  });

  it("folds a lane under its owner in another workspace of the session", () => {
    const ws2 = [{ tabLabel: "orch-y", pane: pane("w2:p1") }];
    expect(sessionRoles("s", [ws1, ws2], [lane("w1:pA", "s/w2:p1")])[0][2]).toEqual({ role: "lane", owner: "w2:p1" });
  });

  it("marks a lane orphan when its owner is unknown (null)", () => {
    expect(sessionRoles("s", [ws1], [lane("w1:pA", null)])[0][2]).toEqual({ role: "lane", orphan: true });
  });

  it("marks a lane orphan when its owner pane is gone, or in another session", () => {
    const roles = sessionRoles("s", [ws1], [lane("w1:pA", "s/w1:gone"), lane("w1:pB", "other/w1:p8")]);
    expect(roles[0][2]).toEqual({ role: "lane", orphan: true });
    expect(roles[0][3]).toEqual({ role: "lane", orphan: true });
    // Nothing owns a live lane, so no pane is an orchestrator.
    expect(roles[0][1]).toEqual({ role: null });
  });

  it("marks a lane orphan when the store has no record of it", () => {
    expect(sessionRoles("s", [ws1], [lane("w1:pB", "s/w1:p8")])[0][2]).toEqual({ role: "lane", orphan: true });
  });

  it("never nests: a lane owned by another lane is an orphan", () => {
    expect(sessionRoles("s", [ws1], [lane("w1:pA", "s/w1:pB"), lane("w1:pB", "s/w1:p8")])[0][2]).toEqual({ role: "lane", orphan: true });
  });

  it("falls back to folding by workspace when ctc gave no owners", () => {
    expect(sessionRoles("s", [ws1], null)).toEqual([[
      { role: "orch" },
      { role: null },
      { role: "lane", owner: "w1:tP" },
      { role: "lane", owner: "w1:tP" },
    ]]);
  });
});
