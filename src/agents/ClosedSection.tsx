import { useState } from "react";
import type { SessionView } from "../lib/types";
import { useApp } from "../store/app";
import { useActions } from "../sidebar/actions";
import { forgetKept, setKept, useLayout } from "../sidebar/groups";
import type { ProjectKey } from "../sidebar/groups";
import { closedKept } from "../workspaces/kept";
import type { ClosedKept } from "../workspaces/kept";
import { reopenKept } from "../workspaces/keptActions";
import { folderName } from "../workspaces/folder";
import { ChevronIcon, FolderOpenIcon, TerminalIcon, TrashIcon } from "../ui/icons";
import type { MenuItem } from "../sidebar/ContextMenu";

/**
 * The Session's kept Workspaces no live Workspace carries, folded under "Closed" at the
 * foot of the PANES list. A row reopens its Workspace in the folder it was kept with, and
 * stays disabled until that settles, so a double click opens one Workspace, not two.
 */
export function ClosedSection({ machineId, session }: { machineId: string; session: SessionView }) {
  const a = useActions();
  const layout = useLayout((s) => s.layout);
  const machine = useApp((s) => s.machines[machineId]);
  const foldKey = `closed:${machineId}/${session.name}`;
  const open = useApp((s) => s.expanded[foldKey] ?? false);
  const toggle = useApp((s) => s.toggle);
  const [pending, setPending] = useState<ReadonlySet<ProjectKey>>(new Set());
  if (!machine) return null;
  const closed = closedKept(layout, machine, session);
  if (closed.length === 0) return null;
  const setPendingKey = (key: ProjectKey, on: boolean) =>
    setPending((p) => {
      const next = new Set(p);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const reopen = (c: ClosedKept) => {
    // The pending contract covers every reopen route, not just the row's buttons.
    if (pending.has(c.key)) return;
    setPendingKey(c.key, true);
    a?.guard(() => reopenKept(machineId, session.name, c).finally(() => setPendingKey(c.key, false)));
  };
  const menuFor = (c: ClosedKept): MenuItem[] =>
    a
      ? [
          { label: "Reopen", icon: TerminalIcon, disabled: pending.has(c.key), onSelect: () => reopen(c) },
          {
            label: "Change folder…",
            icon: FolderOpenIcon,
            onSelect: () => a.changeFolder(machineId, c.folder ?? "", (path) => useLayout.getState().update((l) => setKept(l, c.key, path.trim() || null))),
          },
          { label: "Forget", icon: TrashIcon, onSelect: () => useLayout.getState().update((l) => forgetKept(l, c.key)) },
        ]
      : [];
  return (
    <section className="closed-ws" aria-label="Closed">
      <button className="closed-toggle" aria-expanded={open} onClick={() => toggle(foldKey, open)}>
        <ChevronIcon className={"icon chev" + (open ? " open" : "")} />
        Closed
        <span className="project-meta">{closed.length}</span>
      </button>
      {open &&
        closed.map((c) => (
          <div key={c.key} className="ws-head closed-row" onContextMenu={(e) => a?.menu(e, menuFor(c))}>
            <span className="closed-dot" aria-hidden="true" />
            <button className="ws-label closed-label" title={c.folder ?? undefined} disabled={pending.has(c.key)} onClick={() => reopen(c)}>
              {c.label}
            </button>
            <span className="ws-folder">{c.folder ? folderName(c.folder) : ""}</span>
            <button className="ws-add" aria-label={`Reopen ${c.label}`} disabled={pending.has(c.key)} onClick={() => reopen(c)}>
              <TerminalIcon />
            </button>
          </div>
        ))}
    </section>
  );
}
