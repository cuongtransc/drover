import { useSyncExternalStore } from "react";
import type { SessionView, WorkspaceView } from "../lib/types";

export interface WorkspaceRef {
  machine_id: string;
  session: string;
  workspace_id: string;
}

const PREFIX = "drover:ws-folder:";

const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function folderKey(ref: WorkspaceRef): string {
  return PREFIX + [ref.machine_id, ref.session, ref.workspace_id].map(encodeURIComponent).join("/");
}

export function getFolder(ref: WorkspaceRef): string | null {
  try {
    return localStorage.getItem(folderKey(ref)) || null;
  } catch {
    return null;
  }
}

export function setFolder(ref: WorkspaceRef, path: string): void {
  const value = path.trim();
  try {
    if (value) localStorage.setItem(folderKey(ref), value);
    else localStorage.removeItem(folderKey(ref));
  } catch {
    /* ignore */
  }
  notify();
}

/** Drop every stored folder of a Session that no longer exists. */
export function forgetSessionFolders(machineId: string, session: string): void {
  const prefix = PREFIX + encodeURIComponent(machineId) + "/" + encodeURIComponent(session) + "/";
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) doomed.push(key);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
  notify();
}

/** Carry a renamed Session's stored folders over to its new name. */
export function moveSessionFolders(machineId: string, from: string, to: string): void {
  const prefix = (s: string) => PREFIX + encodeURIComponent(machineId) + "/" + encodeURIComponent(s) + "/";
  const [old, next] = [prefix(from), prefix(to)];
  try {
    const moved: [string, string][] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(old)) moved.push([key, next + key.slice(old.length)]);
    }
    for (const [k, nk] of moved) {
      const v = localStorage.getItem(k);
      if (v !== null) localStorage.setItem(nk, v);
      localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
  notify();
}

/** The folder a Workspace was opened in: its stored one, else the first pane cwd it suggests. */
export function workspaceFolder(machineId: string, session: string, ws: WorkspaceView): string | null {
  const ref: WorkspaceRef = { machine_id: machineId, session, workspace_id: ws.workspace_id };
  return getFolder(ref) ?? (suggestFolder(ws) || null);
}

export function suggestFolder(ws: WorkspaceView): string {
  for (const tab of ws.tabs) {
    for (const pane of tab.panes) {
      if (pane.cwd) return pane.cwd;
    }
  }
  return "";
}

function isSnapshot(session: SessionView): boolean {
  return session.running && !session.error && session.workspaces.length > 0;
}

/**
 * Drop stored folders of Workspaces that left `session`. Does nothing unless
 * `session` is a valid snapshot (running, no error, at least one Workspace).
 *
 * With a valid `previous` view of the same Session, prunes by diff: only ids
 * listed in `previous` and missing from `session` are removed. A folder saved
 * for a Workspace the snapshot does not list yet (just created, watcher refetch
 * still pending) is kept. Without one (first snapshot of the Session in this
 * app run) every stored id for the Session missing from `session` is removed.
 */
export function pruneFolders(machineId: string, session: SessionView, previous?: SessionView): void {
  if (!isSnapshot(session)) return;
  const prefix = PREFIX + encodeURIComponent(machineId) + "/" + encodeURIComponent(session.name) + "/";
  const live = new Set(session.workspaces.map((w) => w.workspace_id));
  const known = previous && isSnapshot(previous) ? new Set(previous.workspaces.map((w) => w.workspace_id)) : null;
  // Pruning by diff removes only ids that left since `previous`; none did, so skip the scan.
  if (known && [...known].every((id) => live.has(id))) return;
  let removed = false;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      let id: string;
      try {
        id = decodeURIComponent(key.slice(prefix.length));
      } catch {
        continue;
      }
      if (!live.has(id) && (!known || known.has(id))) doomed.push(key);
    }
    for (const key of doomed) localStorage.removeItem(key);
    removed = doomed.length > 0;
  } catch {
    /* ignore */
  }
  if (removed) notify();
}

export function useFolder(ref: WorkspaceRef): string | null {
  return useSyncExternalStore(subscribe, () => getFolder(ref));
}

export function folderName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}
