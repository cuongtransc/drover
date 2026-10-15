import { openNewTabHere } from "../agents/newTabShortcut";
import { closeItemsGuarded } from "../files/closeGuard";
import { useFilesPanel } from "../files/panelStore";
import { defaultLens } from "../lens";
import { paneKey } from "../lib/types";
import { useTriage } from "../main/triage";
import { useLayout } from "../settings/layout";
import { type FontZoom, zoomFont } from "../settings/store";
import { chosenLens, selectedPane, useApp } from "../store/app";
import { showToast } from "../ui/Toast";
import type { ActionId } from "./actions";

/** Actions an open dialog (`.overlay`) keeps from running: their keys may mean something there. */
const KEPT_BY_DIALOGS = new Set<ActionId>(["files.toggle", "files.goto", "item.remove", "item.prev", "item.next"]);

/** Whether an open dialog keeps `id` from running. */
export function keptByDialog(id: ActionId): boolean {
  return KEPT_BY_DIALOGS.has(id) && !!document.querySelector(".overlay");
}

const zoom = (z: FontZoom) => {
  const s = useApp.getState();
  const open = s.selected ? selectedPane(s)?.pane : null;
  if (!open || !s.selected) return false;
  zoomFont(defaultLens(open, chosenLens(s, paneKey(s.selected))), z);
  return true;
};
const leaveFocus = () => {
  if (useLayout.getState().layout === "focus") useLayout.getState().toggle("focus");
};

/**
 * Runs a Shortcut's action, from its menu item or its key. False when it did nothing (or a dialog
 * keeps it), leaving a key to the page.
 */
export function runAction(id: ActionId, opts: { setPaletteOpen: (f: (open: boolean) => boolean) => void }): boolean {
  if (keptByDialog(id)) return false;
  const run: Record<ActionId, () => boolean | void> = {
    // ⌘+ / ⌘− / ⌘0: the font of the view on screen, Terminal or Chat (iTerm, Ghostty).
    "font.bigger": () => zoom(1),
    "font.smaller": () => zoom(-1),
    "font.reset": () => zoom(0),
    // While the dashboard is open, the Jump key focuses its search instead.
    jump: () => (useApp.getState().dashboardOpen ? false : opts.setPaletteOpen((o) => !o)),
    "triage.next": () => useTriage.getState().step(1),
    "triage.prev": () => useTriage.getState().step(-1),
    board: () => useApp.getState().setDashboardOpen(!useApp.getState().dashboardOpen),
    "layout.sidebar": () => useLayout.getState().toggle("sidebar"),
    "layout.focus": () => useLayout.getState().toggle("focus"),
    "tabs.new": () =>
      void openNewTabHere().catch((err: unknown) =>
        showToast(`Could not open a new tab: ${(err as { message?: string } | null)?.message ?? String(err)}`),
      ),
    // Shown means expanded and not hidden by Focus, which hides the Agents column and the panel with it.
    "files.toggle": () => {
      const panel = useFilesPanel.getState();
      if (!panel.collapsed && useLayout.getState().layout !== "focus") return panel.setCollapsed(true);
      leaveFocus();
      panel.focusTree();
    },
    "files.goto": () => {
      leaveFocus();
      useFilesPanel.getState().focusGoto();
    },
    "item.remove": () => {
      const active = useApp.getState().openItems.active;
      if (active) void closeItemsGuarded(active, "one");
    },
    "item.prev": () => useApp.getState().cycleItems(-1),
    "item.next": () => useApp.getState().cycleItems(1),
  };
  return run[id]() !== false;
}
