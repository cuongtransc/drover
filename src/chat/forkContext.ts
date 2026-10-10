import { createContext } from "react";
import type { ChatItem } from "../lib/types";

/** Forks the Chat lens's Agent from before one of the user's messages; null where forking is off. */
export const ChatForkContext = createContext<((item: Extract<ChatItem, { kind: "user" }>) => void) | null>(null);
