import { describe, expect, it } from "vitest";
import type { ChatItem } from "../lib/types";
import { chatFindHits, plainMarkdown } from "./chatFind";
import type { ChatRow } from "./workBlocks";

const row = (item: ChatItem, i: number): ChatRow => ({ kind: "item", key: `k${i}`, item });
const user = (text: string): ChatItem => ({ kind: "user", text });
const answer = (markdown: string): ChatItem => ({ kind: "assistant_text", markdown });
const work = (i: number): ChatRow => ({ kind: "work", key: `w${i}`, block: { id: `w${i}`, items: [answer("foo inside the work")] } as never, last: false });

describe("chatFindHits", () => {
  it("finds in your messages and the answers, each match with its row, in order", () => {
    const rows = [row(user("fix foo"), 0), work(1), row(answer("Foo and foo"), 2)];
    expect(chatFindHits(rows, "foo", false)).toEqual([
      { row: 0, nth: 0 },
      { row: 2, nth: 0 },
      { row: 2, nth: 1 },
    ]);
  });

  it("matches case when asked", () => {
    const rows = [row(answer("Foo and foo"), 0)];
    expect(chatFindHits(rows, "Foo", true)).toEqual([{ row: 0, nth: 0 }]);
  });

  it("skips tool output and work blocks, and finds nothing for an empty query", () => {
    const tool: ChatItem = { kind: "tool_result", call_id: "c", output: "foo", is_error: false };
    expect(chatFindHits([row(tool, 0), work(1)], "foo", false)).toEqual([]);
    expect(chatFindHits([row(user("foo"), 0)], "", false)).toEqual([]);
  });
});

describe("plainMarkdown", () => {
  it("keeps what an answer shows: link text, code, words, not the marks or the link targets", () => {
    expect(plainMarkdown("See **the** [PR](https://x/foo) and `foo()`\n# Title\n> quoted\n- item")).toBe(
      "See the PR and foo()\nTitle\nquoted\nitem",
    );
  });
});
