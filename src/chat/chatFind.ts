import { findMatches } from "../files/find";
import { findRanges } from "../files/domFind";
import type { ChatItem } from "../lib/types";
import { checklist, checklistSummary } from "./checklist";
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

/** What `chatFindHits` searches beyond your messages and the answers: what the Chat shows. */
export interface ChatFindScope {
  /** A Work block's thinking is shown (Claude's), under its folded header or open. */
  thinking?: boolean;
  /** Whether a Work block is open: then its narration and each command's line show too. */
  isOpen?: (id: string) => boolean;
}

/** A command's line in an open Work block, as its card shows it folded. */
function callLine(it: Extract<ChatItem, { kind: "tool_call" }>): string {
  const todos = checklist(it.input);
  return `${it.name}\n${todos ? checklistSummary(todos) : it.input_summary}`;
}

/** The searched text of a row: what it shows, not tool output (folded in each card). */
function rowText(row: ChatRow, scope: ChatFindScope): string | null {
  if (row.kind === "work") {
    const open = scope.isOpen?.(row.block.id) ?? false;
    return row.block.items
      .flatMap((it) => {
        if (it.kind === "thinking")
          return scope.thinking && it.text.trim() ? [it.text.trim()] : [];
        if (!open) return [];
        if (it.kind === "assistant_text") return [plainMarkdown(it.markdown)];
        if (it.kind === "tool_call") return [callLine(it)];
        return [];
      })
      .join("\n");
  }
  const it = row.item;
  if (it.kind === "user") return it.text;
  if (it.kind === "assistant_text") return plainMarkdown(it.markdown);
  return null;
}

/** Every match of `query` in the Chat's loaded rows, in order. */
export function chatFindHits(
  rows: readonly ChatRow[],
  query: string,
  matchCase: boolean,
  scope: ChatFindScope = {},
): ChatHit[] {
  if (!query) return [];
  const out: ChatHit[] = [];
  rows.forEach((r, row) => {
    const text = rowText(r, scope);
    if (!text) return;
    const n = findMatches(text.split("\n"), query, matchCase).length;
    for (let nth = 0; nth < n; nth++) out.push({ row, nth });
  });
  return out;
}

/** A Work row's searched text on screen: thinking (folded or open), narration, each command's line. */
const WORK_TEXT =
  ".chat-work-thinking span, .chat-thinking .chat-dim, .chat-narration, .chat-tool-name, .chat-tool-summary";
const WORK_TEXT_NO_THINKING =
  ".chat-narration, .chat-tool-name, .chat-tool-summary";

/** The marks for a row on screen: the same text `chatFindHits` counts, so the nth match lines up. */
export function rowFindRanges(
  el: Element,
  kind: ChatRow["kind"],
  query: string,
  matchCase: boolean,
  thinking: boolean,
): Range[] {
  if (kind !== "work") return findRanges(el, query, matchCase);
  return [
    ...el.querySelectorAll(thinking ? WORK_TEXT : WORK_TEXT_NO_THINKING),
  ].flatMap((t) => findRanges(t, query, matchCase));
}
