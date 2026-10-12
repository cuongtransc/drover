import { roleOfLabel, shouldAlert, type AlertRole } from "./attention";
import { notifyPane } from "./lib/ipc";
import type { MachineView, PaneRef, PaneStatusEvent } from "./lib/types";
import { paneKey } from "./lib/types";

const SETTINGS_KEY = "drover:settings";

export function notificationsEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { notifications?: unknown };
      if (typeof p.notifications === "boolean") return p.notifications;
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return true;
}

export function setNotificationsEnabled(on: boolean): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    let prev: Record<string, unknown> = {};
    try {
      prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      /* ignore corrupt */
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...prev, notifications: on }));
  } catch {
    /* ignore */
  }
}

export function shouldNotify(
  ev: PaneStatusEvent,
  selected: PaneRef | null,
  enabled: boolean,
  role: AlertRole,
  focused: boolean,
): boolean {
  if (!enabled) return false;
  if (ev.status !== "blocked" && ev.status !== "done") return false;
  if (ev.previous === ev.status) return false;
  if (focused && selected && paneKey(selected) === paneKey(ev.pane)) return false;
  return shouldAlert(role, ev.status, "desk").desk;
}

/** The user's word for the two states that reach them: `Blocked` and `Review` (CONTEXT.md). */
export function statusTitle(status: "blocked" | "done"): "Blocked" | "Review" {
  return status === "blocked" ? "Blocked" : "Review";
}

export async function notifyPaneStatus(
  ev: PaneStatusEvent,
  selected: PaneRef | null,
  machines: Record<string, MachineView>,
): Promise<void> {
  const session = machines[ev.pane.machine_id]?.sessions.find((s) => s.name === ev.pane.session);
  const tab = session?.workspaces
    .flatMap((w) => w.tabs)
    .find((t) => t.panes.some((p) => p.pane_id === ev.pane.pane_id));
  if (ev.status === "done" && !tab) return;
  if (!shouldNotify(ev, selected, notificationsEnabled(), roleOfLabel(tab?.label), document.hasFocus())) return;
  // shouldNotify lets only blocked/done through, which is exactly what a title can say.
  const status = ev.status === "done" ? "done" : "blocked";
  const pane = tab?.panes.find((p) => p.pane_id === ev.pane.pane_id);
  const machine = machines[ev.pane.machine_id]?.label ?? ev.pane.machine_id;
  await notifyPane(ev.pane, `${pane?.agent ?? ev.title} — ${statusTitle(status)}`, `${machine} › ${ev.pane.session} › ${ev.title}`).catch(
    (e: unknown) => console.warn("notify_pane failed", e),
  );
}
