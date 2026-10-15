import { describe, expect, it } from "vitest";
import type { ChatItem } from "../lib/types";
import { pathCandidates, pathHints } from "./pathHints";

const bash = (command: string): ChatItem => ({ kind: "tool_call", id: command, name: "Bash", input_summary: "", input: { command } });
const tool = (name: string, input: unknown): ChatItem => ({ kind: "tool_call", id: name, name, input_summary: "", input });
const text = (markdown: string): ChatItem => ({ kind: "assistant_text", markdown });
const ctx = { root: "/Users/me/infra", home: "/Users/me" };

describe("pathHints", () => {
  it("follows a chain of cd in one command, from ~ and then relative", () => {
    const hints = pathHints([bash("cd ~/Dev/app && git worktree add .worktrees/x && cd .worktrees/x && cp a b")]);
    expect(hints.map((h) => h.path)).toEqual(["~/Dev/app", "~/Dev/app/.worktrees/x"]);
  });

  it("starts a relative cd at the session's folder, and takes git -C and pushd", () => {
    const hints = pathHints([bash("cd sub; git -C /srv/repo log; pushd '/tmp/a b' >/dev/null")]);
    expect(hints.map((h) => h.path)).toEqual(["./sub", "/srv/repo", "/tmp/a b"]);
  });

  it("takes file paths from any tool's input, and records where each came", () => {
    const items = [text("hi"), tool("Read", { file_path: "/w/r/docs/a.md" }), bash("ls ~/x/y.txt /etc/x.conf >/dev/null")];
    expect(pathHints(items)).toEqual([
      { at: 1, kind: "path", path: "/w/r/docs/a.md" },
      { at: 2, kind: "path", path: "~/x/y.txt" },
      { at: 2, kind: "path", path: "/etc/x.conf" },
    ]);
  });

  it("reads no path out of what a tool writes, only from its path arguments and Bash commands", () => {
    const items = [
      tool("Write", { file_path: "/w/r/a.md", content: "see /etc/other/x.conf and ~/y/z.ts" }),
      tool("Edit", { file_path: "/w/r/b.md", old_string: "/a/b/c.ts", new_string: "/d/e/f.ts" }),
    ];
    expect(pathHints(items).map((h) => h.path)).toEqual(["/w/r/a.md", "/w/r/b.md"]);
  });

  it("takes a whole tool argument as one path, spaces and all, but not a Bash command", () => {
    const items = [tool("Read", { file_path: "/Users/me/My Docs/a b.md" }), bash("/usr/bin/env python3 x.py")];
    expect(pathHints(items)).toEqual([{ at: 0, kind: "path", path: "/Users/me/My Docs/a b.md" }]);
  });
});

describe("pathCandidates", () => {
  const items = [
    bash("cd ~/Dev/old && make"), // 0
    tool("Edit", { file_path: "/w/one/docs/05-operate.md" }), // 1
    bash("cd ~/Dev/ct-assistant/.worktrees/feat-avatar && cp x profiles/personal/avatar.svg"), // 2
    text("see `profiles/personal/avatar.svg`"), // 3
    tool("Edit", { file_path: "/w/two/docs/05-operate.md" }), // 4
  ];
  const hints = pathHints(items);

  it("tries a path a tool used that ends in it first, then folders it worked in, newest first, then the session's folder", () => {
    expect(pathCandidates("docs/05-operate.md", hints, 5, ctx)).toEqual([
      "/w/two/docs/05-operate.md",
      "/w/one/docs/05-operate.md",
      "/Users/me/Dev/ct-assistant/.worktrees/feat-avatar/docs/05-operate.md",
      "/Users/me/Dev/old/docs/05-operate.md",
      "/Users/me/infra/docs/05-operate.md",
    ]);
  });

  it("uses only what came before the message", () => {
    expect(pathCandidates("profiles/personal/avatar.svg", hints, 3, ctx)).toEqual([
      "/Users/me/Dev/ct-assistant/.worktrees/feat-avatar/profiles/personal/avatar.svg",
      "/Users/me/Dev/old/profiles/personal/avatar.svg",
      "/Users/me/infra/profiles/personal/avatar.svg",
    ]);
  });

  it("resolves ./ and ../ and lists each path once", () => {
    const h = pathHints([bash("cd /a/b && cd ../c && cd /a/c")]);
    expect(pathCandidates("./x/y.ts", h, 1, ctx)).toEqual(["/a/c/x/y.ts", "/a/b/x/y.ts", "/Users/me/infra/x/y.ts"]);
  });

  it("keeps the session's folder when it caps the places to try", () => {
    const many = pathHints(Array.from({ length: 80 }, (_, i) => bash(`cd /w/d${i}`)));
    const out = pathCandidates("a/b.ts", many, 80, ctx, 64);
    expect(out).toHaveLength(64);
    expect(out[0]).toBe("/w/d79/a/b.ts");
    expect(out[63]).toBe("/Users/me/infra/a/b.ts");
  });

  it("leaves the session's folder where the agent last went into it", () => {
    const h = pathHints([bash("cd /w/old"), bash("cd /Users/me/infra && git pull")]);
    expect(pathCandidates("a/b.ts", h, 2, ctx, 64)).toEqual(["/Users/me/infra/a/b.ts", "/w/old/a/b.ts"]);
  });

  it("without a home, leaves out what starts at ~", () => {
    expect(pathCandidates("a/b.ts", pathHints([bash("cd ~/r")]), 1, { root: "/s", home: null })).toEqual(["/s/a/b.ts"]);
  });
});
