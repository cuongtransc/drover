import { describe, expect, it } from "vitest";
import {
  EMPTY_LAYOUT, addGroup, canMove, deleteGroup, forgetKept, forgetMachine, forgetSessions, groupPaths, moveBookmark,
  moveNode, projectKey, renameGroup, renameProjectKey, renameSessionKey, sessionKey, setBookmarked, setKept,
} from "./groups";
import type { GroupNode, Layout, LayoutNode, SessionNode } from "./groups";

const s = (key: string): SessionNode => ({ kind: "session", key });
const g = (id: string, ...children: LayoutNode[]): GroupNode => ({ kind: "group", id, label: id.toUpperCase(), children });
const L = (...tree: LayoutNode[]): Layout => ({ tree, bookmarks: [] });
const shape = (nodes: LayoutNode[]): unknown[] => nodes.map((n) => (n.kind === "group" ? { [n.id]: shape(n.children) } : n.key));
const S = (key: string) => ({ kind: "session" as const, key });
const G = (id: string) => ({ kind: "group" as const, id });

describe("sessionKey", () => {
  it("encodes both parts", () => {
    expect(sessionKey("local", "default")).toBe("local/default");
    expect(sessionKey("a/b", "x y")).toBe("a%2Fb/x%20y");
  });
});

describe("projectKey", () => {
  it("names a project by its Session's key and its Workspace's label, encoded", () => {
    expect(projectKey("local", "ai-tools", "drover")).toBe("local/ai-tools/drover");
    expect(projectKey("a/b", "x y", "w/1")).toBe("a%2Fb/x%20y/w%2F1");
  });
});

describe("moveNode", () => {
  it("appends into a group and into the root", () => {
    const l = L(g("a", s("x")), s("y"));
    expect(shape(moveNode(l, S("y"), { kind: "into", groupId: "a" }).tree)).toEqual([{ a: ["x", "y"] }]);
    expect(shape(moveNode(l, S("x"), { kind: "into", groupId: null }).tree)).toEqual([{ a: [] }, "y", "x"]);
  });
  it("inserts as first child with first", () => {
    const l = L(g("a", s("x")), s("y"));
    expect(shape(moveNode(l, S("y"), { kind: "into", groupId: "a", first: true }).tree)).toEqual([{ a: ["y", "x"] }]);
  });
  it("moves before and after a row in another parent", () => {
    const l = L(g("a", s("x")), s("y"));
    expect(shape(moveNode(l, S("y"), { kind: "before", ref: S("x") }).tree)).toEqual([{ a: ["y", "x"] }]);
    expect(shape(moveNode(l, S("y"), { kind: "after", ref: S("x") }).tree)).toEqual([{ a: ["x", "y"] }]);
  });
  it("accounts for the index shift inside the same parent", () => {
    const l = L(s("x"), s("y"), s("z"));
    expect(shape(moveNode(l, S("x"), { kind: "after", ref: S("y") }).tree)).toEqual(["y", "x", "z"]);
    expect(shape(moveNode(l, S("z"), { kind: "before", ref: S("x") }).tree)).toEqual(["z", "x", "y"]);
    expect(shape(moveNode(l, S("x"), { kind: "after", ref: S("z") }).tree)).toEqual(["y", "z", "x"]);
  });
  it("moves a group with its children", () => {
    const l = L(g("a", s("x")), g("b"));
    expect(shape(moveNode(l, G("a"), { kind: "into", groupId: "b" }).tree)).toEqual([{ b: [{ a: ["x"] }] }]);
  });
  it("refuses a group into itself or its descendant, and a node onto itself", () => {
    const l = L(g("a", g("b", s("x"))));
    expect(moveNode(l, G("a"), { kind: "into", groupId: "b" })).toBe(l);
    expect(moveNode(l, G("a"), { kind: "before", ref: S("x") })).toBe(l);
    expect(moveNode(l, G("a"), { kind: "into", groupId: "a" })).toBe(l);
    expect(moveNode(l, S("x"), { kind: "before", ref: S("x") })).toBe(l);
    expect(canMove(l, G("a"), { kind: "into", groupId: "b" })).toBe(false);
    expect(canMove(l, S("x"), { kind: "into", groupId: null })).toBe(true);
    // A node dropped on its own row is a no-op, so it is not a valid drop.
    expect(canMove(l, S("x"), { kind: "before", ref: S("x") })).toBe(false);
    expect(canMove(l, S("x"), { kind: "after", ref: S("x") })).toBe(false);
    expect(canMove(l, G("a"), { kind: "after", ref: G("a") })).toBe(false);
  });
  it("is a no-op for an unknown target", () => {
    const l = L(s("x"));
    expect(moveNode(l, S("x"), { kind: "into", groupId: "nope" })).toBe(l);
  });
  it("places unplaced sessions at the end of the root first", () => {
    expect(shape(moveNode(L(g("a")), S("n"), { kind: "into", groupId: "a" }, ["m", "n"]).tree)).toEqual([{ a: ["n"] }, "m"]);
    expect(shape(moveNode(EMPTY_LAYOUT, S("n"), { kind: "before", ref: S("m") }, ["m", "n"]).tree)).toEqual(["n", "m"]);
  });
  it("does not mutate its input", () => {
    const l = L(g("a", s("x")), s("y"));
    const copy = structuredClone(l);
    moveNode(l, S("y"), { kind: "into", groupId: "a" });
    expect(l).toEqual(copy);
  });
});

