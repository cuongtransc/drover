import { findMatches } from "../files/find";
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

/** The searched text of a row: your messages and the answers, not tools or work blocks. */
function rowText(row: ChatRow): string | null {
  if (row.kind !== "item") return null;
  const it = row.item;
  if (it.kind === "user") return it.text;
  if (it.kind === "assistant_text") return plainMarkdown(it.markdown);
  return null;
}

/** Every match of `query` in the Chat's loaded rows, in order. */
export function chatFindHits(rows: readonly ChatRow[], query: string, matchCase: boolean): ChatHit[] {
  if (!query) return [];
  const out: ChatHit[] = [];
  rows.forEach((r, row) => {
    const text = rowText(r);
    if (!text) return;
    const n = findMatches(text.split("\n"), query, matchCase).length;
    for (let nth = 0; nth < n; nth++) out.push({ row, nth });
  });
  return out;
}
