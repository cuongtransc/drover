import { filesWrite } from "../lib/ipc";
import { showToast } from "../ui/Toast";
import { useDrafts } from "./drafts";

interface Running {
  id: number;
  force: boolean;
  promise: Promise<boolean>;
}
const running = new Map<string, Running>();

/**
 * Writes a Draft over its base version (or over whatever is on disk when `force`).
 * Resolves true when written; false when nothing was written.
 * Single-flight per Draft: a call while it is saving waits for that save, then saves again
 * only if the Draft is still dirty or the call's `force` differs from the running save's.
 */
export function saveDraft(key: string, opts: { force: boolean }): Promise<boolean> {
  const active = running.get(key);
  const draft = useDrafts.getState().drafts[key];
  if (active && draft && active.id === draft.id) {
    return active.promise.then((ok) => {
      if (!ok) return false;
      const d = useDrafts.getState().drafts[key];
      if (!d || d.id !== active.id) return true;
      return d.dirty || opts.force !== active.force ? saveDraft(key, opts) : true;
    });
  }
  const entry: Running = { id: draft?.id ?? -1, force: opts.force, promise: Promise.resolve(false) };
  entry.promise = write(key, opts).finally(() => {
    if (running.get(key) === entry) running.delete(key);
  });
  running.set(key, entry);
  return entry.promise;
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