describe("groups", () => {
  it("adds trimmed groups at the root and nested, and rejects empty labels", () => {
    const r = addGroup(L(g("a")), null, "  Work ");
    expect(r.id).toEqual(expect.any(String));
    expect(r.layout.tree[1]).toEqual({ kind: "group", id: r.id, label: "Work", children: [] });
    const n = addGroup(L(g("a")), "a", "Sub");
    expect((n.layout.tree[0] as GroupNode).children[0]).toMatchObject({ kind: "group", label: "Sub" });
    const l = L(g("a"));
    expect(addGroup(l, null, "   ")).toEqual({ layout: l, id: null });
  });
  it("renames, keeping the old label for an empty one", () => {
    expect((renameGroup(L(g("a")), "a", " New ").tree[0] as GroupNode).label).toBe("New");
    const l = L(g("a"));
    expect(renameGroup(l, "a", " ")).toBe(l);
  });
  it("deletes a group, promoting its children in place", () => {
    const l = L(s("p"), g("a", s("x"), g("b", s("y"))), s("q"));
    expect(shape(deleteGroup(l, "a").tree)).toEqual(["p", "x", { b: ["y"] }, "q"]);
  });
  it("lists group paths depth-first", () => {
    expect(groupPaths(L(g("a", g("b")), g("c")))).toEqual([
      { id: "a", path: "A" }, { id: "b", path: "A › B" }, { id: "c", path: "C" },
    ]);
  });
});

describe("bookmarks and forgetting", () => {
  it("bookmarks once, unbookmarks, and reorders", () => {
    let l = setBookmarked(EMPTY_LAYOUT, "x", true);
    l = setBookmarked(l, "x", true);
    l = setBookmarked(l, "y", true);
    expect(l.bookmarks).toEqual(["x", "y"]);
    expect(moveBookmark(l, "y", "x").bookmarks).toEqual(["y", "x"]);
    expect(moveBookmark(l, "x", null).bookmarks).toEqual(["y", "x"]);
    expect(setBookmarked(l, "x", false).bookmarks).toEqual(["y"]);
  });
  it("forgets sessions in the tree, and the bookmarked projects in them", () => {
    const x = sessionKey("m", "x"), y = sessionKey("m", "y"), z = sessionKey("m", "z");
    const l = { tree: [g("a", s(x), s(y))], bookmarks: [projectKey("m", "x", "app"), projectKey("m", "y", "api"), projectKey("m", "z", "web")] };
    const r = forgetSessions(l, [x, z]);
    expect(shape(r.tree)).toEqual([{ a: [y] }]);
    expect(r.bookmarks).toEqual([projectKey("m", "y", "api")]);
  });
  it("forgets every session of a machine", () => {
    const k1 = sessionKey("box", "a"), k2 = sessionKey("boxy", "b");
    const r = forgetMachine({ tree: [s(k1), s(k2)], bookmarks: [projectKey("box", "a", "app"), projectKey("boxy", "b", "app")] }, "box");
    expect(shape(r.tree)).toEqual([k2]);
    expect(r.bookmarks).toEqual([projectKey("boxy", "b", "app")]);
  });
});

describe("no-ops return the same object", () => {
  it("moveNode landing where the node already is", () => {
    const l = L(s("x"), s("y"), g("a", s("z")));
    expect(moveNode(l, S("x"), { kind: "before", ref: S("y") })).toBe(l);
    expect(moveNode(l, S("y"), { kind: "after", ref: S("x") })).toBe(l);
    expect(moveNode(l, G("a"), { kind: "into", groupId: null })).toBe(l);
    expect(moveNode(l, S("x"), { kind: "into", groupId: null, first: true })).toBe(l);
    expect(moveNode(l, S("z"), { kind: "into", groupId: "a" })).toBe(l);
  });
  it("renameGroup to the same label or an unknown id", () => {
    const l = L(g("a"));
    expect(renameGroup(l, "a", " A ")).toBe(l);
    expect(renameGroup(l, "nope", "X")).toBe(l);
  });
  it("deleteGroup on an unknown id", () => {
    const l = L(g("a"));
    expect(deleteGroup(l, "nope")).toBe(l);
  });
  it("bookmark and forget no-ops", () => {
    const l = { tree: [s("m/x")], bookmarks: ["x", "y"] };
    expect(setBookmarked(l, "x", true)).toBe(l);
    expect(setBookmarked(l, "z", false)).toBe(l);
    expect(moveBookmark(l, "x", "y")).toBe(l);
    expect(moveBookmark(l, "y", null)).toBe(l);
    expect(forgetSessions(l, ["absent"])).toBe(l);
    expect(forgetMachine(l, "nobody")).toBe(l);
  });
});

