import { memo, useEffect, useMemo, useState } from "react";
import { DragContext, useDragState } from "./dnd";
import type { Drag, Indicator } from "./dnd";
import { indicatorClass, useTreeRowDnd } from "./useRowDnd";
import type { MouseEvent, ReactNode } from "react";
import {
  machineDisconnect,
  machineRemove,
  machineUpdate,
  sessionDelete,
  sessionRename,
  sessionsRefresh,
  sessionStart,
  sessionStop,
} from "../lib/ipc";
import type { MachineView } from "../lib/types";
import { beginSessionRename, endSessionRename, useApp } from "../store/app";
import { protectedIn, useProtect } from "../agents/protect";
import { busyIn } from "../agents/paneFilter";
import { StatusDot } from "./StatusDot";
import type { MenuItem } from "./ContextMenu";
import { ActionsProvider, useActions } from "./actions";
import { forgetSessionFolders, moveSessionFolders } from "../workspaces/folder";
import {
  ChevronIcon,
  FolderInputIcon,
  LaptopIcon,
  PlayIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  ServerIcon,
  StopIcon,
  TrashIcon,
  UnplugIcon,
} from "../ui/icons";
import { forgetSessions, renameSessionKey, sessionKey, useLayout } from "./groups";
import { useSessionFilter, useSidebarSessions, useViewOrigin } from "./activeFilter";
import type { RBookmark, RSession } from "./groups";
import { GroupTree } from "./GroupTree";
import { BookmarkRow } from "./BookmarkRow";
import { ActiveToggle } from "./ActiveToggle";
import { ProjectRows, useProjects } from "./ProjectRows";

const hl = (status: string) => (status === "blocked" ? " blocked" : "");

export function Chevron({ open }: { open: boolean }) {
  return <ChevronIcon className={"icon chev" + (open ? " open" : "")} />;
}

export function SessionRow({ node }: { node: RSession }) {
  const { machine, session, key } = node;
  const machineId = machine.id;
  const viewed = useApp((s) => s.viewed?.machine_id === machineId && s.viewed.session === session.name);
  // Opened from a Bookmark, the Session is "current", not selected: the Bookmark row is the lit one.
  const clickedHere = useViewOrigin((s) => s.from === "sessions");
  const setOrigin = useViewOrigin((s) => s.set);
  // A Session lists its projects, which carry what needs the user.
  const projects = useProjects(machine, session);
  // A Session with projects folds them; a fold keeps what asks for the user (ProjectRows).
  const foldKey = `session:${key}`;
  const unfolded = useApp((s) => s.expanded[foldKey] ?? true);
  const toggle = useApp((s) => s.toggle);
  const foldable = projects.rows.length > 0;
  const view = useApp((s) => s.view);
  const lit = viewed && clickedHere && !projects.current;
  const a = useActions();
  const drag = useDragState();
  const dnd = useTreeRowDnd({ kind: "session", key }, `session:${key}`);
  const online = machine.state === "connected";
  const moveItem = { label: "Move to group…", icon: FolderInputIcon, onSelect: () => a?.moveToGroup(key) };
  const onMenu = (e: MouseEvent) =>
    a?.menu(
      e,
      !online
        ? [moveItem]
        : session.running
        ? [
            { label: "New workspace…", icon: PlusIcon, onSelect: () => a.newWorkspace(machineId, session.name) },
            {
              label: "Stop session",
              icon: StopIcon,
              onSelect: () => {
                const prot = protectedIn(machineId, session.name, session.workspaces, useProtect.getState().marks);
                const busy = busyIn(machineId, session.name, session.workspaces, new Set(prot.map((p) => p.key)));
                a.confirm("Stop session", `Stop session "${session.name}"? Running agents will end.`, "Stop", () => sessionStop(machineId, session.name), prot, { busy });
              },
            },
            moveItem,
          ]
        : [
            { label: "Start session", icon: PlayIcon, onSelect: () => a.guard(() => sessionStart(machineId, session.name)) },
            moveItem,
            ...(session.name === "default" ? [] : [{
              label: "Rename session…",
              icon: PencilIcon,
              // herdr has no rename: the backend moves the stopped session's directory.
              onSelect: () =>
                a.rename("Rename session", session.name, (to) => {
                  const toKey = sessionKey(machineId, to);
                  // Preserve the source through an early snapshot, without changing
                  // either Session's layout if the backend rejects the rename.
                  beginSessionRename(key);
                  return sessionRename(machineId, session.name, to).then(() => {
                    moveSessionFolders(machineId, session.name, to);
                    useLayout.getState().update((l) => renameSessionKey(l, key, toKey));
                    const v = useApp.getState().viewed;
                    if (v?.machine_id === machineId && v.session === session.name) view({ machine_id: machineId, session: to });
                  }).finally(() => endSessionRename(key));
                }),
            }]),
            {
              label: "Delete session…",
              icon: TrashIcon,
              onSelect: () =>
                a.confirm("Delete session", `Delete session "${session.name}"? This can't be undone.`, "Delete", () =>
                  sessionDelete(machineId, session.name).then(() => {
                    forgetSessionFolders(machineId, session.name);
                    useLayout.getState().update((l) => forgetSessions(l, [key]));
                  }),
                ),
            },
          ],
    );
  const open = () => {
    setOrigin("sessions");
    view({ machine_id: machineId, session: session.name });
  };
  const onClick = !online
    ? undefined
    : session.running
      ? () => {
          // Like a folder in VS Code: every click opens the Session and folds or unfolds it.
          open();
          if (foldable) toggle(foldKey, unfolded);
        }
      :() => a?.guard(() => sessionStart(machineId, session.name).then(open));
  return (
    <li className={"session" + (session.running ? "" : " stopped") + (online ? "" : " offline")}>
      <button
        {...dnd}
        className={"row" + (lit ? " active" : viewed && !projects.current ? " current" : "") + indicatorClass(drag, `session:${key}`)}
        aria-current={lit ? "true" : undefined}
        aria-label={session.running ? undefined : `Start ${session.name}`}
        aria-disabled={online ? undefined : true}
        onClick={onClick}
        onContextMenu={onMenu}
        onKeyDown={(e) => {
          if (!foldable) return;
          if ((e.key === "ArrowLeft" && unfolded) || (e.key === "ArrowRight" && !unfolded)) {
            e.preventDefault();
            toggle(foldKey, unfolded);
          }
        }}
      >
        {/* The fold button sits over this slot. */}
        <span className="slot" aria-hidden="true" />
        <span className="session-name">
          <span className="label">{session.name}</span>
        </span>
        {machine.kind !== "local" && (
          <span className="machine-chip">
            <span className="badge-label">{machine.label}</span>
          </span>
        )}
      </button>
      {foldable && (
        // A button of its own, so it cannot sit in the row's button: it covers the row's slot.
        <button type="button" className="fold-toggle" aria-label={`${unfolded ? "Fold" : "Unfold"} ${session.name}`} aria-expanded={unfolded} onClick={() => toggle(foldKey, unfolded)}>
          <Chevron open={unfolded} />
        </button>
      )}
      {foldable && <ProjectRows machineId={machineId} session={session.name} rows={projects.rows} current={projects.current} folded={!unfolded} onUnfold={() => toggle(foldKey, false)} />}
      {session.error && <p className="error">{session.error.message}</p>}
    </li>
  );
}

