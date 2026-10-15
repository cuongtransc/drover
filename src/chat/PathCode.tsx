import { useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openLocalFile, revealLocalFile } from "../lib/ipc";
import { useApp } from "../store/app";
import { openInFiles } from "../files/openPath";
import { resolveRoot } from "../files/root";
import { ContextMenu, type MenuEntry } from "../sidebar/ContextMenu";
import { CopyIcon, FileCopyIcon, FileIcon, FolderOpenIcon, LaptopIcon } from "../ui/icons";
import { showToast } from "../ui/Toast";
import type { WorkspaceRef } from "../workspaces/folder";
import { ChatPaneContext } from "./images";
import { parsePathRef, pathTarget } from "./pathLinks";

const message = (e: unknown) => String((e as { message?: string } | null)?.message ?? e);

/**
 * Inline code in a chat message. A file path becomes a link that opens in Files at its `:line`,
 * rooted at the pane's workspace folder, or at the file's own folder when it is outside. Cmd+click
 * on this Mac hands it to macOS instead. Its right-click menu offers both, Reveal in Finder (this
 * Mac), Copy Path, and Copy for a selection, in place of WebKit's menu (whose Open Link would load
 * the file into the app). Anything else, or a path this app cannot reach, renders as plain code.
 * `plain` is a path written in prose: its link holds the text as it was, not code.
 */
export function PathCode({ text, children, plain }: { text: string; children?: ReactNode; plain?: boolean }) {
  const pane = useContext(ChatPaneContext);
  const ref = useMemo(() => parsePathRef(text), [text]);
  const machine = useApp((s) => (pane && ref ? s.machines[pane.machine_id] : undefined));
  const [menu, setMenu] = useState<{ x: number; y: number; selected: string } | null>(null);
  /** The selection when a menu click went down: a range, `null` for none, unset before one. */
  const before = useRef<Range | null | undefined>(undefined);
  const place = useMemo(() => {
    if (!pane || !ref || !machine) return null;
    const ws = machine.sessions.find((s) => s.name === pane.session)?.workspaces.find((w) => w.tabs.some((t) => t.panes.some((p) => p.pane_id === pane.pane_id)));
    if (!ws) return null;
    const wsRef: WorkspaceRef = { machine_id: pane.machine_id, session: pane.session, workspace_id: ws.workspace_id };
    const cwd = ws.tabs.flatMap((t) => t.panes).find((p) => p.pane_id === pane.pane_id)?.cwd ?? null;
    const root = resolveRoot(wsRef, ws, cwd)?.path ?? null;
    const target = pathTarget(ref, { root, home: machine.home ?? null });
    return target && { wsRef, root, target };
  }, [pane, ref, machine]);

  if (!place) return plain ? <>{children}</> : <code>{children}</code>;
  const { wsRef, root, target } = place;
  const local = machine?.kind === "local";
  const open = (mac: boolean) => {
    if (!mac) {
      // A "files" target is inside `root`, so it is set.
      const base = target.kind === "files" && root ? root : target.abs.slice(0, target.abs.lastIndexOf("/")) || "/";
      openInFiles(wsRef, base, target.abs, target.line, pane ?? undefined);
      return;
    }
    openLocalFile(target.abs).then(
      (done) => {
        if (done === "revealed") showToast(`Shown in Finder: ${target.abs}`, { alert: false });
      },
      (e) => showToast(`Cannot open ${target.abs}: ${message(e)}`),
    );
  };
  const reveal = () =>
    revealLocalFile(target.abs).catch((e) => showToast(`Cannot show ${target.abs} in Finder: ${message(e)}`));
  const copy = (text: string, done: string) =>
    writeText(text).then(
      () => showToast(done, { alert: false }),
      (e) => showToast(`Cannot copy: ${message(e)}`),
    );
  const items = (selected: string): MenuEntry[] => [
    { label: "Open in Files", icon: FileIcon, onSelect: () => open(false) },
    ...(local
      ? [
          { label: "Open on this Mac", icon: LaptopIcon, onSelect: () => open(true) },
          { label: "Reveal in Finder", icon: FolderOpenIcon, onSelect: reveal },
        ]
      : []),
    "sep",
    { label: "Copy Path", icon: FileCopyIcon, onSelect: () => copy(target.abs, "Path copied") },
    ...(selected ? [{ label: "Copy", icon: CopyIcon, onSelect: () => copy(selected, "Copied") }] : []),
  ];
  return (
    <>
      <a
        className={plain ? "chat-path chat-path-plain" : "chat-path"}
        href={target.abs}
        title={local ? "Open in Files · ⌘-click: open on this Mac" : `Open in Files, from ${machine?.label ?? pane?.machine_id}`}
        onClick={(e) => {
          e.preventDefault();
          open(local && e.metaKey);
        }}
        onMouseDown={(e) => {
          if (e.button !== 2 && !(e.button === 0 && e.ctrlKey)) return;
          const sel = window.getSelection();
          before.current = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          // WebKit selects the link between the mousedown and this event; put back what was selected.
          const sel = window.getSelection();
          if (sel && before.current !== undefined) {
            sel.removeAllRanges();
            if (before.current) sel.addRange(before.current);
          }
          before.current = undefined;
          setMenu({ x: e.clientX, y: e.clientY, selected: sel?.toString() ?? "" });
        }}
      >
        {plain ? children : <code>{children}</code>}
      </a>
      {menu &&
        createPortal(
          <ContextMenu x={menu.x} y={menu.y} items={items(menu.selected)} onClose={() => setMenu(null)} />,
          document.body,
        )}
    </>
  );
}
