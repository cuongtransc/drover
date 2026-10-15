import { useContext, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { openLocalFile, revealLocalFile } from "../lib/ipc";
import { useApp } from "../store/app";
import { openInFiles } from "../files/openPath";
import { resolveRoot } from "../files/root";
import { ContextMenu } from "../sidebar/ContextMenu";
import { FolderIcon } from "../ui/icons";
import { showToast } from "../ui/Toast";
import type { WorkspaceRef } from "../workspaces/folder";
import { ChatPaneContext } from "./images";
import { parsePathRef, pathTarget } from "./pathLinks";

const message = (e: unknown) => String((e as { message?: string } | null)?.message ?? e);

/**
 * Inline code in a chat message. A file path becomes a link that opens in Files at its `:line`,
 * rooted at the pane's workspace folder, or at the file's own folder when it is outside. Cmd+click
 * on this Mac hands it to macOS instead, and its right-click menu reveals it in Finder. Anything else, or a path this app cannot reach, renders as
 * plain code. `plain` is a path written in prose: its link holds the text as it was, not code.
 */
export function PathCode({ text, children, plain }: { text: string; children?: ReactNode; plain?: boolean }) {
  const pane = useContext(ChatPaneContext);
  const ref = useMemo(() => parsePathRef(text), [text]);
  const machine = useApp((s) => (pane && ref ? s.machines[pane.machine_id] : undefined));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
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
  return (
    <>
      <a
        className={plain ? "chat-path chat-path-plain" : "chat-path"}
        href={target.abs}
        title={local ? "Open in Files · ⌘-click: open on this Mac · right-click: Reveal in Finder" : `Open in Files, from ${machine?.label ?? pane?.machine_id}`}
        onClick={(e) => {
          e.preventDefault();
          open(local && e.metaKey);
        }}
        onContextMenu={(e) => {
          if (!local) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {plain ? children : <code>{children}</code>}
      </a>
      {menu &&
        createPortal(
          <ContextMenu x={menu.x} y={menu.y} items={[{ label: "Reveal in Finder", icon: FolderIcon, onSelect: reveal }]} onClose={() => setMenu(null)} />,
          document.body,
        )}
    </>
  );
}
