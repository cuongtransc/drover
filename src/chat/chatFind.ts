import { findMatches } from "../files/find";
import { findRanges } from "../files/domFind";
import type { ChatRow } from "./workBlocks";

/** One match: the row it is in, and which match it is in that row. */
export interface ChatHit {
  row: number;
  nth: number;
}

/** An answer's text as it reads: no emphasis or heading marks, a link's text without its target. */
export function plainMarkdown(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/gm, "");
}

/**
 * The searched text of a row: your messages, the answers, and a Work block's thinking when it is
 * shown (`thinking`, Claude's); not tools or narration.
 */
function rowText(row: ChatRow, thinking: boolean): string | null {
  if (row.kind === "work") {
    if (!thinking) return null;
    return row.block.items.flatMap((it) => (it.kind === "thinking" && it.text.trim() ? [it.text.trim()] : [])).join("\n");
  }
  const it = row.item;
  if (it.kind === "user") return it.text;
  if (it.kind === "assistant_text") return plainMarkdown(it.markdown);
  return null;
}

/** Every match of `query` in the Chat's loaded rows, in order. */
export function chatFindHits(rows: readonly ChatRow[], query: string, matchCase: boolean, thinking = false): ChatHit[] {
  if (!query) return [];
  const out: ChatHit[] = [];
  rows.forEach((r, row) => {
    const text = rowText(r, thinking);
    if (!text) return;
    const n = findMatches(text.split("\n"), query, matchCase).length;
    for (let nth = 0; nth < n; nth++) out.push({ row, nth });
  });
  return out;
}

/** Where a Work block shows its thinking: the lines under the folded header, or each open Thinking. */
const THINKING_TEXT = ".chat-work-thinking span, .chat-thinking .chat-dim";

/** The marks for a row on screen: the same text `chatFindHits` counts, so the nth match lines up. */
export function rowFindRanges(el: Element, kind: ChatRow["kind"], query: string, matchCase: boolean, thinking: boolean): Range[] {
  if (kind !== "work") return findRanges(el, query, matchCase);
  if (!thinking) return [];
  return [...el.querySelectorAll(THINKING_TEXT)].flatMap((t) => findRanges(t, query, matchCase));
}
