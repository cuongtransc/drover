import { useEffect, useRef } from "react";
import { onPaneStatus } from "../lib/ipc";
import type { MachineView, PaneStatusEvent } from "../lib/types";
import { useApp } from "../store/app";
import type { WorkspaceRef } from "../workspaces/folder";

const isLocal = (machines: Record<string, MachineView>, machineId: string) => machines[machineId]?.kind === "local";

/** True when `ev` is an Agent of Workspace `ws` on a local Machine that just stopped working: it
 *  may have written many files, and FSEvents drops events silently while files churn. */
export function shouldResync(ev: PaneStatusEvent, ws: WorkspaceRef, machines: Record<string, MachineView>): boolean {
  if (ev.previous !== "working" || ev.status === "working") return false;
  if (ev.pane.machine_id !== ws.machine_id || ev.pane.session !== ws.session || !isLocal(machines, ws.machine_id)) return false;
  const session = machines[ws.machine_id].sessions.find((s) => s.name === ws.session);
  const workspace = session?.workspaces.find((w) => w.workspace_id === ws.workspace_id);
  return workspace?.tabs.some((t) => t.panes.some((p) => p.pane_id === ev.pane.pane_id)) ?? false;
}

/** Reloads a local Files panel when its listing may have gone stale: the window gets the focus
 *  back, or an Agent of its Workspace stops working. macOS FSEvents can lose events while another
 *  folder churns (a build), with no rescan flag, so the watch alone does not catch up. */
export function useStaleResync(ws: WorkspaceRef, reload: () => void): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const { machine_id, session, workspace_id } = ws;
  useEffect(() => {
    const ref = { machine_id, session, workspace_id };
    const onFocus = () => {
      if (isLocal(useApp.getState().machines, machine_id)) reloadRef.current();
    };
    window.addEventListener("focus", onFocus);
    let stop: (() => void) | null = null;
    let gone = false;
    void onPaneStatus((ev) => {
      if (shouldResync(ev, ref, useApp.getState().machines)) reloadRef.current();
    })
      .then((u) => (gone ? u() : (stop = u)))
      .catch((err) => console.warn("files: no pane status events, Agent-finished resync is off", err));
    return () => {
      gone = true;
      window.removeEventListener("focus", onFocus);
      stop?.();
    };
  }, [machine_id, session, workspace_id]);
}
