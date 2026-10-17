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

interface WrapStore {
  /** Whether the Files viewer and editor wrap long lines; one setting for every file. */
  on: boolean;
  toggle: () => void;
}

export const useWrap = create<WrapStore>((setState, get) => ({
  on: readRaw().filesWrap === true,
  toggle: () => {
    const on = !get().on;
    save({ filesWrap: on });
    setState({ on });
  },
}));
