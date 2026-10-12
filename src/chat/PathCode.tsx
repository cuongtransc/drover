import { useContext, useMemo, type ReactNode } from "react";
import { openLocalFile } from "../lib/ipc";
import { useApp } from "../store/app";
import { openInFiles } from "../files/openPath";
import { resolveRoot } from "../files/root";
import { showToast } from "../ui/Toast";
import type { WorkspaceRef } from "../workspaces/folder";
import { ChatPaneContext } from "./images";
import { parsePathRef, pathTarget } from "./pathLinks";

const message = (e: unknown) => String((e as { message?: string } | null)?.message ?? e);

/**
 * Inline code in a chat message. A file path becomes a link: inside the pane's workspace folder it
 * opens in Files (at its `:line`), outside it opens on this Mac, or on another machine in a file tab
 * rooted at its own folder. Anything else, or a path this app cannot reach, renders as plain code.
 */
export function PathCode({ text, children }: { text: string; children?: ReactNode }) {
  const pane = useContext(ChatPaneContext);
  const ref = useMemo(() => parsePathRef(text), [text]);
  const machine = useApp((s) => (pane && ref ? s.machines[pane.machine_id] : undefined));
  const place = useMemo(() => {
    if (!pane || !ref || !machine) return null;
    const ws = machine.sessions.find((s) => s.name === pane.session)?.workspaces.find((w) => w.tabs.some((t) => t.panes.some((p) => p.pane_id === pane.pane_id)));
    if (!ws) return null;
    const wsRef: WorkspaceRef = { machine_id: pane.machine_id, session: pane.session, workspace_id: ws.workspace_id };
    const cwd = ws.tabs.flatMap((t) => t.panes).find((p) => p.pane_id === pane.pane_id)?.cwd ?? null;
    const root = resolveRoot(wsRef, ws, cwd)?.path ?? null;
    const target = pathTarget(ref, { root, home: machine.home ?? null, local: machine.kind === "local" });
    return target && { wsRef, root, target };
  }, [pane, ref, machine]);

  if (!place) return <code>{children}</code>;
  const { wsRef, root, target } = place;
  const open = () => {
    // A "files" target is inside `root`, so it is set.
    if (target.kind === "files" && root) {
      openInFiles(wsRef, root, target.abs, target.line);
      return;
    }
    if (target.kind === "remote") {
      openInFiles(wsRef, target.abs.slice(0, target.abs.lastIndexOf("/")) || "/", target.abs, target.line);
      return;
    }
    openLocalFile(target.abs).then(
      (done) => {
        if (done === "revealed") showToast(`Shown in Finder: ${target.abs}`, { alert: false });
      },
      (e) => showToast(`Cannot open ${target.abs}: ${message(e)}`),
    );
  };
  return (
    <a
      className="chat-path"
      href={target.abs}
      title={target.kind === "files" ? "Open in Files" : target.kind === "remote" ? `Open from ${machine?.label ?? pane?.machine_id}` : "Open on this Mac"}
      onClick={(e) => {
        e.preventDefault();
        open();
      }}
    >
      <code>{children}</code>
    </a>
  );
}
