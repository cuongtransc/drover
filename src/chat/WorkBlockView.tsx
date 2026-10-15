import { memo, useEffect, useRef } from "react";
import type { ChatItem } from "../lib/types";
import { BrainIcon, ChevronIcon } from "../ui/icons";
import { ChatItemView } from "./ChatItemView";
import { SkillChips, turnSkills } from "./skills";
import { formatWorkDuration, workSummary, type ToolResult, type WorkBlock } from "./workBlocks";

/**
 * One turn's work under one header ("Worked for 7s · 1 edit"). Controlled: the Chat lens keeps
 * open/closed, since a virtualized row unmounts when it scrolls away.
 */
export const WorkBlockView = memo(function WorkBlockView({
  block,
  results,
  open,
  onToggle,
  live,
  working = live,
  focusCall,
  onFocusHandled,
}: {
  block: WorkBlock;
  results: Map<string, ToolResult>;
  open: boolean;
  /** Called with this block's id and its open state, so a stable callback keeps memo working. */
  onToggle: (id: string, open: boolean) => void;
  live: boolean;
  /** Running, not waiting on the user: a call without its result yet spins. Defaults to `live`. */
  working?: boolean;
  /** A call id to bring into view once this block is open and its rows are rendered. */
  focusCall?: string | null;
  /** Called after the focused call has been scrolled into view. */
  onFocusHandled?: () => void;
}) {
  const rowsRef = useRef<HTMLDivElement>(null);
  // Runs when the block mounts or opens, so a jumped-to row the virtualizer only just rendered
  // still reaches its card. A block not holding `focusCall` does nothing.
  useEffect(() => {
    if (!focusCall || !open || !rowsRef.current) return;
    const el = [...rowsRef.current.querySelectorAll<HTMLElement>("[data-call]")].find((c) => c.dataset.call === focusCall);
    if (!el) return;
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest" });
    onFocusHandled?.();
  }, [focusCall, open, block.items, onFocusHandled]);
  const duration = formatWorkDuration(block.start, block.end);
  const title = duration ? `Worked for ${duration}` : "Worked";
  const summary = workSummary(block.items, results);
  return (
    <div className="chat-row chat-work">
      <button className="chat-work-head" aria-expanded={open} onClick={() => onToggle(block.id, open)}>
        <ChevronIcon className={"icon chev" + (open ? " open" : "")} />
        {/* While live the working line below has the spinner and clock; this shows what was done. */}
        {!live && <span className="chat-work-title">{title}</span>}
        {summary && (
          <>
            {!live && " · "}
            <span className="chat-work-summary">{summary}</span>
          </>
        )}
      </button>
      <SkillChips chips={turnSkills(block.items, results)} />
      {!open && <ThinkingLines items={block.items} />}
      {open && (
        <div className="chat-work-rows" ref={rowsRef}>
          {block.items.map((it, i) => (
            <div key={i} data-call={it.kind === "tool_call" ? it.id : undefined} className={it.kind === "assistant_text" ? "chat-narration" : undefined}>
              <ChatItemView
                item={it}
                result={it.kind === "tool_call" ? results.get(it.id) : undefined}
                running={working && it.kind === "tool_call" && !results.has(it.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * The turn's thinking under the folded header: where Claude settles a decision it may not repeat
 * in its answer. Narration stays folded; it is mostly progress the answer sums up.
 */
function ThinkingLines({ items }: { items: ChatItem[] }) {
  const texts = items.flatMap((it) => (it.kind === "thinking" && it.text.trim() ? [it.text.trim()] : []));
  if (texts.length === 0) return null;
  return (
    <div className="chat-work-rows">
      {texts.map((text, i) => (
        <div key={i} className="chat-work-thinking">
          <BrainIcon className="icon chat-thinking-icon" />
          <span>{text}</span>
        </div>
      ))}
    </div>
  );
}
