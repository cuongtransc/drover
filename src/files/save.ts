import { filesWrite } from "../lib/ipc";
import { showToast } from "../ui/Toast";
import { useDrafts } from "./drafts";

const running = new Map<string, Promise<boolean>>();

/**
 * Writes a Draft over its base version (or over whatever is on disk when `force`).
 * Resolves true when written; false when nothing was written.
 * A call while the Draft is already saving returns the running save's promise.
 */
export function saveDraft(key: string, opts: { force: boolean }): Promise<boolean> {
  const active = running.get(key);
  if (active) return active;
  const p = write(key, opts).finally(() => {
    if (running.get(key) === p) running.delete(key);
  });
  running.set(key, p);
  return p;
}

async function write(key: string, opts: { force: boolean }): Promise<boolean> {
  const { drafts, setSaving, setConflict, saved } = useDrafts.getState();
  const draft = drafts[key];
  if (!draft || draft.saving || (draft.conflict && !opts.force)) return false;
  const text = draft.state.sliceDoc();
  const { id, machineId, root, rel, base } = draft;
  setSaving(key, true);
  // A Draft re-created by open() has a new id, so this save's result no longer applies.
  const current = (): boolean => useDrafts.getState().drafts[key]?.id === id;
  try {
    const version = await filesWrite(machineId, root, rel, text, opts.force ? null : { size: base.size, mtime: base.mtime, cksum: base.cksum });
    if (current()) saved(key, { text, ...version });
    return true;
  } catch (e) {
    const { code, message } = (e ?? {}) as { code?: string; message?: string };
    if (current()) {
      setSaving(key, false);
      if (code === "conflict") setConflict(key, "changed");
      else if (code === "not_found") setConflict(key, "removed");
    }
    if (code !== "conflict" && code !== "not_found") showToast(`Cannot save ${rel.split("/").pop()}: ${message ?? String(e)}`);
    return false;
  }
}
