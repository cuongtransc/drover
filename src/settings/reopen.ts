import { create } from "zustand";

/** Shared with the other settings writers: one JSON object, each writer merges its own keys. */
const SETTINGS_KEY = "drover:settings";

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

/** Whether the Open items left at quit open again at launch. On by default. */
export function loadReopenItems(): boolean {
  return readRaw().reopenItems !== false;
}

export const useReopenItems = create<{ on: boolean; setOn: (on: boolean) => void }>((set) => ({
  on: loadReopenItems(),
  setOn: (on) => {
    save({ reopenItems: on });
    set({ on });
  },
}));
