import { useEffect, useState } from "react";
import { create } from "zustand";
import { paneKey, type PaneView, type WorkspaceView } from "../lib/types";

/** Shared with the other settings writers: one JSON object, each writer merges its own keys. */
const SETTINGS_KEY = "drover:settings";

/** The Agents column's twin of the sidebar's session filter (docs/design/ui-ux-guidelines.md §7.1). */
export type PaneFilter = "all" | "active";

function readRaw(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const usePaneFilter = create<{ filter: PaneFilter; setFilter: (f: PaneFilter) => void }>((set) => ({
  filter: readRaw().paneFilter === "all" ? "all" : "active",
  setFilter: (filter) => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readRaw(), paneFilter: filter }));
    } catch {
      /* ignore */
    }
    set({ filter });
  },
}));

/** How long an idle agent stays in Active, in minutes: a pane just looked at stays while the user is
 *  likely to return. Set in Settings › General; shared by PANES and the Sidebar's Sessions. */
export const ACTIVE_MINUTES = [15, 30, 60, 120, 240] as const;
export const DEFAULT_ACTIVE_MINUTES = 60;
const MIN = 60_000;
export const DEFAULT_KEPT_MS = DEFAULT_ACTIVE_MINUTES * MIN;

export const useActiveWindow = create<{ minutes: number; setMinutes: (m: number) => void }>((set) => ({
  minutes: ((m) => (ACTIVE_MINUTES as readonly unknown[]).includes(m) ? (m as number) : DEFAULT_ACTIVE_MINUTES)(readRaw().activeMinutes),
  setMinutes: (minutes) => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readRaw(), activeMinutes: minutes }));
    } catch {
      /* ignore */
    }
    set({ minutes });
  },
}));

/** The Active window in ms, for the hooks that filter by it. */
export const useActiveKeptMs = () => useActiveWindow((s) => s.minutes) * MIN;

/** A pane's title when it is only the shell's name ("terminal": herdr names an untitled one). */
const SHELL_NAMES = new Set(["sh", "bash", "zsh", "fish", "nu", "pwsh", "dash", "ksh", "tcsh", "terminal"]);

/** A shell with nothing to watch: idle at its prompt, by its process when herdr reported it, else by its title. */
export const isPlainShell = (pane: PaneView) =>
  !pane.agent && (pane.busy != null ? !pane.busy : SHELL_NAMES.has(pane.title.trim().replace(/^-/, "").toLowerCase()));

const agentName = (agent: string) => agent.charAt(0).toUpperCase() + agent.slice(1);

/** Why closing the pane would end work, or null when nothing runs there (ui-ux-guidelines §4.3). */
export function busyWhy(pane: PaneView): string | null {
  if (pane.agent) {
    const name = agentName(pane.agent);
    if (pane.status === "working") return `${name} is working: closing ends its turn.`;
    if (pane.status === "blocked") return `${name} is waiting for you: closing ends it.`;
    return null;
  }
  return isPlainShell(pane) ? null : "It is running a command: closing stops it.";
}

/** A pane with work running, named in a dialog that would close it with others. */
export interface BusyPane {
  key: string;
  title: string;
  /** "Claude working", "Codex waiting for you", "running a command" */
  note: string;
}

/** busyWhy, short, for a list. */
function busyNote(pane: PaneView): string | null {
  if (pane.agent) {
    if (pane.status === "working") return `${agentName(pane.agent)} working`;
    if (pane.status === "blocked") return `${agentName(pane.agent)} waiting for you`;
    return null;
  }
  return isPlainShell(pane) ? null : "running a command";
}

/** The panes of `workspaces` with work running, leaving out `skip` (the protected, named already). */
export function busyIn(machineId: string, session: string, workspaces: WorkspaceView[], skip: ReadonlySet<string> = new Set()): BusyPane[] {
  const out: BusyPane[] = [];
  for (const pane of workspaces.flatMap((w) => w.tabs.flatMap((t) => t.panes))) {
    const key = paneKey({ machine_id: machineId, session, pane_id: pane.pane_id });
    const note = busyNote(pane);
    if (note && !skip.has(key)) out.push({ key, title: pane.title, note });
  }
  return out;
}

/** How Active treats a pane. `since` is when its status last changed (unknown before the app saw a change). */
export function paneState(pane: PaneView, seen: boolean, since: number | undefined, now: number, keptMs = DEFAULT_KEPT_MS): { quiet: boolean; idleFor: number | null } {
  if (!pane.agent) return { quiet: isPlainShell(pane), idleFor: null };
  // An agent herdr cannot read may be waiting on the user: never hide it.
  if (pane.status === "blocked" || pane.status === "working" || pane.status === "unknown") return { quiet: false, idleFor: null };
  if (pane.status === "done" && !seen) return { quiet: false, idleFor: null };
  const idleFor = since === undefined ? null : now - since;
  return { quiet: idleFor === null || idleFor > keptMs, idleFor };
}

/** `12m`, `1h` for an idle time. */
export function idleLabel(ms: number): string {
  const min = Math.max(1, Math.floor(ms / 60_000));
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h`;
}

/** The current time, refreshed every minute: an idle agent leaves Active without any event. */
export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
