import { describe, expect, it } from "vitest";
import type { ChatItem } from "../lib/types";
import { chatFindHits, plainMarkdown, rowFindRanges } from "./chatFind";
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

describe("thinking", () => {
  const think = (text: string): ChatItem => ({ kind: "thinking", text });
  const block = (items: ChatItem[]): ChatRow => ({ kind: "work", key: "w", block: { id: "w", items } as never, last: false });
  const rows = [block([think("  plan the parser  "), answer("parser narration"), think("parser again")])];

  it("finds in a Work block's thinking when it is shown (Claude's), not its narration", () => {
    expect(chatFindHits(rows, "parser", false, { thinking: true })).toEqual([
      { row: 0, nth: 0 },
      { row: 0, nth: 1 },
    ]);
  });

  it("skips thinking that is not shown (pi's)", () => {
    expect(chatFindHits(rows, "parser", false)).toEqual([]);
  });

  // The count above and the marks on screen must agree, folded or open.
  const html = {
    folded:
      '<button class="chat-work-head">Worked · parser.ts</button>' +
      '<div class="chat-work-rows"><div class="chat-work-thinking"><svg></svg><span>plan the parser</span></div>' +
      '<div class="chat-work-thinking"><svg></svg><span>parser again</span></div></div>',
    open:
      '<button class="chat-work-head">Worked · parser.ts</button><div class="chat-work-rows">' +
      '<details class="chat-thinking" open><summary>Thinking…</summary><div class="chat-dim">  plan the parser  </div></details>' +
      '<div class="chat-narration">narration</div>' +
      '<details class="chat-thinking" open><summary>Thinking…</summary><div class="chat-dim">parser again</div></details></div>',
  };
  it.each(Object.entries(html))("marks only the thinking of a %s Work block", (_, inner) => {
    const el = document.createElement("div");
    el.innerHTML = `<div class="chat-row chat-work">${inner}</div>`;
    expect(rowFindRanges(el, "work", "parser", false, true).map((r) => r.toString())).toEqual(["parser", "parser"]);
    expect(rowFindRanges(el, "work", "parser", false, false)).toEqual([]);
  });
});

describe("an open Work block", () => {
  const call = (id: string, input_summary: string): ChatItem =>
    ({ kind: "tool_call", id, name: "Bash", input_summary, input: { command: input_summary } }) as ChatItem;
  const result: ChatItem = { kind: "tool_result", call_id: "c1", output: "parser output", is_error: false };
  const rows: ChatRow[] = [
    { kind: "work", key: "w", block: { id: "w", items: [{ kind: "thinking", text: "plan" }, answer("check the **parser**"), call("c1", "rg parser src"), result] } as never, last: false },
  ];
  const open = (id: string) => id === "w";

  it("finds what it shows: narration and each command's line, not the output folded in the card", () => {
    expect(chatFindHits(rows, "parser", false, { isOpen: open })).toEqual([
      { row: 0, nth: 0 },
      { row: 0, nth: 1 },
    ]);
    expect(chatFindHits(rows, "bash", false, { isOpen: open })).toHaveLength(1);
    expect(chatFindHits(rows, "parser", false)).toEqual([]);
  });

  it("marks the same text on screen", () => {
    const el = document.createElement("div");
    el.innerHTML =
      '<div class="chat-row chat-work"><button class="chat-work-head">Worked · parser</button><div class="chat-work-rows">' +
      '<div><details class="chat-thinking"><summary>Thinking…</summary><div class="chat-dim">plan</div></details></div>' +
      '<div class="chat-narration"><div class="chat-row chat-assistant"><p>check the <strong>parser</strong></p></div></div>' +
      '<div data-call="c1"><div class="chat-tool"><button class="chat-tool-row"><span class="chat-tool-name">Bash</span>' +
      '<span class="chat-tool-sep"> · </span><span class="chat-tool-summary">rg parser src</span></button>' +
      '<div class="chat-tool-body"><pre class="chat-result">parser output</pre></div></div></div></div></div>';
    expect(rowFindRanges(el, "work", "parser", false, false).map((r) => r.toString())).toEqual(["parser", "parser"]);
  });
});

describe("plainMarkdown", () => {
  it("keeps what an answer shows: link text, code, words, not the marks or the link targets", () => {
    expect(plainMarkdown("See **the** [PR](https://x/foo) and `foo()`\n# Title\n> quoted\n- item")).toBe(
      "See the PR and foo()\nTitle\nquoted\nitem",
    );
  });
});
