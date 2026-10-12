import { create } from "zustand";
import { ACTIONS, type ActionId } from "./actions";
import { type Chord, formatChord, isChord, reservedReason, sameChord } from "./chord";

/** Shared with the other settings stores: one JSON object, each writer merges its own keys. */
const SETTINGS_KEY = "drover:settings";

/** Each action's chord, or null for None. */
export type Bindings = Record<ActionId, Chord | null>;

export const DEFAULT_BINDINGS: Bindings = Object.fromEntries(ACTIONS.map((a) => [a.id, a.default])) as Bindings;

function readRaw(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Only the actions that differ from their defaults are stored. */
function save(b: Bindings): void {
  const changed: Partial<Bindings> = {};
  for (const a of ACTIONS) if (!sameChord(b[a.id], a.default)) changed[a.id] = b[a.id];
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readRaw(), shortcuts: changed }));
  } catch {
    /* ignore */
  }
}

/** Stored changes over the defaults, in table order: a chord an earlier action holds is dropped,
 *  as are unknown ids and broken or reserved chords; a default left clashing goes to None. */
export function loadBindings(): Bindings {
  const raw = readRaw().shortcuts;
  const stored = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const b: Bindings = { ...DEFAULT_BINDINGS };
  ACTIONS.forEach((a, i) => {
    if (!(a.id in stored)) return;
    const v = stored[a.id];
    if (v === null) b[a.id] = null;
    else if (isChord(v) && !reservedReason(v) && !ACTIONS.slice(0, i).some((e) => sameChord(b[e.id], v))) {
      b[a.id] = { code: v.code, shift: v.shift, alt: v.alt, ctrl: v.ctrl };
    }
  });
  ACTIONS.forEach((a, i) => {
    if (ACTIONS.slice(0, i).some((e) => sameChord(b[e.id], b[a.id]))) b[a.id] = null;
  });
  return b;
}

export type ChordCheck = { ok: true } | { refused: string } | { usedBy: ActionId };

/** Whether `chord` can go to action `id`: reserved, held by another action, or fine. */
export function checkChord(chord: Chord, bindings: Bindings, id: ActionId): ChordCheck {
  const reason = reservedReason(chord);
  if (reason) return { refused: reason };
  const other = ACTIONS.find((a) => a.id !== id && sameChord(bindings[a.id], chord));
  return other ? { usedBy: other.id } : { ok: true };
}

interface ShortcutsStore {
  bindings: Bindings;
  /** Settings is recording a key: no Shortcut runs. */
  recording: boolean;
  set: (id: ActionId, chord: Chord | null) => void;
  /** Gives `chord` to `id`, leaving any other action that held it on None. */
  replace: (id: ActionId, chord: Chord) => void;
  /** Back to the default, which any other action holding it gives up. */
  reset: (id: ActionId) => void;
  resetAll: () => void;
  setRecording: (on: boolean) => void;
}

export const useShortcuts = create<ShortcutsStore>((setState, get) => {
  const put = (bindings: Bindings) => {
    save(bindings);
    setState({ bindings });
  };
  const replace = (id: ActionId, chord: Chord) => {
    const next = { ...get().bindings };
    for (const a of ACTIONS) if (a.id !== id && sameChord(next[a.id], chord)) next[a.id] = null;
    next[id] = chord;
    put(next);
  };
  return {
    bindings: loadBindings(),
    recording: false,
    set: (id, chord) => put({ ...get().bindings, [id]: chord }),
    replace,
    reset: (id) => replace(id, DEFAULT_BINDINGS[id]!),
    resetAll: () => put({ ...DEFAULT_BINDINGS }),
    setRecording: (recording) => setState({ recording }),
  };
});

/** The action's key as shown in hints (`⌘E`), or null when it has none. */
export function useShortcutLabel(id: ActionId): string | null {
  const chord = useShortcuts((s) => s.bindings[id]);
  return chord ? formatChord(chord) : null;
}
