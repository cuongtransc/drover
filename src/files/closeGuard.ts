import { useApp } from "../store/app";
import { closingKeys, type CloseScope } from "../store/openItems";
import { showToast } from "../ui/Toast";
import { isDirty, useDrafts } from "./drafts";
import { saveDraft } from "./save";
import { askUnsaved } from "./unsaved";

const basename = (rel: string): string => rel.slice(rel.lastIndexOf("/") + 1);

/** Resolves once the Draft of `key` is not saving (or is gone). */
function saveFinished(key: string): Promise<void> {
  return new Promise((resolve) => {
    const done = () => !useDrafts.getState().drafts[key]?.saving;
    if (done()) return resolve();
    const stop = useDrafts.subscribe(() => {
      if (!done()) return;
      stop();
      resolve();
    });
  });
}

/** Saves the Draft of `key` for Save / Save All: a save already running is waited for (and tried
 *  again once if it left changes unsaved); a Draft in conflict is shown, with why it cannot be saved. */
async function saveForClose(key: string): Promise<boolean> {
  if (useDrafts.getState().drafts[key]?.saving) {
    await saveFinished(key);
    if (!isDirty(key)) return true;
  }
  if (await saveDraft(key, { force: false })) return true;
  const d = useDrafts.getState().drafts[key];
  if (d?.conflict) {
    showToast(`Cannot save ${basename(d.rel)}: ${d.conflict === "removed" ? "it was deleted" : "it changed on disk"}`);
    useApp.getState().activateItem(key);
  }
  return false;
}

/** Resolves true when it is fine to lose the Drafts of `keys` (they are dropped then); false keeps every Draft.
 *  `now`, when given, lists the keys about to be closed once the asking is over: a dirty one not asked
 *  about, or any Draft edited again while saving, aborts (the new edit stays). */
export async function settleDrafts(keys: string[], now: () => string[] = () => keys): Promise<boolean> {
  const dirty = keys.filter(isDirty);
  const drop = () => new Set([...keys, ...now()]).forEach((k) => useDrafts.getState().drop(k));
  const surprise = () => now().some((k) => isDirty(k) && !dirty.includes(k));
  if (dirty.length === 0) {
    if (surprise()) return false;
    drop();
    return true;
  }
  const names = dirty.map((k) => basename(useDrafts.getState().drafts[k].rel));
  const choice = await askUnsaved(names);
  if (choice === "cancel") return false;
  if (choice === "save") {
    for (const k of dirty) if (!(await saveForClose(k))) return false;
    if (dirty.some(isDirty)) return false;
  }
  if (surprise()) return false;
  drop();
  return true;
}

/** `closeItems`, but only once the Drafts of the items it would close are settled. */
export async function closeItemsGuarded(key: string, scope: "one" | CloseScope): Promise<void> {
  const now = () => closingKeys(useApp.getState().openItems, scope, key);
  if (await settleDrafts(now(), now)) useApp.getState().closeItems(key, scope);
}
