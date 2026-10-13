import { useMemo } from "react";
import { create } from "zustand";
import { DEFAULT_KEPT_MS, useActiveKeptMs, useMinuteClock } from "../agents/paneFilter";
import { tabRole } from "../agents/roles";
import { paneKey } from "../lib/types";
import type { MachineView, SessionView } from "../lib/types";
import { useApp } from "../store/app";
import { resolve, sessionKey, useLayout } from "./groups";
import type { RBookmark, RNode, RSession } from "./groups";
import { isIdleDefault, queryResolved, queryWords } from "./sessionQuery";

/** Shared with the other settings writers: one JSON object, each writer merges its own keys. */
const SETTINGS_KEY = "drover:settings";

export type SessionFilter = "all" | "active";

function readRaw(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function save(patch: Record<string, unknown>): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readRaw(), ...patch }));
  } catch {
    /* ignore */
  }
}

export const useSessionFilter = create<{ filter: SessionFilter; setFilter: (f: SessionFilter) => void }>((set) => ({
  // Active by default: a Session with no agent work is a line to read past (ui-ux-guidelines §7.3).
  filter: readRaw().sessionFilter === "all" ? "all" : "active",
  setFilter: (filter) => {
    save({ sessionFilter: filter });
    set({ filter });
  },
}));

/** The Sessions filter's words and machine chip: what the user is looking for now, so not saved. */
export const useSessionQuery = create<{ query: string; machine: string | null; setQuery: (q: string) => void; setMachine: (id: string | null) => void }>((set) => ({
  query: "",
  machine: null,
  setQuery: (query) => set({ query }),
  setMachine: (machine) => set({ machine }),
}));

/** Settings: list herdr's `default` Session while it has no agent (`isIdleDefault`). Off by default. */
export const useShowDefault = create<{ show: boolean; setShow: (show: boolean) => void }>((set) => ({
  show: readRaw().showDefaultSession === true,
  setShow: (show) => {
    save({ showDefaultSession: show });
    set({ show });
  },
}));

/** A running session on a connected machine with an agent waiting, working, Done and not yet seen, or
 *  changed within the Active window (`since`, `keptMs`), as the Agents column keeps it. */
export function isActiveSession(
  machine: MachineView,
  session: SessionView,
  doneSeen: Record<string, true>,
  since: Record<string, number> = {},
  now = Date.now(),
  keptMs = DEFAULT_KEPT_MS,
): boolean {
  if (machine.state !== "connected" || !session.running) return false;
  return session.workspaces.some((w) =>
    w.tabs.some((t) =>
      t.panes.some((p) => {
        if (!p.agent) return false;
        if (p.status === "blocked" || p.status === "working") return true;
        // A lane's Done is its orchestrator's to read.
        if (tabRole(t.label) === "lane") return false;
        const key = paneKey({ machine_id: machine.id, session: session.name, pane_id: p.pane_id });
        if (p.status === "done" && !doneSeen[key]) return true;
        return since[key] !== undefined && now - since[key] <= keptMs;
      }),
    ),
  );
}

/** Agent panes of the session waiting for input or Done and unseen: what ⌘J would visit there. */
export function needYouCount(machine: MachineView, session: SessionView, doneSeen: Record<string, true>): number {
  if (machine.state !== "connected" || !session.running) return 0;
  let n = 0;
  for (const w of session.workspaces)
    for (const t of w.tabs)
      for (const p of t.panes) {
        if (!p.agent) continue;
        if (p.status === "blocked") n++;
        else if (tabRole(t.label) === "lane") continue;
        else if (p.status === "done" && !doneSeen[paneKey({ machine_id: machine.id, session: session.name, pane_id: p.pane_id })]) n++;
      }
  return n;
}

/** Which twin of a bookmarked Session the user clicked last, so only that row reads as selected. */
export const useViewOrigin = create<{ from: "bookmarks" | "sessions"; set: (from: "bookmarks" | "sessions") => void }>((set) => ({
  from: "sessions",
  set: (from) => set({ from }),
}));

/** The resolved sidebar with only the sessions `keep` accepts: order kept, emptied groups dropped unless
 *  `keepGroups` (every group stays, as under All). Bookmarks stay whole: a bookmarked project is wanted
 *  even while its Session is quiet. */
export function filterResolved(
  r: { tree: RNode[]; bookmarks: RBookmark[] },
  keep: (s: RSession) => boolean,
  keepGroups = false,
): { tree: RNode[]; bookmarks: RBookmark[]; hidden: number; kept: number } {
  let hidden = 0;
  let kept = 0;
  const walk = (nodes: RNode[]): RNode[] =>
    nodes.flatMap((n): RNode[] => {
      if (n.kind === "session") {
        if (keep(n)) {
          kept++;
          return [n];
        }
        hidden++;
        return [];
      }
      const children = walk(n.children);
      return children.length || keepGroups ? [{ ...n, children }] : [];
    });
  const tree = walk(r.tree);
  return { tree, bookmarks: r.bookmarks, hidden, kept };
}

/** The sidebar's sessions under the current filters, and how many Active leaves out. A machine chip keeps
 *  that machine's sessions; words typed keep what they find, past Active (`queryResolved`); an idle
 *  `default` stays out unless Settings shows it, the words look for it, or it is being viewed. */
export function useSidebarSessions(): {
  tree: RNode[];
  bookmarks: RBookmark[];
  hidden: number;
  kept: number;
  active: boolean;
  /** Words typed, or a machine chip on: an empty tree then says so. */
  narrowed: boolean;
} {
  const machines = useApp((s) => s.machines);
  const order = useApp((s) => s.order);
  const doneSeen = useApp((s) => s.doneSeen);
  const since = useApp((s) => s.statusSince);
  const now = useMinuteClock();
  const keptMs = useActiveKeptMs();
  // A key, not the ref: select() replaces `viewed` with an equal object, which must not re-render the sidebar.
  const viewedKey = useApp((s) => (s.viewed ? sessionKey(s.viewed.machine_id, s.viewed.session) : null));
  const layout = useLayout((s) => s.layout);
  const filter = useSessionFilter((s) => s.filter);
  const query = useSessionQuery((s) => s.query);
  const chip = useSessionQuery((s) => s.machine);
  const showDefault = useShowDefault((s) => s.show);
  return useMemo(() => {
    const words = queryWords(query);
    // A chip for a machine since removed keeps nothing out.
    const machine = chip && order.includes(chip) ? chip : null;
    const r = resolve(layout, machines, order);
    const base = filterResolved(r, (s) =>
      (machine === null || s.machine.id === machine) &&
      (showDefault || words.length > 0 || s.key === viewedKey || !isIdleDefault(s.session)), true);
    const f = filterResolved(base, (s) => s.key === viewedKey || isActiveSession(s.machine, s.session, doneSeen, since, now, keptMs));
    const narrowed = words.length > 0 || machine !== null;
    if (words.length > 0) return { ...queryResolved(base, words), hidden: 0, kept: f.kept, active: false, narrowed };
    return filter === "active" ? { ...f, active: true, narrowed } : { ...f, tree: base.tree, active: false, narrowed };
  }, [layout, machines, order, doneSeen, since, now, keptMs, viewedKey, filter, query, chip, showDefault]);
}
