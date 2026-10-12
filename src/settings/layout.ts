import { create } from "zustand";

/** Shared with store.ts, theme.ts, lens.ts, newTab.ts, quickReplies.ts and notify.ts: one JSON object, each writer merges its own keys. */
const SETTINGS_KEY = "drover:settings";

/** Which columns show: all three, the Agents column and the main area, or the main area alone. */
export type Layout = "normal" | "sidebar-hidden" | "focus";
const LAYOUTS: Layout[] = ["normal", "sidebar-hidden", "focus"];

/** ⌘B toggles the sidebar, ⌘⇧B the focus layout. */
export type LayoutToggle = "sidebar" | "focus";

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

export function loadLayout(): Layout {
  const v = readRaw().layout;
  return LAYOUTS.includes(v as Layout) ? (v as Layout) : "normal";
}

/** Leaving focus, either toggle brings every column back. */
export function nextLayout(current: Layout, toggle: LayoutToggle): Layout {
  if (current === "focus") return "normal";
  if (toggle === "focus") return "focus";
  return current === "normal" ? "sidebar-hidden" : "normal";
}

interface LayoutStore {
  layout: Layout;
  toggle: (t: LayoutToggle) => void;
}

export const useLayout = create<LayoutStore>((setState, get) => ({
  layout: loadLayout(),
  toggle: (t) => {
    const layout = nextLayout(get().layout, t);
    save({ layout });
    setState({ layout });
  },
}));
