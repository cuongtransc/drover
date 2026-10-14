import type { EditorState, Text } from "@codemirror/state";
import { create } from "zustand";
import type { FileVersion } from "../lib/types";

// Types only: this module is in the eager bundle (Open items, strip, quit guard); CodeMirror loads with the viewer.

/** What a file looked like on disk when a Draft last matched it. */
export interface DiskVersion extends FileVersion {
  text: string;
}

export interface DraftTarget {
  fk: string;
  machineId: string;
  root: string;
  rel: string;
}

export interface Draft extends DraftTarget {
  /** Stable for the life of the Draft (survives rebase and save); a new `open()` gets a new one. */
  id: number;
  state: EditorState;
  base: DiskVersion;
  /** `base.text` as a document; the Draft is dirty when `state.doc` differs from it. */
  baseDoc: Text;
  dirty: boolean;
  conflict: "changed" | "removed" | null;
  saving: boolean;
  /** Bumped by every save that lands, so a read that began before it can tell it is out of date. */
  gen: number;
}

/** A Draft's key is its file Open item's key. */
export const draftKey = (fk: string, rel: string): string => "file:" + fk + "|" + rel;

interface DraftsState {
  drafts: Record<string, Draft>;
  /** (Re)creates a clean Draft over `state`, built from `base.text` by the caller (createEditorState). */
  open(target: DraftTarget, base: DiskVersion, state: EditorState): void;
  update(key: string, state: EditorState): void;
  /** A clean Draft takes the new disk content; a dirty or saving one is left alone. */
  rebase(key: string, base: DiskVersion, state: EditorState): void;
  saved(key: string, base: DiskVersion): void;
  /** The disk file has the same size and checksum as the base (only its mtime moved): keeps the state and history. */
  touch(key: string, mtime: number): void;
  setConflict(key: string, c: "changed" | "removed" | null): void;
  setSaving(key: string, on: boolean): void;
  drop(key: string): void;
}

let nextId = 1;

export const useDrafts = create<DraftsState>()((set) => {
  const patch = (key: string, f: (d: Draft) => Partial<Draft>) =>
    set((s) => {
      const d = s.drafts[key];
      return d ? { drafts: { ...s.drafts, [key]: { ...d, ...f(d) } } } : s;
    });
  const without = (drafts: Record<string, Draft>, keep: (d: Draft) => boolean) =>
    Object.fromEntries(Object.entries(drafts).filter(([, d]) => keep(d)));

  return {
    drafts: {},
    open: (target, base, state) => {
      const draft: Draft = { ...target, id: nextId++, state, base, baseDoc: state.doc, dirty: false, conflict: null, saving: false, gen: 0 };
      set((s) => ({ drafts: { ...s.drafts, [draftKey(target.fk, target.rel)]: draft } }));
    },
    update: (key, state) => patch(key, (d) => ({ state, dirty: !state.doc.eq(d.baseDoc) })),
    rebase: (key, base, state) =>
      patch(key, (d) => {
        if (d.dirty || d.saving) return {};
        return { state, base, baseDoc: state.doc };
      }),
    saved: (key, base) =>
      patch(key, (d) => {
        const baseDoc = d.state.toText(base.text);
        return { base, baseDoc, dirty: !d.state.doc.eq(baseDoc), conflict: null, saving: false, gen: d.gen + 1 };
      }),
    touch: (key, mtime) => patch(key, (d) => ({ base: { ...d.base, mtime }, conflict: null })),
    setConflict: (key, conflict) => patch(key, () => ({ conflict })),
    setSaving: (key, saving) => patch(key, () => ({ saving })),
    drop: (key) => set((s) => (key in s.drafts ? { drafts: without(s.drafts, (d) => draftKey(d.fk, d.rel) !== key) } : s)),
  };
});

export const isDirty = (key: string): boolean => useDrafts.getState().drafts[key]?.dirty ?? false;
