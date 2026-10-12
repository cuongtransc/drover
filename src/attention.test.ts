import { describe, expect, it } from "vitest";
import { roleOfLabel, shouldAlert, type AlertRole, type AlertStatus, type Presence } from "./attention";

// ADR 0016 vector table, rows 1–13 (ct-workstation docs/decisions/0016-attention-reaches-the-user-once.md)
const VECTORS: [number, AlertRole, AlertStatus, Presence, boolean, boolean][] = [
  [1, "lane", "blocked", "desk", true, false],
  [2, "lane", "blocked", "away", true, true],
  [3, "lane", "done", "desk", false, false],
  [4, "lane", "done", "away", false, false],
  [5, "lane", "working", "away", false, false],
  [6, "other", "blocked", "desk", true, false],
  [7, "other", "blocked", "away", true, true],
  [8, "other", "done", "desk", true, false],
  [9, "other", "done", "away", true, true],
  [10, "other", "idle", "away", false, false],
  [11, "other", "unknown", "away", false, false],
  [12, "outside", "done", "desk", false, true],
  [13, "outside", "done", "away", false, true],
];

describe("shouldAlert", () => {
  it.each(VECTORS)("row %i: %s %s %s", (_n, role, status, presence, desk, telegram) => {
    expect(shouldAlert(role, status, presence)).toEqual({ desk, telegram });
  });
});

describe("roleOfLabel", () => {
  it("reads lane- as lane and everything else as other", () => {
    expect(roleOfLabel("lane-caps")).toBe("lane");
    expect(roleOfLabel("orch-drover")).toBe("other");
    expect(roleOfLabel("brief-1005-x")).toBe("other");
    expect(roleOfLabel("3")).toBe("other");
    expect(roleOfLabel(undefined)).toBe("other");
  });
});
