import { createContext } from "react";
import type { ChatItem } from "../lib/types";
import { pathHints, type PathHint } from "./pathHints";

/** What a Chat's tool calls say about where its paths are, and each item's place in it. */
export interface ChatPaths {
  hints: PathHint[];
  order: Map<ChatItem, number>;
}

export function chatPaths(items: readonly ChatItem[]): ChatPaths {
  return { hints: pathHints(items), order: new Map(items.map((it, i) => [it, i])) };
}

export const ChatPathsContext = createContext<ChatPaths | null>(null);
/** The item a path is written in, so only the tool calls before it say where it is. */
export const ChatItemContext = createContext<ChatItem | null>(null);
