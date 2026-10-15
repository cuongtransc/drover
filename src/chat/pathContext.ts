import { createContext } from "react";
import type { ChatItem } from "../lib/types";
import { pathHints, type PathHint } from "./pathHints";

/**
 * What a Chat's tool calls say about where its paths are. Read on a click, from the items the Chat
 * holds then, so the value never changes and no path re-renders as the Chat grows.
 */
export interface ChatPaths {
  /** The hints from the items before `item` (all of them when the Chat does not hold it). */
  hintsBefore(item: ChatItem | null): { hints: PathHint[]; upTo: number };
}

export function chatPaths(items: () => readonly ChatItem[]): ChatPaths {
  return {
    hintsBefore(item) {
      const all = items();
      const at = item ? all.indexOf(item) : -1;
      const upTo = at < 0 ? all.length : at;
      return { hints: pathHints(all.slice(0, upTo)), upTo };
    },
  };
}

export const ChatPathsContext = createContext<ChatPaths | null>(null);
/** The item a path is written in, so only the tool calls before it say where it is. */
export const ChatItemContext = createContext<ChatItem | null>(null);
