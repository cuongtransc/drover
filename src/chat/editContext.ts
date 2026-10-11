import { createContext } from "react";
import type { ChatItem } from "../lib/types";

/** The user's last message, which Edit takes back, and what Edit does; null where editing is off. */
export const ChatEditContext = createContext<{ last: ChatItem | null; onEdit: (text: string) => void } | null>(null);
