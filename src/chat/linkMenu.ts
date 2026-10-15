import { useRef, useState, type MouseEvent } from "react";

export interface LinkMenuAt {
  x: number;
  y: number;
  /** The text selected when the menu opened, for its Copy item. */
  selected: string;
}

/**
 * The right-click menu of a link in Chat, which replaces WebKit's (whose Open Link would load the
 * target into the app). On macOS WebKit selects the link under the pointer between a right (or
 * Ctrl+) mousedown and `contextmenu`, whatever the page prevents: the selection from the mousedown
 * is put back before the menu reads it.
 */
export function useLinkMenu() {
  const [menu, setMenu] = useState<LinkMenuAt | null>(null);
  /** The selection when a menu click went down: a range, `null` for none, unset before one. */
  const before = useRef<Range | null | undefined>(undefined);
  const selected = () => window.getSelection()?.toString() ?? "";
  return {
    menu,
    close: () => setMenu(null),
    /** Opens the menu from the keyboard (⇧F10, the Menu key) at a point. */
    openAt: (x: number, y: number) => setMenu({ x, y, selected: selected() }),
    onMouseDown: (e: MouseEvent) => {
      if (e.button !== 2 && !(e.button === 0 && e.ctrlKey)) return;
      const sel = window.getSelection();
      before.current = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      const sel = window.getSelection();
      if (sel && before.current !== undefined) {
        sel.removeAllRanges();
        if (before.current) sel.addRange(before.current);
      }
      before.current = undefined;
      setMenu({ x: e.clientX, y: e.clientY, selected: selected() });
    },
  };
}
