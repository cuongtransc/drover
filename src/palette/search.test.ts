import { describe, expect, it } from "vitest";
import { search } from "./search";
import type { MachineView } from "../lib/types";

const pane = (id: string, title: string, agent: string | null, status: any, cwd = "/x") => ({ pane_id: id, terminal_id: "t" + id, title, cwd, agent, status });
const m: MachineView = { id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "blocked", sessions: [
  { name: "default", running: true, status: "blocked", error: null, workspaces: [
    { workspace_id: "w1", label: "drover", number: 1, status: "blocked", tabs: [{ tab_id: "w1:t1", label: "1", number: 1, status: "blocked", panes: [
      pane("w1:p1", "Rewrite UI", "claude", "working"), pane("w1:p2", "review", "pi", "blocked", "/srv/api") ] }] } ] } ] };

describe("palette search", () => {
  it("matches title, agent, cwd and workspace", () => {
    expect(search([m], "rwui").map(h => h.ref.pane_id)).toEqual(["w1:p1"]);
    expect(search([m], "pi").map(h => h.ref.pane_id)).toContain("w1:p2");
    expect(search([m], "srv/api").map(h => h.ref.pane_id)).toEqual(["w1:p2"]);
    expect(search([m], "drover")).toHaveLength(2);
  });
  it("matches what a shell is doing", () => {
    const shell = { ...pane("w1:p3", "dev", null, "idle"), activity: "pnpm vite --port 1441" };
    const box: MachineView = structuredClone(m);
    box.sessions[0].workspaces[0].tabs[0].panes.push(shell);
    const hits = search([box], "vite");
    expect(hits.map((h) => h.ref.pane_id)).toEqual(["w1:p3"]);
    expect(hits[0].activity).toBe("pnpm vite --port 1441");
  });
  it("ranks blocked panes first and builds subtitles", () => {
    const hits = search([m], "");
    expect(hits[0].ref.pane_id).toBe("w1:p2");
    expect(hits[0].subtitle).toBe("local › default › drover");
  });

  describe("ranking", () => {
    const session = (name: string, panes: ReturnType<typeof pane>[], ws = "app") => ({
      name, running: true, status: "idle" as const, error: null,
      workspaces: [{ workspace_id: name + ":w1", label: ws, number: 1, status: "idle" as const, tabs: [{ tab_id: name + ":t1", label: "1", number: 1, status: "idle" as const, panes }] }],
    });
    const box = (sessions: ReturnType<typeof session>[]): MachineView => ({
      id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "idle", sessions,
    });
    const ids = (q: string, ms: MachineView[]) => search(ms, q).map((h) => h.ref.pane_id);

    it("finds a session by its name before panes that only match scattered letters", () => {
      // The user's case: "ca-mono" listed rd-mono first, its cwd holding c, a and "-mono" in order.
      const ms = [box([
        session("rd-mono", [pane("rd", "Refactor docs", "claude", "blocked", "/Users/connor/Dev/rd-mono")]),
        session("ca-mono", [pane("ca", "Fix login", "claude", "idle", "/Users/connor/Dev/ca-mono")]),
      ])];
      expect(ids("ca-mono", ms)[0]).toBe("ca");
      expect(ids("ca", ms)[0]).toBe("ca");
    });

    it("ranks an exact match over a prefix, a word start, a substring and scattered letters", () => {
      const ms = [box([session("s", [
        pane("scattered", "parse error handling", "claude", "idle"),
        pane("substring", "reparser", "claude", "idle"),
        pane("word", "new parser", "claude", "idle"),
        pane("prefix", "parser rewrite", "claude", "idle"),
        pane("exact", "parser", "claude", "idle"),
      ])])];
      expect(ids("parser", ms)).toEqual(["exact", "prefix", "word", "substring", "scattered"]);
    });

    it("keeps a waiting pane first only between equally good matches", () => {
      const ms = [box([session("s", [
        pane("fuzzy-waiting", "p a r s e r s", "claude", "blocked"),
        pane("exact", "parser", "claude", "idle"),
        pane("exact-waiting", "parser", "codex", "blocked"),
      ])])];
      expect(ids("parser", ms)).toEqual(["exact-waiting", "exact", "fuzzy-waiting"]);
    });

    it("needs every word of the query, each matching somewhere", () => {
      const ms = [box([
        session("ca-mono", [pane("a", "Fix login", "claude", "idle"), pane("b", "Fix login", "pi", "idle")]),
        session("rd-mono", [pane("c", "Fix login", "claude", "idle")]),
      ])];
      expect(ids("ca pi", ms)).toEqual(["b"]);
      expect(ids("mono claude", ms).sort()).toEqual(["a", "c"]);
    });

    it("prefers a match in a name over one in a path", () => {
      const ms = [box([
        session("s1", [pane("path", "Deploy", "claude", "idle", "/srv/billing")]),
        session("s2", [pane("title", "billing report", "claude", "idle")]),
      ])];
      expect(ids("billing", ms)).toEqual(["title", "path"]);
    });
  });
});
