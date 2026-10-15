import { describe, expect, it } from "vitest";
import type { MachineView } from "../lib/types";
import type { RGroup, RNode, RSession } from "./groups";
import { foldStopped } from "./stoppedFold";

const machine = (state: MachineView["state"] = "connected") => ({ id: "box", state } as MachineView);
const s = (name: string, running: boolean, m = machine()): RSession =>
  ({ kind: "session", key: `box/${name}`, machine: m, session: { name, running, loaded: running, status: "idle", error: null, workspaces: [] } });
const g = (id: string): RGroup => ({ kind: "group", id, label: id, children: [] });
const names = (nodes: RNode[]) => nodes.map((n) => (n.kind === "group" ? `[${n.id}]` : n.session.name));

describe("foldStopped", () => {
  it("folds two or more stopped sessions, keeping the rest in order", () => {
    const r = foldStopped([s("a", true), s("x", false), g("g1"), s("b", true), s("y", false)], null);
    expect(names(r.nodes)).toEqual(["a", "[g1]", "b"]);
    expect(names(r.folded)).toEqual(["x", "y"]);
  });

  it("moves a lone stopped session to the end instead of folding it", () => {
    const r = foldStopped([s("x", false), s("a", true), g("g1")], null);
    expect(names(r.nodes)).toEqual(["a", "[g1]", "x"]);
    expect(r.folded).toEqual([]);
  });

  it("leaves the viewed session where it is", () => {
    const r = foldStopped([s("a", true), s("x", false), s("y", false), s("z", false)], "box/x");
    expect(names(r.nodes)).toEqual(["a", "x"]);
    expect(names(r.folded)).toEqual(["y", "z"]);
  });

  it("counts a session of a machine that is not connected as not stopped", () => {
    const off = machine("disconnected");
    const r = foldStopped([s("x", false, off), s("y", false, off), s("a", true)], null);
    expect(names(r.nodes)).toEqual(["x", "y", "a"]);
    expect(r.folded).toEqual([]);
  });

  it("returns the same array when nothing is stopped", () => {
    const nodes = [s("a", true), g("g1")];
    expect(foldStopped(nodes, null).nodes).toBe(nodes);
  });
});
