import { memo, useLayoutEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { createPortal } from "react-dom";
import { ContextMenu, type MenuItem } from "../sidebar/ContextMenu";
import { StatusDot } from "../sidebar/StatusDot";
import { useApp } from "../store/app";
import { itemKey, type OpenItem } from "../store/openItems";
import type { MachineView, PaneView } from "../lib/types";
import { CloseIcon, FileIcon } from "../ui/icons";

interface Entry {
  key: string;
  label: string;
  /** Hover text: where the item lives, then what it is. */
  title: string;
  /** Said after the label when another tab has the same one: an agent's workspace, a file's folder. */
  where: string;
  /** Set for an agent item; a file item shows an icon instead. */
  pane?: PaneView;
}

function entries(machines: Record<string, MachineView>, items: OpenItem[]): Entry[] {
  return items.flatMap((item): Entry[] => {
    const key = itemKey(item);
    if (item.kind === "file") {
      const place = placeOf(machines, item.ws.machine_id, item.ws.session, item.ws.workspace_id);
      const parts = item.rel.split("/");
      const where = parts.length > 1 ? parts[parts.length - 2] : place?.split(" · ")[1] ?? "";
      return place ? [{ key, label: parts[parts.length - 1], title: `${place} · ${item.rel}`, where }] : [];
    }
    const { machine_id, session, pane_id } = item.ref;
    const machine = machines[machine_id];
    for (const w of machine?.sessions.find((s) => s.name === session)?.workspaces ?? [])
      for (const t of w.tabs)
        for (const pane of t.panes)
          if (pane.pane_id === pane_id) return [{ key, label: pane.title, title: `${machine.label}/${session} · ${w.label} · ${pane.title}`, where: w.label, pane }];
    return [];
  });
}

function placeOf(machines: Record<string, MachineView>, machine_id: string, session: string, workspace_id: string): string | null {
  const machine = machines[machine_id];
  const w = machine?.sessions.find((s) => s.name === session)?.workspaces.find((x) => x.workspace_id === workspace_id);
  return w ? `${machine.label}/${session} · ${w.label}` : null;
}

/** The agents and files opened in any session, like an editor's open files. */
type Side = "before" | "after";

/** Which half of the tab under the pointer: the dragged tab lands on that side of it. */
const sideOf = (e: DragEvent): Side => {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX < r.left + r.width / 2 ? "before" : "after";
};

const TAB_TYPE = "application/x-herdr-open-item";

export const OpenStrip = memo(function OpenStrip() {
  const machines = useApp((s) => s.machines);
  const { items, preview, active } = useApp((s) => s.openItems);
  const activate = useApp((s) => s.activateItem);
  const pin = useApp((s) => s.pinItem);
  const closeItems = useApp((s) => s.closeItems);
  const moveItem = useApp((s) => s.moveItem);
  const [menu, setMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  // The tab being dragged, and the tab and side it would land on.
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ key: string; side: Side } | null>(null);
  const tabs = entries(machines, items);
  const strip = useRef<HTMLDivElement>(null);
  // The strip hides its scrollbar, so the open tab is scrolled into view when it changes or opens.
  useLayoutEffect(() => {
    const el = strip.current;
    const tab = el?.querySelector<HTMLElement>(".files-tab-item.active");
    if (!el || !tab) return;
    const t = tab.getBoundingClientRect();
    const s = el.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
    if (t.left < s.left + pad) el.scrollLeft += t.left - s.left - pad;
    else if (t.right > s.left + el.clientWidth - pad) el.scrollLeft += t.right - s.left - el.clientWidth + pad;
  }, [active, tabs.length]);
  if (tabs.length === 0) return null;
  const twice = (label: string) => tabs.filter((t) => t.label === label).length > 1;

  const close = (key: string) => closeItems(key, "one");
  // Remove, not Close: an item leaves the strip and its pane keeps running, unlike a sidebar row's
  // Close pane / Close tab. Commands that would remove nothing are left out.
  const menuItems = (key: string): MenuItem[] => {
    const at = tabs.findIndex((e) => e.key === key);
    const list: MenuItem[] = [{ label: "Remove", icon: CloseIcon, onSelect: () => close(key) }];
    if (tabs.length > 1) list.push({ label: "Remove Others", icon: CloseIcon, onSelect: () => closeItems(key, "others") });
    if (at < tabs.length - 1) list.push({ label: "Remove to the Right", icon: CloseIcon, onSelect: () => closeItems(key, "right") });
    list.push({ label: "Remove All", icon: CloseIcon, onSelect: () => closeItems(key, "all") });
    return list;
  };

  return (
    // the strip's empty end is the top bar's, and drags the window
    <div
      ref={strip}
      className="files-tabs agent-tabs"
      role="tablist"
      aria-label="Open items"
      data-tauri-drag-region
      // a mouse wheel scrolls the tabs sideways; a trackpad's sideways swipe already does
      onWheel={(e) => {
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
      }}
    >
      {tabs.map(({ key, label, title, where, pane }) => {
        const isActive = key === active;
        const state = `${isActive ? " active" : ""}${key === preview ? " preview" : ""}`;
        const drop = over?.key === key ? ` drop-${over.side}` : "";
        const onDragOver = (e: DragEvent) => {
          if (!dragging || dragging === key) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          const side = sideOf(e);
          setOver((p) => (p?.key === key && p.side === side ? p : { key, side }));
        };
        return (
          // The tab and its close button are siblings: a tab must not contain another control.
          <div
            key={key}
            role="none"
            title={title}
            className={`files-tab-item${state}${dragging === key ? " dragging" : ""}${drop}`}
            draggable
            onDragStart={(e) => {
              // WebKit starts a drag only when it carries data.
              e.dataTransfer.setData(TAB_TYPE, key);
              e.dataTransfer.effectAllowed = "move";
              setDragging(key);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragEnter={onDragOver}
            onDragOver={onDragOver}
            onDragLeave={(e) => {
              // By the pointer, not `relatedTarget`, which WebKit may leave null.
              const r = e.currentTarget.getBoundingClientRect();
              if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return;
              setOver((p) => (p?.key === key ? null : p));
            }}
            onDrop={(e) => {
              const from = dragging;
              setDragging(null);
              setOver(null);
              if (!from || from === key) return;
              e.preventDefault();
              moveItem(from, key, sideOf(e));
            }}
            onClick={() => activate(key)}
            onDoubleClick={() => pin(key)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, key });
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                close(key);
              }
            }}
          >
            {pane ? <StatusDot status={pane.status} /> : <FileIcon aria-hidden="true" />}
            <span
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`files-tab${state}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activate(key);
                }
              }}
            >
              <span className="files-tab-name">
                {label}
                {twice(label) && where && <span className="files-tab-where"> · {where}</span>}
              </span>
            </span>
            <button
              type="button"
              className="files-tab-close"
              aria-label={`Remove ${label}`}
              title={pane ? "Remove from Open strip (the pane keeps running)" : "Remove from Open strip"}
              onClick={(e) => {
                e.stopPropagation();
                close(key);
              }}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
      {/* Out of the tablist, and fixed to the window rather than to an animating ancestor. */}
      {menu && createPortal(<ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.key)} onClose={() => setMenu(null)} />, document.body)}
    </div>
  );
});
