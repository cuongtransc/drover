import { useEffect, useRef, type MouseEvent } from "react";
import { useApp } from "../store/app";
import { useActions } from "./actions";
import { addGroup, deleteGroup, renameGroup, sessionKey, useLayout } from "./groups";
import { useSessionFilter, useSessionQuery, useSidebarSessions } from "./activeFilter";
import type { LayoutNode, RGroup, RNode, RSession, SessionKey } from "./groups";
import { foldStopped, isStopped } from "./stoppedFold";
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
      {open && group.children.length > 0 && <Nodes nodes={group.children} level={group.id} className="children" />}
    </li>
  );
}

/** The fold of a level's stopped Sessions: `root` for the top of the tree, else the group's id. */
const stoppedKey = (level: string) => `stopped:${level}`;
const ROOT = "root";

/** One level of the tree. Its stopped Sessions go last and two or more fold into one row (stoppedFold.ts),
 *  except while words are typed, so what they found shows. */
function Nodes({ nodes, level, className }: { nodes: RNode[]; level: string; className: string }) {
  const searching = useSessionQuery((s) => s.query.trim() !== "");
  const viewed = useApp((s) => (s.viewed ? sessionKey(s.viewed.machine_id, s.viewed.session) : null));
  const { nodes: shown, folded } = searching ? { nodes, folded: [] } : foldStopped(nodes, viewed);
  const row = (n: RNode) => (n.kind === "group" ? <GroupRow key={n.id} group={n} /> : <SessionRow key={n.key} node={n} />);
  return (
    <ul className={className}>
      {shown.map(row)}
      {folded.length > 0 && <StoppedFold level={level} sessions={folded} />}
    </ul>
  );
}

function StoppedFold({ level, sessions }: { level: string; sessions: RSession[] }) {
  const key = stoppedKey(level);
  const open = useApp((s) => s.expanded[key] ?? false);
  const toggle = useApp((s) => s.toggle);
  return (
    <li className="stopped-fold">
      <button type="button" className="row" aria-expanded={open} onClick={() => toggle(key, open)}>
        <span className="slot" aria-hidden="true" />
        <span className="label">
          {sessions.length} stopped{open ? "" : ` · ${sessions.map((s) => s.session.name).join(", ")}`}
        </span>
      </button>
      {open && (
        <ul className="children">
          {sessions.map((s) => <SessionRow key={s.key} node={s} />)}
        </ul>
      )}
    </li>
  );
}

/** Each Session's level, to tell a Session moved into another level from one that only stopped. */
function levels(nodes: RNode[], level: string, out = new Map<SessionKey, string>()): Map<SessionKey, string> {
  for (const n of nodes) {
    if (n.kind === "group") levels(n.children, n.id, out);
    else out.set(n.key, level);
  }
  return out;
}

/** A stopped Session moved into another level opens that level's fold, so the user sees where it went. */
function useOpenOnMoveIn(tree: RNode[]) {
  const prev = useRef<Map<SessionKey, string> | null>(null);
  useEffect(() => {
    const now = levels(tree, ROOT);
    const before = prev.current;
    prev.current = now;
    if (!before) return;
    const stopped = new Set<SessionKey>();
    const walk = (nodes: RNode[]) => nodes.forEach((n) => (n.kind === "group" ? walk(n.children) : isStopped(n) && stopped.add(n.key)));
    walk(tree);
    const { expanded, toggle } = useApp.getState();
    for (const [key, level] of now) {
      const was = before.get(key);
      if (was === undefined || was === level || !stopped.has(key)) continue;
      if (!expanded[stoppedKey(level)]) toggle(stoppedKey(level), false);
    }
  }, [tree]);
}

/** Show under Active: every fold opens, so the stopped Sessions it brings back are on screen. */
function openStoppedFolds() {
  const ids = [ROOT];
  const walk = (nodes: LayoutNode[]) => nodes.forEach((n) => n.kind === "group" && (ids.push(n.id), walk(n.children)));
  walk(useLayout.getState().layout.tree);
  const { expanded, toggle } = useApp.getState();
  for (const id of ids) if (!expanded[stoppedKey(id)]) toggle(stoppedKey(id), false);
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
  useOpenOnMoveIn(tree);
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
      <Nodes nodes={tree} level={ROOT} className="tree section-list" />
      {narrowed && tree.length === 0 && <NoMatch />}
      {active && hidden > 0 && (
        <div className="filter-hidden">
          <span>{hidden} hidden · idle or stopped</span>
          <button type="button" className="link-btn" onClick={() => { setFilter("all"); openStoppedFolds(); }}>Show</button>
        </div>
      )}
      <div className={"tree-end" + indicatorClass(drag, "tree-end")} {...endDnd} />
    </section>
  );
}