/** "herdr 0.8.1 — needs protocol 22", with the version taken from the probe error. */
function incompatibleText(m: MachineView): string {
  const version = m.version ?? /^herdr (\S+?),/.exec(m.error?.message ?? "")?.[1] ?? "?";
  return `herdr ${version} — needs protocol 22`;
}

function HerdrPathEdit({ machineId }: { machineId: string }) {
  const [path, setPath] = useState("");
  const a = useActions();
  const save = () => a?.guard(() => machineUpdate(machineId, path.trim() || null));
  return (
    <div className="machine-actions">
      <input
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        aria-label="herdr path"
        value={path}
        placeholder="/path/to/herdr"
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
      />
      <button className="btn btn-xs" onClick={save}>Set</button>
    </div>
  );
}

function MachineNode({ machine }: { machine: MachineView }) {
  const a = useActions();
  const ssh = machine.kind === "ssh";
  const ok = machine.state === "connected";
  // Any error can be retried (e.g. after installing herdr); ssh goes batch first, then the dialog.
  const needsConnect = (ssh && machine.state === "disconnected") || machine.state === "error";
  const notFound = ssh && machine.error?.code === "herdr_not_found";
  let message = machine.error?.message ?? machine.state;
  if (machine.state === "incompatible") message = incompatibleText(machine);
  else if (notFound) message = "herdr not found — set its path";
  const items: MenuItem[] = a
    ? [
        ...(ok
          ? [
              { label: "New session…", icon: PlusIcon, onSelect: () => a.newSession(machine.id) },
              { label: "Refresh sessions", icon: RefreshIcon, onSelect: () => a.guard(() => sessionsRefresh(machine.id)) },
            ]
          : []),
        ...(ssh
          ? [
              ...(machine.state !== "disconnected" ? [{ label: "Disconnect", icon: UnplugIcon, onSelect: () => a.guard(() => machineDisconnect(machine.id)) }] : []),
              {
                label: "Remove machine…",
                icon: TrashIcon,
                onSelect: () =>
                  a.confirm("Remove machine", `Remove "${machine.label}"? Its sessions keep running on the machine.`, "Remove", () =>
                    machineRemove(machine.id).then(() => useApp.getState().removeMachine(machine.id)),
                  ),
              },
            ]
          : []),
      ]
    : [];
  return (
    <li className={"machine" + (ok ? "" : " offline")}>
      <button
        className={"row" + hl(machine.status)}
        onContextMenu={(e) => items.length > 0 && a?.menu(e, items)}
      >
        {ssh ? <ServerIcon className="icon machine-icon" /> : <LaptopIcon className="icon machine-icon" />}
        <span className="label">{machine.label}</span>
        <StatusDot status={machine.status} />
      </button>
      {!ok && <p className="error">{message}</p>}
      {notFound && <HerdrPathEdit machineId={machine.id} />}
      {needsConnect && (
        <div className="machine-actions">
          <button className="btn btn-xs" onClick={() => a?.connect(machine)}>{ssh ? "Connect…" : "Retry"}</button>
        </div>
      )}
    </li>
  );
}

