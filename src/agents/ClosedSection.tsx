import type { SessionView } from "../lib/types";
import { useApp } from "../store/app";
import { useActions } from "../sidebar/actions";
import { forgetKept, setKept, useLayout } from "../sidebar/groups";
import { closedKept } from "../workspaces/kept";
import type { ClosedKept } from "../workspaces/kept";
import { isReopenPending, isRenaming, reopenKept, useRenameVersion, useReopenPending } from "../workspaces/keptActions";
import { folderName } from "../workspaces/folder";
import { ChevronIcon, FolderOpenIcon, TerminalIcon, TrashIcon } from "../ui/icons";
import type { MenuItem } from "../sidebar/ContextMenu";

/**
 * The Session's kept Workspaces no live Workspace carries, folded under "Closed workspaces"
 * at the foot of the Agents column, right above the Files panel. A row reopens its Workspace in the folder it was kept with, and
 * stays disabled until that settles, so a double click opens one Workspace, not two.
 */
export function ClosedSection({ machineId, session }: { machineId: string; session: SessionView }) {
  const a = useActions();
  const layout = useLayout((s) => s.layout);
  const machine = useApp((s) => s.machines[machineId]);
  const foldKey = `closed:${machineId}/${session.name}`;
  const open = useApp((s) => s.expanded[foldKey] ?? false);
  const toggle = useApp((s) => s.toggle);
  useRenameVersion();
  if (!machine) return null;
  // A key whose Workspace is being renamed is not closed: the snapshot may already carry the new label.
  const closed = closedKept(layout, machine, session).filter((c) => !isRenaming(c.key));
  if (closed.length === 0) return null;
  const reopen = (c: ClosedKept) => {
    if (isReopenPending(c.key)) return;
    a?.guard(() => reopenKept(machineId, session.name, c));
  };
  const menuFor = (c: ClosedKept): MenuItem[] =>
    a
      ? [
          { label: "Reopen", icon: TerminalIcon, disabled: isReopenPending(c.key), onSelect: () => reopen(c) },
          {
            label: "Change folder…",
            icon: FolderOpenIcon,
            onSelect: () => a.changeFolder(machineId, c.folder ?? "", (path) => useLayout.getState().update((l) => setKept(l, c.key, path.trim() || null))),
          },
          { label: "Forget", icon: TrashIcon, onSelect: () => useLayout.getState().update((l) => forgetKept(l, c.key)) },
        ]
      : [];
  return (
    <section className="closed-ws" aria-label="Closed workspaces">
      <button className="closed-toggle" aria-expanded={open} onClick={() => toggle(foldKey, open)}>
        <ChevronIcon className={"icon chev" + (open ? " open" : "")} />
        Closed workspaces
        <span className="project-meta">{closed.length}</span>
      </button>
      {open && (
        <div className="closed-rows">
          {closed.map((c) => <ClosedRow key={c.key} c={c} reopen={reopen} menuFor={menuFor} />)}
        </div>
      )}
    </section>
  );
}

function ClosedRow({
  c,
  reopen,
  menuFor,
}: {
  c: ClosedKept;
  reopen: (c: ClosedKept) => void;
  menuFor: (c: ClosedKept) => MenuItem[];
}) {
  const a = useActions();
  const pending = useReopenPending(c.key);
  return (
    <div className="ws-head closed-row" onContextMenu={(e) => a?.menu(e, menuFor(c))}>
      <span className="closed-dot" aria-hidden="true" />
      <button className="ws-label closed-label" title={c.folder ?? undefined} disabled={pending} onClick={() => reopen(c)}>
        {c.label}
      </button>
      <span className="ws-folder">{c.folder ? folderName(c.folder) : ""}</span>
      <button className="ws-add" aria-label={`Reopen ${c.label}`} disabled={pending} onClick={() => reopen(c)}>
        <TerminalIcon />
      </button>
    </div>
  );
}
