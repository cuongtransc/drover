import { useEffect, useRef, useState } from "react";
import { ChevronIcon } from "../ui/icons";
import type { OutlineEntry } from "./outline";
import { ResizeEdge } from "./ResizeEdge";
import {
  clampOutlineWidth,
  loadOutlineCollapsed,
  loadOutlineWidth,
  OUTLINE_DEFAULT,
  OUTLINE_MAX,
  OUTLINE_MIN,
  saveOutlineCollapsed,
  saveOutlineWidth,
} from "./outlineWidth";

/** The rail beside a wide chat: one line per user turn, the one being read highlighted.
 *  Shown even before the first turn, so the chat column doesn't shift when it arrives. */
export function ChatOutline({ entries, current, onJump }: { entries: OutlineEntry[]; current: number; onJump: (row: number) => void }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [width, setWidth] = useState(loadOutlineWidth);
  const [collapsed, setCollapsed] = useState(loadOutlineCollapsed);
  const collapse = (to: boolean) => {
    saveOutlineCollapsed(to);
    setCollapsed(to);
  };
  // Keep the highlighted turn in the rail's own view as the chat scrolls past it.
  useEffect(() => {
    const el = listRef.current?.children[current]?.firstElementChild as HTMLElement | null | undefined;
    el?.scrollIntoView?.({ block: "nearest" });
  }, [current]);
  const resize = (px: number) => {
    const w = clampOutlineWidth(px);
    setWidth(w);
    return w;
  };

  if (collapsed)
    return (
      <nav className="chat-outline collapsed" aria-label="Conversation outline">
        <button type="button" className="chat-outline-toggle" aria-expanded={false} aria-label="Show outline" title="Show outline" onClick={() => collapse(false)}>
          <ChevronIcon className="icon flip" />
        </button>
      </nav>
    );

  return (
    <nav className="chat-outline" aria-label="Conversation outline" style={{ width }}>
      <ResizeEdge
        label="Resize outline"
        width={width}
        min={OUTLINE_MIN}
        max={OUTLINE_MAX}
        fallback={OUTLINE_DEFAULT}
        resize={resize}
        save={saveOutlineWidth}
      />
      <div className="chat-outline-head">
        <span>Outline</span>
        <button type="button" className="chat-outline-toggle" aria-expanded={true} aria-label="Hide outline" title="Hide outline" onClick={() => collapse(true)}>
          <ChevronIcon className="icon" />
        </button>
      </div>
      {entries.length === 0 && <p className="chat-outline-empty">Your prompts will appear here.</p>}
      <ol ref={listRef}>
        {entries.map((e, i) => (
          <li key={e.key}>
            <button type="button" title={e.label} aria-current={i === current ? "true" : undefined} onClick={() => onJump(e.row)}>
              {e.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
