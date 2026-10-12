// Store-aware actions for kept Workspaces: reopening a closed one through herdr, and
// keeping a Workspace's stored folder in step with its kept entry. kept.ts stays pure;
// every herdr call and layout write lives here.

import { herdrCall } from "../lib/ipc";
import { projectKey, setKept, useLayout } from "../sidebar/groups";
import { useApp } from "../store/app";
import { setFolder } from "./folder";
import type { WorkspaceRef } from "./folder";
import type { ClosedKept } from "./kept";

interface WorkspaceCreated {
  workspace?: { workspace_id: string };
  root_pane: { pane_id: string };
}

/**
 * Open a closed kept Workspace again in the folder it was kept with (herdr's default
 * when it had none) and select its terminal. A herdr error rejects as it is, and the
 * Workspace stays kept so the row is still there to retry.
 */
export async function reopenKept(machineId: string, session: string, c: ClosedKept): Promise<void> {
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
