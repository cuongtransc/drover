import type { MouseEvent } from "react";
import { useApp } from "../store/app";
import { useActions } from "./actions";
import { addGroup, deleteGroup, renameGroup, useLayout } from "./groups";
import { useSessionFilter, useSessionQuery, useSidebarSessions } from "./activeFilter";
import type { RGroup, RNode } from "./groups";
import { Chevron, SessionRow } from "./Sidebar";
import { useDragState } from "./dnd";
import { indicatorClass, useTreeEndDnd, useTreeRowDnd } from "./useRowDnd";
import { FolderIcon, FolderPlusIcon, PencilIcon, PlusIcon, TrashIcon } from "../ui/icons";
import type { MenuItem } from "./ContextMenu";
import type { Actions } from "./actions";

/** "New session…" with a machine picker, offered only while some machine is connected. */
function newSessionItem(a: Actions, groupId?: string): MenuItem[] {
  const { machines } = useApp.getState();
  if (!Object.values(machines).some((m) => m.state === "connected")) return [];
  return [{ label: "New session…", icon: PlusIcon, onSelect: () => a.newSession(undefined, groupId) }];
}

function GroupRow({ group }: { group: RGroup }) {
  const key = `group:${group.id}`;
  // Words in the Sessions filter open it while they are there, so what they found shows.
  const searching = useSessionQuery((s) => s.query.trim() !== "");
  const open = useApp((s) => s.expanded[key] ?? true) || searching;
  const toggle = useApp((s) => s.toggle);
  const a = useActions();
  const drag = useDragState();
  const id = `group:${group.id}`;
  const dnd = useTreeRowDnd({ kind: "group", id: group.id }, id, { open, hasChildren: group.children.length > 0 });
  const onMenu = (e: MouseEvent) =>
    a?.menu(e, [
      ...newSessionItem(a, group.id),
      {
        label: "New subgroup",
        icon: FolderPlusIcon,
        onSelect: () =>
          a.rename(
            "New subgroup",
            "",
            async (label) => {
              useLayout.getState().update((l) => addGroup(l, group.id, label).layout);
              if (!(useApp.getState().expanded[key] ?? true)) toggle(key, false);
            },
            "Create",
          ),
      },
      { label: "Rename…", icon: PencilIcon, onSelect: () => a.rename("Rename group", group.label, async (label) => useLayout.getState().update((l) => renameGroup(l, group.id, label))) },
      { label: "Delete group", icon: TrashIcon, onSelect: () => a.guard(async () => useLayout.getState().update((l) => deleteGroup(l, group.id))) },
    ]);
  return (
    <li className="group">
      <button
        {...dnd}
        className={"row" + indicatorClass(drag, id)}
        aria-expanded={open}
        onClick={() => toggle(key, open)}
        onContextMenu={onMenu}
      >
        <span className="slot" aria-hidden="true"><Chevron open={open} /></span>
        <FolderIcon className="icon group-icon" />
        <span className="label">{group.label}</span>
      </button>
      {open && group.children.length > 0 && <Nodes nodes={group.children} />}
    </li>
  );
}

function Nodes({ nodes }: { nodes: RNode[] }) {
  return (
    <ul className="children">
      {nodes.map((n) => (n.kind === "group" ? <GroupRow key={n.id} group={n} /> : <SessionRow key={n.key} node={n} />))}
    </ul>
  );
}

/** An empty tree under the Sessions filter: what it filtered by, so the user knows what to undo. */
function NoMatch() {
  const query = useSessionQuery((s) => s.query.trim());
  const chip = useSessionQuery((s) => s.machine);
  const label = useApp((s) => (chip ? s.machines[chip]?.label : undefined));
  const on = label ? ` on ${label}` : "";
  return <p className="filter-empty">{query ? `No session${on} matches "${query}"` : `No session${on}`}</p>;
}

export function GroupTree() {
  const { tree, hidden, active, narrowed } = useSidebarSessions();
  const setFilter = useSessionFilter((s) => s.setFilter);
  const a = useActions();
  const endDnd = useTreeEndDnd();
  const drag = useDragState();
  // Right-click on the area's empty space; a row's own menu (which prevents default) wins.
  const onMenu = (e: MouseEvent) => {
    if (e.defaultPrevented) return;
    a?.menu(e, [
      ...newSessionItem(a),
      {
        label: "New group",
        icon: FolderPlusIcon,
        onSelect: () => a.rename("New group", "", async (label) => useLayout.getState().update((l) => addGroup(l, null, label).layout), "Create"),
      },
    ]);
  };
  return (
    <section aria-label="Groups" className="groups-section" onContextMenu={onMenu}>
      <ul className="tree section-list">
        {tree.map((n) => (n.kind === "group" ? <GroupRow key={n.id} group={n} /> : <SessionRow key={n.key} node={n} />))}
      </ul>
      {narrowed && tree.length === 0 && <NoMatch />}
      {active && hidden > 0 && (
        <div className="filter-hidden">
          <span>{hidden} hidden · idle or stopped</span>
          <button type="button" className="link-btn" onClick={() => setFilter("all")}>Show</button>
        </div>
      )}
      <div className={"tree-end" + indicatorClass(drag, "tree-end")} {...endDnd} />
    </section>
  );
}
