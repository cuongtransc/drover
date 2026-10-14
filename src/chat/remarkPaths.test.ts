import { describe, expect, it } from "vitest";
import { splitBarePaths } from "./remarkPaths";

describe("splitBarePaths", () => {
  it("cuts a bare absolute path out of prose, without the colon that ends it", () => {
    expect(splitBarePaths("- /Users/me/notes/a-b.md: why not teams")).toEqual(["- ", { path: "/Users/me/notes/a-b.md" }, ": why not teams"]);
  });

  it("keeps a :line and drops closing punctuation", () => {
    expect(splitBarePaths("See /tmp/x/a.ts:12, then ~/b.md.")).toEqual(["See ", { path: "/tmp/x/a.ts:12" }, ", then ", { path: "~/b.md" }, "."]);
    expect(splitBarePaths("(in ~/x/c.json)")).toEqual(["(in ", { path: "~/x/c.json" }, ")"]);
  });

  it.each([
    "and/or the 1/2 split",
    "https://example.com/a/b.md",
    "file:///Users/me/a.md",
    "a folder /Users/me/notes/ or /Users/me/notes",
    "a glob ~/.claude/projects/*/a.md",
    "src/chat/a.ts is relative",
    "/ alone",
  ])("leaves %s alone", (text) => {
    expect(splitBarePaths(text)).toEqual([text]);
  });
});