function AddMachine() {
  const a = useActions();
  return (
    <button className="section-action" aria-label="Add machine" title="Add machine" onClick={() => a?.addMachine()}>
      <PlusIcon />
    </button>
  );
}

function SectionHeader({ id, label, icon, defaultOpen = true }: { id: string; label: string; icon?: ReactNode; defaultOpen?: boolean }) {
  const open = useApp((s) => s.expanded[id] ?? defaultOpen);
  const toggle = useApp((s) => s.toggle);
  return (
    // The chevron follows the label, so it never shares a column with the rows' own chevrons.
    <button className="section-toggle" aria-expanded={open} onClick={() => toggle(id, open)}>
      {icon}
      {label}
      <Chevron open={open} />
    </button>
  );
}

/** The Sessions section: its header carries Active N (Active leaves out sessions with no agent
 *  work, see `isActiveSession`, in Bookmarks too), then the Groups tree. */
function SessionsSection({ kept }: { kept: number }) {
  const filter = useSessionFilter((s) => s.filter);
  const setFilter = useSessionFilter((s) => s.setFilter);
  const open = useApp((s) => s.expanded["sessions"] ?? true);
  return (
    <section aria-label="Sessions" className="sessions-section">
      <div className="section-head">
        <SectionHeader id="sessions" label="Sessions" />
        <ActiveToggle on={filter === "active"} count={kept} onChange={(on) => setFilter(on ? "active" : "all")} />
      </div>
      {open && <GroupTree />}
    </section>
  );
}

/** Bookmarked projects (ADR 0006), in the user's order; a project row's menu adds one. */
function BookmarksSection({ bookmarks }: { bookmarks: RBookmark[] }) {
  const open = useApp((s) => s.expanded["bookmarks"] ?? true);
  return (
    <section aria-label="Bookmarks">
      <SectionHeader id="bookmarks" label="Bookmarks" />
      {open && (
        // Under the section header like any section's rows, but not boxed as a Group.
        <ul className="tree section-list">
          {bookmarks.map((b, i) => <BookmarkRow key={b.key} bookmark={b} nextKey={bookmarks[i + 1]?.key ?? null} />)}
        </ul>
      )}
    </section>
  );
}

// Takes no props: memo keeps it out of App's re-renders; it reads the store itself.
export const Sidebar = memo(function Sidebar() {
  const machines = useApp((s) => s.machines);
  const order = useApp((s) => s.order);
  const { bookmarks, kept } = useSidebarSessions();
  // Machines fold by default once there is more than one: the loop rarely needs them.
  const machinesByDefault = order.length <= 1;
  const machinesOpen = useApp((s) => s.expanded["machines"] ?? machinesByDefault);
  const [dragging, setDragging] = useState<Drag | null>(null);
  const [indicator, setIndicator] = useState<Indicator | null>(null);
  const dragState = useMemo(() => ({ dragging, setDragging, indicator, setIndicator }), [dragging, indicator]);
  // Safety net: the source row can be remounted by a drop, so its own `dragend` may never reach React.
  useEffect(() => {
    if (!dragging) return;
    const end = () => {
      setDragging(null);
      setIndicator(null);
    };
    document.addEventListener("dragend", end);
    document.addEventListener("drop", end);
    return () => {
      document.removeEventListener("dragend", end);
      document.removeEventListener("drop", end);
    };
  }, [dragging]);
  return (
    <ActionsProvider>
      <DragContext.Provider value={dragState}>
        {bookmarks.length > 0 && <BookmarksSection bookmarks={bookmarks} />}
        <SessionsSection kept={kept} />
        <section aria-label="Machines" className="machines-section">
          <div className="section-head">
            <SectionHeader id="machines" label="Machines" defaultOpen={machinesByDefault} />
            <AddMachine />
          </div>
          {machinesOpen && (
            <ul className="tree">
              {order.map((id) => machines[id] && <MachineNode key={id} machine={machines[id]} />)}
            </ul>
          )}
        </section>
      </DragContext.Provider>
    </ActionsProvider>
  );
});
