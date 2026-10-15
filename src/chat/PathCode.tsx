import { useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { filesFirstFile, openLocalFile, revealLocalFile } from "../lib/ipc";
import { useApp } from "../store/app";
import { openInFiles } from "../files/openPath";
import { resolveRoot } from "../files/root";
import { ContextMenu, type MenuEntry } from "../sidebar/ContextMenu";
import { CopyIcon, FileCopyIcon, FileIcon, FolderOpenIcon, LaptopIcon } from "../ui/icons";
import { showToast } from "../ui/Toast";
import type { WorkspaceRef } from "../workspaces/folder";
import { ChatPaneContext } from "./images";
import { ChatItemContext, ChatPathsContext } from "./pathContext";
import { pathCandidates } from "./pathHints";
import { parsePathRef, pathTarget, type PathTarget } from "./pathLinks";

const message = (e: unknown) => String((e as { message?: string } | null)?.message ?? e);

/**
 * Inline code in a chat message. A file path becomes a link that opens in Files at its `:line`,
 * rooted at the pane's workspace folder, or at the file's own folder when it is outside. A relative
 * path is looked for first where the agent worked (`pathCandidates`), then in the session's folder. Cmd+click
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
  const paths = useContext(ChatPathsContext);
  const item = useContext(ChatItemContext);
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
  const home = machine?.home ?? null;
  /** A relative path is looked for; an absolute one is where it says. */
  const lookup = !!pane && !!ref && !ref.path.startsWith("/") && !ref.path.startsWith("~/");
  /** The first place the machine has a relative path, or null (said in a toast) when none does. */
  const locate = async (): Promise<PathTarget | null> => {
    if (!pane || !ref) return target;
    const before = (item && paths?.order.get(item)) ?? Infinity;
    const places = pathCandidates(ref.path, paths?.hints ?? [], before, { root, home }).slice(0, 64);
    let found: string | null;
    try {
      found = await filesFirstFile(pane.machine_id, places);
    } catch {
      return target; // The machine cannot say: the session's folder, as before.
    }
    if (!found) {
      showToast(`Not found: ${ref.path} (looked in ${places.length} ${places.length === 1 ? "place" : "places"})`);
      return null;
    }
    return pathTarget({ path: found, line: ref.line }, { root, home });
  };
  const at = (act: (t: PathTarget) => unknown) => () => {
    if (!lookup) act(target);
    else void locate().then((t) => t && act(t));
  };
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
  const items = (selected: string): MenuEntry[] => [
    { label: "Open in Files", icon: FileIcon, onSelect: at((t) => open(t, false)) },
    ...(local
      ? [
          { label: "Open on this Mac", icon: LaptopIcon, onSelect: at((t) => open(t, true)) },
          { label: "Reveal in Finder", icon: FolderOpenIcon, onSelect: at(reveal) },
        ]
      : []),
    "sep",
    { label: "Copy Path", icon: FileCopyIcon, onSelect: at((t) => copy(t.abs, "Path copied")) },
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
          const mac = local && e.metaKey;
          at((t) => open(t, mac))();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          // Read now: opening the menu may clear the selection.
          setMenu({ x: e.clientX, y: e.clientY, selected: window.getSelection()?.toString() ?? "" });
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
