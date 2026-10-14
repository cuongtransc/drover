import { useDrafts } from "./drafts";

const anyDirty = () => Object.values(useDrafts.getState().drafts).some((d) => d.dirty);

/** Calls `report` now and whenever "some Draft is dirty" flips, so the app process knows whether
 *  a quit from the Dock or a logout must ask first (`quit_guard.rs`). Returns the unsubscribe. */
export function syncUnsaved(report: (unsaved: boolean) => void): () => void {
  let last = anyDirty();
  report(last);
  return useDrafts.subscribe(() => {
    const now = anyDirty();
    if (now === last) return;
    last = now;
    report(now);
  });
}
