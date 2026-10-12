import { describe, expect, it } from "vitest";
import { parsePathRef, pathTarget } from "./pathLinks";

describe("parsePathRef", () => {
  it.each([
    ["src/chat/markdown.tsx:34", "src/chat/markdown.tsx", 34],
    ["src/chat/markdown.tsx", "src/chat/markdown.tsx", null],
    ["./docs/a.md:3:7", "./docs/a.md", 3],
    ["../x/y.ts", "../x/y.ts", null],
    ["/Users/me/shot.png", "/Users/me/shot.png", null],
    ["~/notes/today.md", "~/notes/today.md", null],
    ["/private/tmp/scratch pad/a b.png", "/private/tmp/scratch pad/a b.png", null],
    ["/etc/hosts", "/etc/hosts", null],
  ])("reads %s as a path", (text, path, line) => {
    expect(parsePathRef(text)).toEqual({ path, line });
  });

  it.each(["mise run ci", "and/or", "1/2", "https://example.com/a.png", "src/files", "a b/c.ts", "foo.ts", "--fg-3", "x".repeat(600) + "/a.ts", "", "/"])(
    "leaves %s as code",
    (text) => {
      expect(parsePathRef(text)).toBeNull();
    },
  );

  // A glob names many files or none: opening it as one file only fails with "does not exist".
  it.each(["/private/tmp/s/chip-{light,dark}-{262,900}.png", "~/.claude/projects/*/memory/*.md", "/var/log/app-?.log", "../_shared/*", ".batch/*.spec.ts"])(
    "leaves the glob %s as code",
    (text) => {
      expect(parsePathRef(text)).toBeNull();
    },
  );
});

describe("pathTarget", () => {
  const root = "/Users/me/app";
  const home = "/Users/me";

  it("opens a path inside the workspace folder in Files, at its line", () => {
    expect(pathTarget({ path: "src/a.ts", line: 12 }, { root, home, local: true })).toEqual({ kind: "files", abs: "/Users/me/app/src/a.ts", line: 12 });
    expect(pathTarget({ path: "/Users/me/app/docs/b.md", line: null }, { root, home, local: false })).toEqual({ kind: "files", abs: "/Users/me/app/docs/b.md", line: null });
    expect(pathTarget({ path: "~/app/c.ts", line: null }, { root, home, local: false })).toEqual({ kind: "files", abs: "/Users/me/app/c.ts", line: null });
  });

  it("resolves . and .. against the workspace folder", () => {
    expect(pathTarget({ path: "./src/../docs/a.md", line: null }, { root, home, local: true })).toEqual({ kind: "files", abs: "/Users/me/app/docs/a.md", line: null });
    expect(pathTarget({ path: "../other/x.ts", line: null }, { root, home, local: true })).toEqual({ kind: "file", abs: "/Users/me/other/x.ts" });
  });

  it("hands a path outside the folder to this Mac, or reads it from another machine", () => {
    expect(pathTarget({ path: "/private/tmp/a.png", line: null }, { root, home, local: true })).toEqual({ kind: "file", abs: "/private/tmp/a.png" });
    expect(pathTarget({ path: "/tmp/a.md", line: 3 }, { root, home, local: false })).toEqual({ kind: "remote", abs: "/tmp/a.md", line: 3 });
    expect(pathTarget({ path: "~/notes/a.md", line: null }, { root: null, home, local: false })).toEqual({ kind: "remote", abs: "/Users/me/notes/a.md", line: null });
  });

  it("does not take a sibling folder sharing the prefix for the workspace", () => {
    expect(pathTarget({ path: "/Users/me/app-old/a.ts", line: null }, { root, home, local: false })).toEqual({ kind: "remote", abs: "/Users/me/app-old/a.ts", line: null });
  });

  it("reads nothing from another machine for a path that ends in a folder", () => {
    expect(pathTarget({ path: "/", line: null }, { root, home, local: false })).toBeNull();
  });

  it("needs a root for a relative path, and a home for ~", () => {
    expect(pathTarget({ path: "src/a.ts", line: null }, { root: null, home, local: true })).toBeNull();
    expect(pathTarget({ path: "~/a.md", line: null }, { root, home: null, local: true })).toBeNull();
  });
});
