import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../ui/Toast", () => ({ showToast: vi.fn() }));
import { showToast } from "../ui/Toast";
import { draftKey, useDrafts } from "./drafts";
import { saveDraft } from "./save";

const fk = "fk";
const key = draftKey(fk, "src/a.txt");
const open = (text = "one\n") =>
  useDrafts.getState().open({ fk, machineId: "m1", root: "/r", rel: "src/a.txt" }, { text, size: text.length, mtime: 10, cksum: 99 });
const typeEnd = (s: string) => {
  const st = useDrafts.getState().drafts[key].state;
  useDrafts.getState().update(key, st.update({ changes: { from: st.doc.length, insert: s } }).state);
};

describe("saveDraft", () => {
  beforeEach(() => {
    useDrafts.setState(useDrafts.getInitialState(), true);
    vi.mocked(invoke).mockReset();
    vi.mocked(showToast).mockClear();
  });

  it("writes the text over the base version and takes the new version", async () => {
    open();
    typeEnd("two\n");
    vi.mocked(invoke).mockResolvedValueOnce({ size: 8, mtime: 11, cksum: 5 });
    expect(await saveDraft(key, { force: false })).toBe(true);
    expect(invoke).toHaveBeenCalledWith("files_write", {
      machineId: "m1", root: "/r", rel: "src/a.txt", text: "one\ntwo\n", expected: { size: 4, mtime: 10, cksum: 99 },
    });
    expect(useDrafts.getState().drafts[key]).toMatchObject({ dirty: false, saving: false, base: { text: "one\ntwo\n", cksum: 5 } });
  });

  it("forces with no expected version", async () => {
    open();
    vi.mocked(invoke).mockResolvedValueOnce({ size: 4, mtime: 12, cksum: 6 });
    await saveDraft(key, { force: true });
    expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({ expected: null });
  });

  it("marks a conflict or a removal and keeps the edits", async () => {
    open();
    typeEnd("x");
    vi.mocked(invoke).mockRejectedValueOnce({ code: "conflict", message: "src/a.txt changed on disk" });
    expect(await saveDraft(key, { force: false })).toBe(false);
    expect(useDrafts.getState().drafts[key]).toMatchObject({ conflict: "changed", dirty: true, saving: false });
    expect(await saveDraft(key, { force: false })).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    useDrafts.getState().setConflict(key, null);
    vi.mocked(invoke).mockRejectedValueOnce({ code: "not_found", message: "no such file" });
    await saveDraft(key, { force: false });
    expect(useDrafts.getState().drafts[key].conflict).toBe("removed");
  });

  it("reports other failures in a toast; a second call while saving joins the running save", async () => {
    open();
    let fail!: (e: unknown) => void;
    vi.mocked(invoke).mockReturnValueOnce(new Promise((_, rej) => (fail = rej)));
    const first = saveDraft(key, { force: false });
    const second = saveDraft(key, { force: false });
    expect(invoke).toHaveBeenCalledTimes(1);
    fail({ code: "io", message: "disk full" });
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("Cannot save a.txt: disk full");
    expect(useDrafts.getState().drafts[key]).toMatchObject({ saving: false, conflict: null });
  });

  it("does nothing when the Draft was dropped during the save", async () => {
    open();
    let done!: (v: unknown) => void;
    vi.mocked(invoke).mockReturnValueOnce(new Promise((res) => (done = res)));
    const p = saveDraft(key, { force: false });
    useDrafts.getState().drop(key);
    done({ size: 4, mtime: 11, cksum: 5 });
    expect(await p).toBe(true);
    expect(useDrafts.getState().drafts).toEqual({});
  });

  it("keeps the Draft usable when a read rebases it during the save", async () => {
    open();
    let done!: (v: unknown) => void;
    vi.mocked(invoke).mockReturnValueOnce(new Promise((res) => (done = res)));
    const p = saveDraft(key, { force: true });
    useDrafts.getState().rebase(key, { text: "other\n", size: 6, mtime: 20, cksum: 1 });
    done({ size: 4, mtime: 11, cksum: 5 });
    expect(await p).toBe(true);
    expect(useDrafts.getState().drafts[key]).toMatchObject({ saving: false, base: { text: "one\n", cksum: 5 } });
  });

  it("ignores the result for a Draft re-opened during the save", async () => {
    open();
    let done!: (v: unknown) => void;
    vi.mocked(invoke).mockReturnValueOnce(new Promise((res) => (done = res)));
    const p = saveDraft(key, { force: true });
    open("fresh\n");
    done({ size: 4, mtime: 11, cksum: 5 });
    await p;
    expect(useDrafts.getState().drafts[key]).toMatchObject({ saving: false, base: { text: "fresh\n", cksum: 99 } });
  });

  it("two calls without awaiting write once and share the result", async () => {
    open();
    typeEnd("x");
    vi.mocked(invoke).mockResolvedValueOnce({ size: 5, mtime: 11, cksum: 5 });
    const [a, b] = await Promise.all([saveDraft(key, { force: false }), saveDraft(key, { force: false })]);
    expect([a, b]).toEqual([true, true]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("a CRLF file saves, ends clean, and the editor text equals the base text", async () => {
    open("a\r\n");
    typeEnd("b");
    const written = { size: 6, mtime: 11, cksum: 7 };
    vi.mocked(invoke).mockResolvedValueOnce(written);
    expect(await saveDraft(key, { force: false })).toBe(true);
    const text = vi.mocked(invoke).mock.calls[0][1] as { text: string };
    expect(text.text).toBe("a\r\nb");
    const d = useDrafts.getState().drafts[key];
    expect(d.base).toMatchObject({ ...written, text: "a\r\nb" });
    expect(d.dirty).toBe(false);
    expect(d.state.sliceDoc()).toBe(d.base.text);
  });

  it("an edit between two calls is written by a second save", async () => {
    open();
    typeEnd("x");
    let done!: (v: unknown) => void;
    vi.mocked(invoke).mockReturnValueOnce(new Promise((res) => (done = res)));
    vi.mocked(invoke).mockResolvedValueOnce({ size: 6, mtime: 12, cksum: 6 });
    const first = saveDraft(key, { force: false });
    typeEnd("y");
    let second: boolean | undefined;
    const p2 = saveDraft(key, { force: false }).then((v) => (second = v));
    done({ size: 5, mtime: 11, cksum: 5 });
    await first;
    await p2;
    expect(second).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({ text: "one\nx" });
    expect(vi.mocked(invoke).mock.calls[1][1]).toMatchObject({ text: "one\nxy", expected: { cksum: 5 } });
    expect(useDrafts.getState().drafts[key]).toMatchObject({ dirty: false, base: { text: "one\nxy", cksum: 6 } });
  });

  it("a forced call joining a plain save writes again with force", async () => {
    open();
    let done!: (v: unknown) => void;
    vi.mocked(invoke).mockReturnValueOnce(new Promise((res) => (done = res)));
    vi.mocked(invoke).mockResolvedValueOnce({ size: 4, mtime: 12, cksum: 6 });
    const first = saveDraft(key, { force: false });
    const second = saveDraft(key, { force: true });
    done({ size: 4, mtime: 11, cksum: 5 });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(vi.mocked(invoke).mock.calls[1][1]).toMatchObject({ expected: null });
  });

  it("a joined call returns false when the running save failed", async () => {
    open();
    let fail!: (e: unknown) => void;
    vi.mocked(invoke).mockReturnValueOnce(new Promise((_, rej) => (fail = rej)));
    const first = saveDraft(key, { force: false });
    const second = saveDraft(key, { force: true });
    fail({ code: "conflict", message: "changed" });
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("a Draft re-opened during a save is written by its own save", async () => {
    open();
    let done!: (v: unknown) => void;
    vi.mocked(invoke).mockReturnValueOnce(new Promise((res) => (done = res)));
    vi.mocked(invoke).mockResolvedValueOnce({ size: 6, mtime: 13, cksum: 8 });
    const old = saveDraft(key, { force: false });
    open("fresh\n");
    typeEnd("z");
    expect(await saveDraft(key, { force: false })).toBe(true);
    done({ size: 4, mtime: 11, cksum: 5 });
    await old;
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(vi.mocked(invoke).mock.calls[1][1]).toMatchObject({ text: "fresh\nz" });
    expect(useDrafts.getState().drafts[key]).toMatchObject({ dirty: false, base: { text: "fresh\nz", cksum: 8 } });
  });
});
