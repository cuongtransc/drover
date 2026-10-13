import { useMemo } from "react";
import { idleLabel, useActiveKeptMs, useMinuteClock } from "../agents/paneFilter";
import type { MachineView, SessionView } from "../lib/types";
import { useApp } from "../store/app";
import { CheckIcon, StarIcon, StarOffIcon } from "../ui/icons";
import { firstWorkspaceFolder } from "../workspaces/folder";
import { useActions } from "./actions";
import { projectKey, setBookmarked, useLayout } from "./groups";
import { useSessionFilter, useSessionQuery, useViewOrigin } from "./activeFilter";
import { sessionProjects } from "./projects";
import type { ProjectRow } from "./projects";

/** The word a project row carries: only the states that ask something of the user have one. */
export const WORD: Partial<Record<ProjectRow["state"], string>> = { blocked: "Blocked", review: "Review" };

/** The Workspace holding the selected pane, when it is in this Session. */
function useSelectedWorkspace(machineId: string, session: SessionView): string | null {
  const selected = useApp((s) => (s.selected?.machine_id === machineId && s.selected.session === session.name ? s.selected.pane_id : null));
  return useMemo(
    () => (selected ? session.workspaces.find((w) => w.tabs.some((t) => t.panes.some((p) => p.pane_id === selected)))?.workspace_id ?? null : null),
    [selected, session],
  );
}

/** A Session's projects (its Workspaces with agent work; every one under All) as rows under it. Under
 *  words in the Sessions filter, every one they found (`match`: some; none given: all). */
export function useProjects(machine: MachineView, session: SessionView, match?: string[]): { rows: ProjectRow[]; current: string | null } {
  const doneSeen = useApp((s) => s.doneSeen);
  const since = useApp((s) => s.statusSince);
  const now = useMinuteClock();
  const searching = useSessionQuery((s) => s.query.trim() !== "");
  const all = useSessionFilter((s) => s.filter === "all") || searching;
  const keptMs = useActiveKeptMs();
  const rows = useMemo(() => {
    const r = sessionProjects(machine, session, doneSeen, all, since, now, keptMs);
    return searching && match ? r.filter((x) => match.includes(x.id)) : r;
  }, [machine, session, doneSeen, all, since, now, keptMs, searching, match]);
  const selectedWs = useSelectedWorkspace(machine.id, session);
  const fromTree = useViewOrigin((s) => s.from === "sessions");
  return { rows, current: fromTree && rows.some((r) => r.id === selectedWs) ? selectedWs : null };
}

/**
 * A Session's project rows. Folded, it keeps the ones that ask for the user (Blocked, Review) and the
 * one holding the selected pane, then counts the rest in a row that unfolds the Session.
 */
export function ProjectRows({ machineId, session, rows, current, folded = false, onUnfold }: {
  machineId: string;
  session: string;
  rows: ProjectRow[];
  current: string | null;
  folded?: boolean;
  onUnfold?: () => void;
}) {
  const openProject = useApp((s) => s.openProject);
  const setOrigin = useViewOrigin((s) => s.set);
  const bookmarks = useLayout((s) => s.layout.bookmarks);
  const a = useActions();
  const shown = folded ? rows.filter((r) => WORD[r.state] || r.id === current) : rows;
  const hidden = rows.length - shown.length;
  // Folded with nothing to keep, the Session's closed chevron says it all.
  if (shown.length === 0) return null;
  return (
    <ul className="project-list">
      {shown.map((r) => {
        const word = WORD[r.state];
        const lanes = r.state === "working" && r.lanes > 0 ? `${r.lanes} ${r.lanes === 1 ? "lane" : "lanes"}` : null;
        // A project kept for having stopped recently says how long ago, as an idle pane row does.
        const age = r.idleFor !== undefined ? idleLabel(r.idleFor) : null;
        const open = () => {
          if (!r.target) return;
          setOrigin("sessions");
          openProject({ machine_id: machineId, session }, r);
        };
        // A project is what Bookmarks hold (ADR 0006): its row's menu bookmarks it, a star says it is.
        const key = projectKey(machineId, session, r.label);
        const marked = bookmarks.includes(key);
        const bookmarkItem = {
          label: marked ? "Unbookmark" : "Bookmark",
          icon: marked ? StarOffIcon : StarIcon,
          onSelect: () =>
            useLayout.getState().update((l) =>
              // Resolve duplicates when selected: a snapshot can change the first
              // Workspace while this menu is open.
              setBookmarked(l, key, !marked, firstWorkspaceFolder(machineId, session,
                useApp.getState().machines[machineId]?.sessions.find((x) => x.name === session)?.workspaces ?? [], r.label)),
            ),
        };
        return (
          <li key={r.id}>
            <button
              type="button"
              className={"project-row " + r.state + (r.id === current ? " active" : "")}
              aria-current={r.id === current ? "true" : undefined}
              aria-label={[r.label, word?.toLowerCase(), lanes, age && `idle ${age}`].filter(Boolean).join(", ")}
              onClick={open}
              onContextMenu={(e) => a?.menu(e, [bookmarkItem])}
            >
              <span className="slot" aria-hidden="true">
                {r.state === "review" ? <CheckIcon className="icon mark-done" /> : <span className="project-dot" />}
              </span>
              <span className="label">{r.label}</span>
              {marked && <StarIcon className="icon bookmark-mark" aria-label="bookmarked" aria-hidden={undefined} />}
              {word ? <span className={"project-word " + r.state}>{word}</span> : (lanes ?? age) && <span className="project-meta">{lanes ?? age}</span>}
            </button>
          </li>
        );
      })}
      {hidden > 0 && (
        <li>
          <button type="button" className="project-row more-row" onClick={onUnfold}>
            <span className="slot" aria-hidden="true" />
            <span className="label">{hidden} more</span>
          </button>
        </li>
      )}
    </ul>
  );
}
