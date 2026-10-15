import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { parsePathRef, pathTarget, type PathTarget } from "./pathLinks";
import { ChatItemContext, ChatPathsContext, type Found } from "./pathResolver";

const message = (e: unknown) => String((e as { message?: string } | null)?.message ?? e);

/**
 * Inline code in a chat message. A file path becomes a link that opens in Files at its `:line`,
 * rooted at the pane's workspace folder, or at the file's own folder when it is outside. In a Chat it
 * links only once the machine says where the file is: a relative path is looked for first where the
 * agent worked, then in the session's folder (`pathResolver`); one no place has stays code. Cmd+click
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
  const resolver = useContext(ChatPathsContext);
  const item = useContext(ChatItemContext);
  // Outside a Chat there is nothing to ask: the path links as written (undefined).
  const [found, setFound] = useState<Found | "pending">(() => (resolver && ref ? resolver.known(item, ref.path) : undefined));
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
  const home = machine?.home ?? null;
  const root = place?.root ?? null;

  useEffect(() => {
    if (!resolver || !ref || !place || found !== "pending") return;
    let gone = false;
    void resolver.resolve(item, ref.path, { root, home }).then((f) => {
      if (!gone) setFound(f);
    });
    return () => {
      gone = true;
    };
  }, [resolver, item, ref, place, found, root, home]);

  // Not known yet, or no place has it: code, not a link that leads nowhere.
  if (!place || !ref || found === "pending" || found === null) return plain ? <>{children}</> : <code>{children}</code>;
  const { wsRef } = place;
  const target = (found && pathTarget({ path: found, line: ref.line }, { root, home })) || place.target;
  const local = machine?.kind === "local";
  const at = (act: (t: PathTarget) => unknown) => () => act(target);
  const open = (target: PathTarget, mac: boolean) => {
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
  const reveal = (target: PathTarget) =>
    revealLocalFile(target.abs).catch((e) => showToast(`Cannot show ${target.abs} in Finder: ${message(e)}`));
  const copy = (text: string, done: string) =>
    writeText(text).then(
      () => showToast(done, { alert: false }),
      (e) => showToast(`Cannot copy: ${message(e)}`),
    );
  // Each item's keys work on the focused path (`onKeyDown`); the menu shows them.
  const items = (selected: string): MenuEntry[] => [
    { label: "Open in Files", icon: FileIcon, keys: "↩", onSelect: at((t) => open(t, false)) },
    ...(local
      ? [
          { label: "Open on this Mac", icon: LaptopIcon, keys: "⌘↩", onSelect: at((t) => open(t, true)) },
          { label: "Reveal in Finder", icon: FolderOpenIcon, keys: "⌥⌘R", onSelect: at(reveal) },
        ]
      : []),
    "sep",
    { label: "Copy Path", icon: FileCopyIcon, keys: "⌥⌘C", onSelect: at((t) => copy(t.abs, "Path copied")) },
    ...(selected ? [{ label: "Copy", icon: CopyIcon, keys: "⌘C", onSelect: () => copy(selected, "Copied") }] : []),
  ];
  /** The keys of the menu, on the focused path; Enter is the link's own click. */
  const onKey = (e: React.KeyboardEvent<HTMLAnchorElement>) => {
    const plainKey = !e.metaKey && !e.altKey && !e.ctrlKey;
    const cmd = e.metaKey && !e.ctrlKey && !e.shiftKey;
    let act: (() => void) | null = null;
    if ((e.key === "F10" && e.shiftKey && plainKey) || (e.key === "ContextMenu" && plainKey && !e.shiftKey)) {
      const r = e.currentTarget.getBoundingClientRect();
      act = () => setMenu({ x: r.left, y: r.bottom, selected: window.getSelection()?.toString() ?? "" });
    } else if (cmd && !e.altKey && e.key === "Enter") act = at((t) => open(t, local));
    else if (cmd && e.altKey && e.code === "KeyR") act = local ? at(reveal) : () => {};
    else if (cmd && e.altKey && e.code === "KeyC") act = at((t) => copy(t.abs, "Path copied"));
    if (!act) return;
    // Handled here: no app shortcut and no terminal sees it.
    e.preventDefault();
    e.stopPropagation();
    act();
  };
  return (
    <>
      <a
        className={plain ? "chat-path chat-path-plain" : "chat-path"}
        href={target.abs}
        title={local ? "Open in Files · ⌘-click: open on this Mac" : `Open in Files, from ${machine?.label ?? pane?.machine_id}`}
        onClick={(e) => {
          e.preventDefault();
          const mac = local && e.metaKey;
          at((t) => open(t, mac))();
        }}
        onMouseDown={(e) => {
          if (e.button !== 2 && !(e.button === 0 && e.ctrlKey)) return;
          const sel = window.getSelection();
          before.current = sel && sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
        }}
        onKeyDown={onKey}
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
