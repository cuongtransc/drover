import { menuSetShortcuts } from "../lib/ipc";
import type { ActionId } from "./actions";
import { type Bindings, useShortcuts } from "./store";

/** Every action with no key: what the menu bar carries while Settings records a key, so the
 *  recorder receives it (the menu would take it first, ADR 0010). */
const noKeys = (b: Bindings): Bindings => Object.fromEntries(Object.keys(b).map((id) => [id as ActionId, null])) as Bindings;

const send = (b: Bindings, recording: boolean) =>
  void menuSetShortcuts(recording ? noKeys(b) : b, !recording).catch((e: unknown) => console.error("menu sync failed", e));

/** Keeps the menu bar's keys on the user's bindings, and off while a key is being recorded. */
export function startMenuSync(): () => void {
  const { bindings, recording } = useShortcuts.getState();
  send(bindings, recording);
  return useShortcuts.subscribe((s, prev) => {
    if (s.bindings === prev.bindings && s.recording === prev.recording) return;
    send(s.bindings, s.recording);
  });
}
