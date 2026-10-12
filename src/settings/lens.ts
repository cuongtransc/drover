import { create } from "zustand";
import type { LensName } from "../lens";

/** Shared with store.ts, theme.ts, quickReplies.ts and notify.ts: one JSON object, each writer merges its own keys. */
const SETTINGS_KEY = "drover:settings";

export const NEW_AGENT_LENSES: readonly LensName[] = ["terminal", "chat"];

/** How wide the chat's column runs: a reading column, a wider one, or the whole pane. */
export const CHAT_WIDTHS = ["comfortable", "wide", "full"] as const;
export type ChatWidth = (typeof CHAT_WIDTHS)[number];

export interface LensSettings {
  /** The lens a new agent opens on. On Chat, a pane that falls back to the Terminal for want of a transcript returns to Chat once one exists. */
  newAgentLens: LensName;
  chatWidth: ChatWidth;
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

export function loadLensSettings(): LensSettings {
  const raw = readRaw();
  const v = raw.newAgentLens;
  const w = raw.chatWidth;
  return {
    newAgentLens: NEW_AGENT_LENSES.includes(v as LensName) ? (v as LensName) : "terminal",
    chatWidth: CHAT_WIDTHS.includes(w as ChatWidth) ? (w as ChatWidth) : "comfortable",
  };
}

interface LensSettingsStore extends LensSettings {
  setNewAgentLens: (lens: LensName) => void;
  setChatWidth: (width: ChatWidth) => void;
}

export const useLensSettings = create<LensSettingsStore>((setState) => ({
  ...loadLensSettings(),
  setNewAgentLens: (newAgentLens) => {
    save({ newAgentLens });
    setState({ newAgentLens });
  },
  setChatWidth: (chatWidth) => {
    save({ chatWidth });
    setState({ chatWidth });
  },
}));

/** Whether a new agent should be held on the Terminal (see `newAgentLens`). */
export function newAgentOnTerminal(): boolean {
  return useLensSettings.getState().newAgentLens === "terminal";
}