describe("renameSessionKey", () => {
  it("swaps the key in place, nested or in its bookmarked projects, and leaves other sessions alone", () => {
    const l: Layout = { tree: [s("a"), g("w", s("x"), g("n", s("x2")))], bookmarks: ["x/app", "x2/app", "a/web"] };
    const r = renameSessionKey(l, "x", "y");
    expect(shape(r.tree)).toEqual(["a", { w: ["y", { n: ["x2"] }] }]);
    expect(r.bookmarks).toEqual(["y/app", "x2/app", "a/web"]);
    expect(r.tree[0]).toBe(l.tree[0]);
  });
  it("returns the same layout when the session is not in it", () => {
    const l: Layout = { tree: [g("w", s("a"))], bookmarks: ["a/app"] };
    expect(renameSessionKey(l, "x", "y")).toBe(l);
  });
});

describe("kept workspaces", () => {
  const k = projectKey("local", "ai", "drover");
  const other = projectKey("local", "other", "w");
  it("keeps a workspace with its folder and forgets it", () => {
    const a = setKept(EMPTY_LAYOUT, k, "/x/drover");
    expect(a.kept).toEqual({ [k]: { folder: "/x/drover" } });
    expect(setKept(a, k, "/x/drover")).toBe(a);
    expect(setKept(a, k, "/y").kept).toEqual({ [k]: { folder: "/y" } });
    expect(forgetKept(a, k).kept).toEqual({});
    expect(forgetKept(EMPTY_LAYOUT, k)).toBe(EMPTY_LAYOUT);
  });
  it("bookmarking keeps the workspace; unbookmarking leaves it kept", () => {
    const a = setBookmarked(EMPTY_LAYOUT, k, true, "/x/drover");
    expect(a.kept).toEqual({ [k]: { folder: "/x/drover" } });
    const b = setBookmarked(a, k, false);
    expect(b.bookmarks).toEqual([]);
    expect(b.kept).toEqual(a.kept);
  });
  it("bookmarking leaves an existing kept folder alone", () => {
    expect(setBookmarked(setKept(EMPTY_LAYOUT, k, "/old"), k, true, "/new").kept?.[k]).toEqual({ folder: "/old" });
  });
  it("forgetting a bookmarked workspace unbookmarks it", () => {
    const a = forgetKept(setBookmarked(EMPTY_LAYOUT, k, true, null), k);
    expect(a.bookmarks).toEqual([]);
    expect(a.kept).toEqual({});
  });
  it("a renamed workspace carries its kept entry and its bookmark, in place", () => {
    const to = projectKey("local", "ai", "drover-2");
    const base = setBookmarked(setBookmarked(EMPTY_LAYOUT, k, true, "/x"), other, true, null);
    const a = renameProjectKey(base, k, to);
    expect(a.bookmarks).toEqual([to, other]);
    expect(a.kept).toEqual({ [to]: { folder: "/x" }, [other]: { folder: null } });
    expect(renameProjectKey(EMPTY_LAYOUT, k, to)).toBe(EMPTY_LAYOUT);
  });
  it("a renamed Session carries its kept entries; a forgotten Session or Machine drops them", () => {
    const base = setKept(setKept(EMPTY_LAYOUT, k, "/x"), other, null);
    expect(Object.keys(renameSessionKey(base, sessionKey("local", "ai"), sessionKey("local", "ai2")).kept!)).toEqual([
      projectKey("local", "ai2", "drover"), other,
    ]);
    expect(Object.keys(forgetSessions(base, [sessionKey("local", "ai")]).kept!)).toEqual([other]);
    expect(forgetMachine(base, "local").kept).toEqual({});
  });
  it("keeps fields it does not know through every change", () => {
    const x = setKept({ ...EMPTY_LAYOUT, future: 1 } as Layout, k, null);
    const future = (l: Layout) => (l as unknown as { future?: number }).future;
    expect(future(x)).toBe(1);
    expect(future(forgetSessions(x, [sessionKey("local", "ai")]))).toBe(1);
    expect(future(renameSessionKey(x, sessionKey("local", "ai"), sessionKey("local", "b")))).toBe(1);
    expect(future(forgetMachine(x, "local"))).toBe(1);
    expect(future(renameProjectKey(x, k, projectKey("local", "ai", "z")))).toBe(1);
  });
});
