import { create } from "zustand";

const STORAGE_KEY = "drover:files-panel";

/** Open or collapsed and the dragged height, kept across launches; collapsed the first time. */
function load(): { collapsed: boolean; height: number | null } {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as { collapsed?: unknown; height?: unknown };
    return {
      collapsed: typeof p.collapsed === "boolean" ? p.collapsed : true,
      height: typeof p.height === "number" && p.height > 0 ? p.height : null,
    };
  } catch {
    return { collapsed: true, height: null };
  }
}

function save(s: { collapsed: boolean; height: number | null }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ collapsed: s.collapsed, height: s.height }));
  } catch {
    /* storage unavailable */
  }
}

interface FilesPanelState {
  /** Pixels of the panel; null is half the column. */
  height: number | null;
  collapsed: boolean;
  /** Bumped to focus the tree. */
  focusTick: number;
  /** Bumped to focus Go to file. */
  gotoTick: number;
  /** The ticks already acted on; a panel that mounts with a newer tick still has a request to act on. */
  focusHandled: number;
  gotoHandled: number;
  setHeight(px: number): void;
  setCollapsed(on: boolean): void;
  /** Expands the panel and asks for the tree's focus. */
  focusTree(): void;
  /** Expands the panel and asks for Go to file's focus. */
  focusGoto(): void;
  /** Marks the pending focus requests as acted on. */
  handled(which: "tree" | "goto" | "both"): void;
}

/** Layout of the Files panel: open or collapsed and its height persist, the focus requests do not. */
export const useFilesPanel = create<FilesPanelState>((set) => ({
  ...load(),
  focusTick: 0,
  gotoTick: 0,
  focusHandled: 0,
  gotoHandled: 0,
  setHeight: (height) => set({ height }),
  setCollapsed: (collapsed) => set({ collapsed }),
  focusTree: () => set((s) => ({ collapsed: false, focusTick: s.focusTick + 1 })),
  focusGoto: () => set((s) => ({ collapsed: false, gotoTick: s.gotoTick + 1 })),
  handled: (which) =>
    set((s) => ({
      focusHandled: which === "goto" ? s.focusHandled : s.focusTick,
      gotoHandled: which === "tree" ? s.gotoHandled : s.gotoTick,
    })),
}));

useFilesPanel.subscribe((s, prev) => {
  if (s.collapsed !== prev.collapsed || s.height !== prev.height) save(s);
});
