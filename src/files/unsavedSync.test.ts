import { beforeEach, describe, expect, it } from "vitest";
import { createEditorState } from "./editorSetup";
import { draftKey, useDrafts, type DiskVersion } from "./drafts";
import { syncUnsaved } from "./unsavedSync";

const target = { fk: "k", machineId: "local", root: "/r", rel: "a.txt" };
const base: DiskVersion = { text: "one\n", size: 4, mtime: 1, cksum: 1 };
const key = draftKey("k", "a.txt");
const type = (insert: string) => {
  const s = useDrafts.getState().drafts[key].state;
  useDrafts.getState().update(key, s.update({ changes: { from: s.doc.length, insert } }).state);
};

describe("syncUnsaved", () => {
  beforeEach(() => useDrafts.setState(useDrafts.getInitialState(), true));

  it("reports false at once, then only when whether any Draft is dirty changes", () => {
    const calls: boolean[] = [];
    const stop = syncUnsaved((u) => calls.push(u));
    expect(calls).toEqual([false]);
    useDrafts.getState().open(target, base, createEditorState("one\n"));
    expect(calls).toEqual([false]);
    type("x");
    type("y");
    expect(calls).toEqual([false, true]);
    useDrafts.getState().drop(key);
    expect(calls).toEqual([false, true, false]);
    stop();
    useDrafts.getState().open(target, base, createEditorState("one\n"));
    type("z");
    expect(calls).toEqual([false, true, false]);
  });
});
