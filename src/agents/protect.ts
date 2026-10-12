import { create } from "zustand";
import { paneKey } from "../lib/types";
import { useApp } from "../store/app";
import type { MachineView, WorkspaceView } from "../lib/types";
import { paneRoles, tabRole } from "./roles";

/** By paneKey: true protects a pane, false unprotects one protected by default (an orchestrator). */
export type Marks = Record<string, boolean>;

const KEY = "drover:protected";

export function loadMarks(): Marks {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "boolean")) as Marks;
  } catch {
    return {};
  }
}

function save(marks: Marks): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(marks));
  } catch {
    /* ignore */
  }
}

/** A protected pane cannot be closed from the app until it is unprotected. Orchestrators start protected. */
export function isProtected(marks: Marks, key: string, orch: boolean): boolean {
  return marks[key] ?? orch;
}

interface ProtectStore {
  marks: Marks;
  set: (key: string, on: boolean) => void;
  /** Unprotects `keys` (they are being closed on purpose). */
  release: (keys: string[]) => void;
  /** Replaces every mark (pruning). */
  replace: (marks: Marks) => void;
}

export const useProtect = create<ProtectStore>((setState, get) => ({
  marks: loadMarks(),
  set: (key, on) => {
    const marks = { ...get().marks, [key]: on };
    save(marks);
    setState({ marks });
  },
  release: (keys) => {
    if (keys.length === 0) return;
    const marks = { ...get().marks };
    for (const k of keys) marks[k] = false;
    save(marks);
    setState({ marks });
  },
  replace: (marks) => {
    save(marks);
    setState({ marks });
  },
}));

export interface ProtectedPane {
  key: string;
  title: string;
}

/** The protected panes of `workspaces` in session `session` of machine `machineId`, in order. */
export function protectedIn(machineId: string, session: string, workspaces: WorkspaceView[], marks: Marks): ProtectedPane[] {
  const out: ProtectedPane[] = [];
  for (const ws of workspaces) {
    const panes = ws.tabs.flatMap((t) => t.panes.map((pane) => ({ tabLabel: t.label, pane })));
    const roles = paneRoles(panes);
    panes.forEach(({ tabLabel, pane }, i) => {
      const key = paneKey({ machine_id: machineId, session, pane_id: pane.pane_id });
      const orch = roles[i] === "orch" || (tabRole(tabLabel) === "orch" && !!pane.agent);
      if (isProtected(marks, key, orch)) out.push({ key, title: pane.title });
    });
  }
  return out;
}

/**
 * Marks without the panes a connected machine's running sessions no longer have. A machine that
 * is offline, or a stopped session, keeps its marks: its panes are unknown, not gone.
 */
export function pruneMarks(marks: Marks, machine: MachineView): Marks {
  return prunePaneKeys(marks, machine);
}

/** `rec` (by paneKey) without the panes a connected machine's running sessions no longer have; `rec` itself when nothing goes. */
export function prunePaneKeys<T>(marks: Record<string, T>, machine: MachineView): Record<string, T> {
  if (machine.state !== "connected") return marks;
  const live = new Set<string>();
  const running = new Set<string>();
  for (const s of machine.sessions) {
    if (!s.running) continue;
    running.add(s.name);
    for (const w of s.workspaces) for (const t of w.tabs) for (const p of t.panes) live.add(paneKey({ machine_id: machine.id, session: s.name, pane_id: p.pane_id }));
  }
  const prefix = `${machine.id}/`;
  const gone = Object.keys(marks).filter((k) => {
    if (!k.startsWith(prefix)) return false;
    const session = k.slice(prefix.length, k.lastIndexOf("/"));
    return running.has(session) && !live.has(k);
  });
  if (gone.length === 0) return marks;
  const next = { ...marks };
  for (const k of gone) delete next[k];
  return next;
}

/** Prunes marks as machine snapshots arrive; returns the unsubscribe. */
export function watchProtectPrune(): () => void {
  return useApp.subscribe((s, prev) => {
    if (s.machines === prev.machines) return;
    let marks = useProtect.getState().marks;
    for (const [id, m] of Object.entries(s.machines)) if (m !== prev.machines[id]) marks = pruneMarks(marks, m);
    if (marks !== useProtect.getState().marks) useProtect.getState().replace(marks);
  });
}
