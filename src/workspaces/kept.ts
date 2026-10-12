// Pure derivation of the kept Workspaces a Session has closed, and the backfill that
// keeps a Bookmarked live Workspace. Imports only types and groups.ts: anything that
// calls herdr or the store lives in keptActions.ts.

import type { MachineView, SessionView, WorkspaceView } from "../lib/types";
import { projectKey, sessionKey, setKept, type Layout, type ProjectKey } from "../sidebar/groups";

/** A kept Workspace of a Session that no live Workspace carries. */
export interface ClosedKept {
  key: ProjectKey;
  label: string;
  folder: string | null;
}

/** The Workspace label a ProjectKey was built from. */
const labelOf = (key: ProjectKey): string => decodeURIComponent(key.slice(key.lastIndexOf("/") + 1));

/**
 * The kept Workspaces of `session` no live Workspace carries, by label. Empty unless
 * both the Machine is connected and the Session is running, so a stale view never
 * reports a live Workspace as closed.
 */
export function closedKept(layout: Layout, machine: MachineView, session: SessionView): ClosedKept[] {
  if (machine.state !== "connected" || !session.running) return [];
  const prefix = sessionKey(machine.id, session.name) + "/";
  const live = new Set(session.workspaces.map((w) => w.label));
  const out: ClosedKept[] = [];
  for (const [key, entry] of Object.entries(layout.kept ?? {})) {
    if (!key.startsWith(prefix)) continue;
    const label = labelOf(key);
    if (live.has(label)) continue;
    out.push({ key, label, folder: entry.folder });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Keep every live Workspace of a connected Machine's running Session that is
 * Bookmarked but not kept yet, with the folder `folderOf` reports. A Workspace that
 * merely shares a Bookmarked label keeps the first folder found. Returns the same
 * `layout` object when nothing changes.
 */
export function backfillKept(
  layout: Layout,
  machine: MachineView,
  folderOf: (session: string, ws: WorkspaceView) => string | null,
): Layout {
  if (machine.state !== "connected") return layout;
  let out = layout;
  for (const session of machine.sessions) {
    if (!session.running) continue;
    for (const ws of session.workspaces) {
      const key = projectKey(machine.id, session.name, ws.label);
      if (key in (out.kept ?? {})) continue;
      if (!layout.bookmarks.includes(key)) continue;
      out = setKept(out, key, folderOf(session.name, ws));
    }
  }
  return out;
}
