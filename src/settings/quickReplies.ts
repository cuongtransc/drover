import { create } from "zustand";

/** Shared with store.ts, theme.ts and notify.ts: one JSON object, each writer merges its own keys. */
const SETTINGS_KEY = "drover:settings";

/**
 * The short replies people send an agent most, by count; each person edits theirs in Settings.
 * No /compact: the Composer shows its own once the context passes 75%.
 */
export const DEFAULT_QUICK_REPLIES = ["ok", "continue", "merged", "what's next?", "commit and push"];
export const QUICK_REPLIES_MAX = 12;
export const QUICK_REPLY_MAX_CHARS = 200;

export interface QuickReplies {
  /** Whether the buttons show above the Composer. */
  show: boolean;
  /** As edited in Settings, blank rows included. */
  replies: string[];
}

function readRaw(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function save(patch: Record<string, unknown>): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readRaw(), ...patch }));
  } catch {
    /* ignore */
  }
}

/** Strings only, capped in count and length; anything but a list falls back to the defaults. */
export function normalizeReplies(v: unknown): string[] {
  if (!Array.isArray(v)) return [...DEFAULT_QUICK_REPLIES];
  return v
    .filter((r): r is string => typeof r === "string")
    .slice(0, QUICK_REPLIES_MAX)
    .map((r) => r.slice(0, QUICK_REPLY_MAX_CHARS));
}

/** `replies` with the one at `from` moved to `to`, the others closing up; the same list if nothing moves. */
export function moveReplyTo(replies: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || from >= replies.length || to < 0 || to >= replies.length) return replies;
  const next = [...replies];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** `replies` with the one at `from` moved one place (`by` -1 up, +1 down); the same list past either end. */
export function moveReply(replies: string[], from: number, by: -1 | 1): string[] {
  return moveReplyTo(replies, from, from + by);
}

/** The slot a dragged row lands in: the one whose middle (`mids`, in px) is nearest its own middle. */
export function slotAt(middle: number, mids: number[]): number {
  let best = 0;
  for (let i = 1; i < mids.length; i++) if (Math.abs(mids[i] - middle) < Math.abs(mids[best] - middle)) best = i;
  return best;
}

/** The replies worth a button: the list without the blank rows still being written. */
export function quickReplyButtons(replies: string[]): string[] {
  return replies.filter((r) => r.trim() !== "");
}

export function loadQuickReplies(): QuickReplies {
  const raw = readRaw();
  return {
    show: typeof raw.showQuickReplies === "boolean" ? raw.showQuickReplies : true,
    replies: normalizeReplies(raw.quickReplies),
  };
}

interface QuickRepliesStore extends QuickReplies {
  setShow: (show: boolean) => void;
  setReplies: (replies: string[]) => void;
  reset: () => void;
}

export const useQuickReplies = create<QuickRepliesStore>((setState) => ({
  ...loadQuickReplies(),
  setShow: (show) => {
    save({ showQuickReplies: show });
    setState({ show });
  },
  setReplies: (next) => {
    const replies = normalizeReplies(next);
    save({ quickReplies: replies });
    setState({ replies });
  },
  reset: () => {
    save({ quickReplies: DEFAULT_QUICK_REPLIES });
    setState({ replies: [...DEFAULT_QUICK_REPLIES] });
  },
}));
