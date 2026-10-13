// Store-aware actions for kept Workspaces: reopening a closed one through herdr, and
// keeping a Workspace's stored folder in step with its kept entry. kept.ts stays pure;
// every herdr call and layout write lives here.

import { useSyncExternalStore } from "react";
import { herdrCall } from "../lib/ipc";
import { projectKey, setKept, useLayout } from "../sidebar/groups";
import type { ProjectKey } from "../sidebar/groups";
import { useApp } from "../store/app";
import { isSnapshot, setFolder } from "./folder";
import type { WorkspaceRef } from "./folder";
import type { ClosedKept } from "./kept";

/** How long a created Workspace may stay unlisted before its row is clickable again. */
const SETTLE_MS = 10_000;

// A key is pending while `workspace.create` is in flight (`pending`) and, after it resolved, until a
// snapshot of the Session lists the label or SETTLE_MS passes (`settling`). Without the second part a
// click in the gap before the snapshot arrives would create a duplicate.
const pending = new Set<ProjectKey>();
interface Settling {
  machineId: string;
  session: string;
  label: string;
  timer: ReturnType<typeof setTimeout>;
}
const settling = new Map<ProjectKey, Settling>();
// A Workspace rename migrates the kept entry only once herdr accepted it, but a snapshot with the new
// label can land first. While a rename is in flight neither key reads as closed or reopens (refcounted, as
// the Session rename is in store/app.ts).
const renaming = new Map<ProjectKey, number>();
let renameVersion = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const isPending = (key: ProjectKey) => pending.has(key) || settling.has(key) || renaming.has(key);

/** True while a rename of a Workspace to or from this key is in flight. */
export function isRenaming(key: ProjectKey): boolean {
  return renaming.has(key);
}

/** Re-renders on every change of what is renaming, for readers that filter a list by `isRenaming`. */
export function useRenameVersion(): number {
  return useSyncExternalStore(subscribe, () => renameVersion);
}

export function beginWorkspaceRename(from: ProjectKey, to: ProjectKey): void {
  for (const k of [from, to]) renaming.set(k, (renaming.get(k) ?? 0) + 1);
  renameVersion++;
  notify();
}

export function endWorkspaceRename(from: ProjectKey, to: ProjectKey): void {
  for (const k of [from, to]) {
    const left = (renaming.get(k) ?? 0) - 1;
    if (left > 0) renaming.set(k, left);
    else renaming.delete(k);
  }
  renameVersion++;
  notify();
}

export function isReopenPending(key: ProjectKey): boolean {
  return isPending(key);
}

/** True while a reopen of this kept key is in flight or its Workspace is not listed yet. Shared by Closed and Bookmarks. */
export function useReopenPending(key: ProjectKey): boolean {
  return useSyncExternalStore(subscribe, () => isPending(key));
}

const listed = (machineId: string, session: string, label: string): boolean => {
  const s = useApp.getState().machines[machineId]?.sessions.find((x) => x.name === session);
  return !!s && isSnapshot(s) && s.workspaces.some((w) => w.label === label);
};

const settle = (key: ProjectKey) => {
  const s = settling.get(key);
  if (!s) return;
  clearTimeout(s.timer);
  settling.delete(key);
  notify();
};

useApp.subscribe(() => {
  for (const [key, s] of settling) if (listed(s.machineId, s.session, s.label)) settle(key);
});

/** Forget every pending reopen. For tests: this state outlives a test's stores. */
export function resetReopenPending(): void {
  pending.clear();
  for (const s of settling.values()) clearTimeout(s.timer);
  settling.clear();
  renaming.clear();
  renameVersion++;
  notify();
}

interface WorkspaceCreated {
  workspace?: { workspace_id: string };
  root_pane: { pane_id: string };
}

/**
 * Open a closed kept Workspace again in the folder it was kept with (herdr's default
 * when it had none) and select its terminal. A herdr error rejects as it is, and the
 * Workspace stays kept so the row is still there to retry. After a successful create the
 * key stays pending until a snapshot lists the label (10 s at most).
 */
export async function reopenKept(machineId: string, session: string, c: ClosedKept): Promise<void> {
  if (isPending(c.key)) return;
  pending.add(c.key);
  notify();
  try {
    const res = await herdrCall<WorkspaceCreated>(machineId, session, "workspace.create", {
      cwd: c.folder,
      label: c.label,
      focus: false,
    });
    const workspaceId = res.workspace?.workspace_id;
    if (c.folder !== null && workspaceId) {
      setFolder({ machine_id: machineId, session, workspace_id: workspaceId }, c.folder);
    }
    useApp.getState().select({ machine_id: machineId, session, pane_id: res.root_pane.pane_id });
    if (!listed(machineId, session, c.label)) {
      settling.set(c.key, { machineId, session, label: c.label, timer: setTimeout(() => settle(c.key), SETTLE_MS) });
    }
  } finally {
    pending.delete(c.key);
    notify();
  }
}

/**
 * Store a Workspace's folder; when the Workspace is kept, its kept entry follows. A
 * Workspace that is not kept leaves the layout untouched (the same object).
 */
export function saveWorkspaceFolder(ref: WorkspaceRef, label: string, path: string): void {
  setFolder(ref, path);
  const key = projectKey(ref.machine_id, ref.session, label);
  useLayout.getState().update((l) => (key in (l.kept ?? {}) ? setKept(l, key, path.trim() || null) : l));
}
