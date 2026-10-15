import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const disk = vi.hoisted(() => ({ kind: "text", text: "one\n", cksum: 9 as number | null, mtime: 1, editable: true, truncated: false }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: { text?: string }) => {
    if (cmd === "files_read") return { ...disk, size: disk.text.length };
    if (cmd === "files_write") return { size: args!.text!.length, mtime: 2, cksum: 10 };
    return [];
  }),
  Channel: class {},
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }));
vi.mock("../ui/Toast", () => ({ showToast: vi.fn(), showProgressToast: vi.fn(() => 1), updateToast: vi.fn() }));
import { showToast } from "../ui/Toast";
import { useApp } from "../store/app";
import { itemKey } from "../store/openItems";
import { useFilesBus } from "./bus";
import { useDrafts } from "./drafts";
import { requestFind } from "./findBus";
import { FileViewer } from "./FileViewer";
import { filesKey, useFiles } from "./store";
import { UnsavedDialog } from "./unsaved";

const ws = { machine_id: "local", session: "default", workspace_id: "w1" };
const item = { kind: "file" as const, ws, root: "/r", rel: "a.txt" };
const key = itemKey(item);
const press = (k: string, extra: Partial<KeyboardEventInit> = {}) => act(() => void fireEvent.keyDown(window, { key: k, ...extra }));
const view = () => EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
const typeAtEnd = (s: string) => act(() => view().dispatch({ changes: { from: view().state.doc.length, insert: s } }));
const writes = () => vi.mocked(invoke).mock.calls.filter((c) => c[0] === "files_write");
const editBtn = () => screen.queryByRole("button", { name: "Edit" });
const startEditing = async () => {
  render(<><FileViewer item={item} online /><UnsavedDialog /></>);
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
};

describe("FileViewer edit mode", () => {
  beforeEach(() => {
    Object.assign(disk, { kind: "text", text: "one\n", cksum: 9, mtime: 1, editable: true, truncated: false });
    useFiles.setState(useFiles.getInitialState(), true);
    useFilesBus.setState(useFilesBus.getInitialState(), true);
    useApp.setState(useApp.getInitialState(), true);
    useDrafts.setState(useDrafts.getInitialState(), true);
    vi.mocked(invoke).mockClear();
  });

  it("opens in view mode for an editable file: an Edit button, no editor", async () => {
    render(<FileViewer item={item} online />);
    expect(await screen.findByRole("button", { name: "Edit" })).toBeTruthy();
    expect(document.querySelector(".cm-editor")).toBeNull();
    expect(screen.getByRole("group", { name: "Edit" })).toBeTruthy();
  });

  it("offers no Edit for an image, a binary, a truncated or an invalid-UTF-8 file", async () => {
    const cases: Partial<typeof disk>[] = [
      { kind: "image", editable: false },
      { kind: "binary", editable: false },
      { truncated: true, editable: false },
      { editable: false, cksum: null },
    ];
    for (const c of cases) {
      Object.assign(disk, { kind: "text", text: "one\n", cksum: 9, editable: true, truncated: false }, c);
      vi.mocked(invoke).mockClear();
      const { unmount } = render(<FileViewer item={item} online />);
      await waitFor(() => expect(vi.mocked(invoke).mock.calls.some((x) => x[0] === "files_read")).toBe(true));
      await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
      expect(editBtn()).toBeNull();
      unmount();
    }
  });

  it("a disabled Edit titled 'Mixed line endings' for mixed line endings", async () => {
    Object.assign(disk, { text: "a\r\nb\nc" });
    render(<FileViewer item={item} online />);
    const edit = (await screen.findByRole("button", { name: "Edit" })) as HTMLButtonElement;
    expect(edit.disabled).toBe(true);
    expect(edit.title).toBe("Mixed line endings");
  });

  it("Edit, type, ⌘S saves over the read version, Done leaves", async () => {
    await startEditing();
    expect(document.querySelector(".cm-editor")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    typeAtEnd("two\n");
    press("s", { metaKey: true });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toMatchObject({ rel: "a.txt", text: "one\ntwo\n", expected: { size: 4, mtime: 1, cksum: 9 } });
    await waitFor(() => expect(useDrafts.getState().drafts[key].dirty).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeNull());
    expect(useDrafts.getState().drafts[key]).toBeUndefined();
  });

  it("Edit › Find… opens the editor's own search while editing, not the viewer's find bar", async () => {
    render(<FileViewer item={item} online />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull());
    act(() => requestFind("open"));
    await waitFor(() => expect(document.querySelector(".cm-search")).not.toBeNull());
    expect(screen.queryByPlaceholderText("Find in file")).toBeNull();
  });

  it("hides Outline, Render/Source and the find bar while a Draft exists", async () => {
    Object.assign(disk, { text: "# T\n" });
    const md = { ...item, rel: "a.md" };
    render(<FileViewer item={md} online />);
    expect(await screen.findByRole("button", { name: "Source" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Outline" })).toBeNull();
    // ⌘F belongs to the editor's own search; the viewer's find bar must not open behind it.
    press("f", { metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeNull());
    expect(screen.queryByRole("checkbox", { name: "Match case" }) ?? screen.queryByLabelText("Match case")).toBeNull();
  });

  it("no Edit group for an image", async () => {
    Object.assign(disk, { kind: "image", editable: false });
    render(<FileViewer item={{ ...item, rel: "a.png" }} online />);
    await waitFor(() => expect(vi.mocked(invoke).mock.calls.some((x) => x[0] === "files_read")).toBe(true));
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
    expect(screen.queryByRole("group", { name: "Edit" })).toBeNull();
  });

  it("Esc that repeats or comes from an IME composition does not leave Edit mode", async () => {
    await startEditing();
    press("Escape", { repeat: true });
    press("Escape", { isComposing: true });
    expect(document.querySelector(".cm-editor")).toBeTruthy();
  });

  it("Save without edits on a CRLF file writes the same bytes", async () => {
    Object.assign(disk, { text: "x\r\ny\r\n" });
    await startEditing();
    typeAtEnd("z");
    act(() => view().dispatch({ changes: { from: view().state.doc.length - 1, to: view().state.doc.length, insert: "" } }));
    // Back to the original text: not dirty, so the Draft's text is the file's text.
    expect(useDrafts.getState().drafts[key].state.sliceDoc()).toBe("x\r\ny\r\n");
    await act(async () => void (await import("./save")).saveDraft(key, { force: true }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toMatchObject({ text: "x\r\ny\r\n" });
  });

  it("Edit pins the Open item before the Draft can be dirty, so another file keeps it", async () => {
    useApp.getState().openFile(ws, "/r", "a.txt", { pin: false });
    expect(useApp.getState().openItems.preview).toBe(key);
    render(<><FileViewer item={item} online /><UnsavedDialog /></>);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(useApp.getState().openItems.preview).toBeNull();
    typeAtEnd("x");
    act(() => useApp.getState().openFile(ws, "/r", "b.txt", { pin: false }));
    expect(useApp.getState().openItems.items.map(itemKey)).toEqual([key, itemKey({ ...item, rel: "b.txt" })]);
  });

  it("⌘⇧E enters and leaves; with unsaved changes it asks and Cancel stays", async () => {
    render(<><FileViewer item={item} online /><UnsavedDialog /></>);
    await screen.findByRole("button", { name: "Edit" });
    press("e", { metaKey: true, shiftKey: true });
    expect(document.querySelector(".cm-editor")).toBeTruthy();
    typeAtEnd("x");
    press("e", { metaKey: true, shiftKey: true });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.querySelector(".cm-editor")).toBeTruthy();
  });

  it("Esc is Done: a clean Draft leaves, a dirty one asks, Cancel stays", async () => {
    await startEditing();
    press("Escape");
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeNull());
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    typeAtEnd("x");
    press("Escape");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.querySelector(".cm-editor")).toBeTruthy();
  });

  it("Esc while the Unsaved dialog is open neither asks again nor leaves Edit mode", async () => {
    await startEditing();
    typeAtEnd("x");
    press("Escape");
    expect(await screen.findByRole("dialog")).toBeTruthy();
    press("Escape");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelector(".cm-editor")).toBeTruthy();
    expect(useDrafts.getState().drafts[key]?.dirty).toBe(true);
  });

  it("Esc that closes the editor's search panel does not leave Edit mode", async () => {
    await startEditing();
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    ev.preventDefault();
    act(() => void window.dispatchEvent(ev));
    expect(document.querySelector(".cm-editor")).toBeTruthy();
  });

  it("Esc with the editor's search panel still open does not leave Edit mode", async () => {
    await startEditing();
    const panel = document.createElement("div");
    panel.className = "cm-search";
    document.querySelector(".files-editor")!.appendChild(panel);
    press("Escape");
    expect(document.querySelector(".cm-editor")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("mounts the editor only once its Draft exists, inside .files-view", async () => {
    render(<FileViewer item={item} online />);
    await screen.findByRole("button", { name: "Edit" });
    expect(document.querySelector(".files-editor")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(document.querySelector(".files-view > .files-editor")).toBeTruthy();
  });

  it("a dirty Draft is never replaced: remounting keeps it, ⌘⇧E does not reopen it", async () => {
    const first = render(<FileViewer key="1" item={item} online />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    typeAtEnd("kept");
    first.unmount();
    const id = useDrafts.getState().drafts[key].id;
    render(<><FileViewer key="2" item={item} online /><UnsavedDialog /></>);
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("onekept"));
    press("e", { metaKey: true, shiftKey: true });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(useDrafts.getState().drafts[key]).toMatchObject({ id, dirty: true });
  });

  it("Reload keeps edits typed while the disk version was being read", async () => {
    await startEditing();
    typeAtEnd("mine");
    act(() => useDrafts.getState().setConflict(key, "changed"));
    let land!: (v: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((r) => (land = r)));
    fireEvent.click(await screen.findByRole("button", { name: "Reload" }));
    await waitFor(() => expect(land).toBeDefined());
    typeAtEnd("more");
    await act(async () => land({ kind: "text", text: "agent\n", truncated: false, size: 6, mtime: 3, cksum: 22, editable: true }));
    expect(document.querySelector(".cm-content")?.textContent).toContain("onemine" + "more");
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("Not reloaded"));
    expect(useDrafts.getState().drafts[key].dirty).toBe(true);
  });

  it("Reload takes the disk version and drops the edits", async () => {
    await startEditing();
    typeAtEnd("mine");
    Object.assign(disk, { text: "agent\n", cksum: 22 });
    act(() => useDrafts.getState().setConflict(key, "changed"));
    fireEvent.click(await screen.findByRole("button", { name: "Reload" }));
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toBe("agent"));
    expect(useDrafts.getState().drafts[key]).toMatchObject({ dirty: false, conflict: null, base: { cksum: 22 } });
  });

  it("⌘S in a conflict does not write, it flashes the banner; Overwrite forces", async () => {
    await startEditing();
    typeAtEnd("mine");
    act(() => useDrafts.getState().setConflict(key, "changed"));
    press("s", { metaKey: true });
    expect(writes()).toHaveLength(0);
    expect(document.querySelector(".files-banner-conflict")?.classList.contains("flash")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toMatchObject({ expected: null, text: "one\nmine" });
    await waitFor(() => expect(screen.queryByText("File changed on disk")).toBeNull());
  });

  it("a removed conflict offers Save again and Close", async () => {
    await startEditing();
    typeAtEnd("mine");
    act(() => useDrafts.getState().setConflict(key, "removed"));
    expect(await screen.findByText("File was deleted")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save again" }));
    await waitFor(() => expect(writes()[0][1]).toMatchObject({ expected: null }));
  });

  const publish = (changes: { path: string; isDir: boolean; removed: boolean }[]) =>
    act(() => useFilesBus.getState().publish(filesKey(ws, "/r"), changes));
  const own = { path: "a.txt", isDir: false, removed: false };
  const reads = () => vi.mocked(invoke).mock.calls.filter((c) => c[0] === "files_read").length;
  const text = () => document.querySelector(".cm-content")?.textContent;

  it("a clean Draft follows the agent's write", async () => {
    await startEditing();
    Object.assign(disk, { text: "agent\n", cksum: 20, mtime: 5 });
    publish([own]);
    await waitFor(() => expect(text()).toContain("agent"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a dirty Draft keeps text and undo after a new cksum; same cksum with a new mtime raises nothing", async () => {
    await startEditing();
    typeAtEnd("mine");
    disk.mtime = 7;
    publish([own]);
    await waitFor(() => expect(reads()).toBe(2));
    expect(screen.queryByText("File changed on disk")).toBeNull();
    await waitFor(() => expect(useDrafts.getState().drafts[key].base.mtime).toBe(7));
    const state = useDrafts.getState().drafts[key].state;
    Object.assign(disk, { text: "agent\n", cksum: 21 });
    publish([own]);
    expect(await screen.findByText("File changed on disk")).toBeTruthy();
    expect(text()).toContain("one" + "mine");
    expect(useDrafts.getState().drafts[key].state).toBe(state);
    expect(undo(view())).toBe(true);
    expect(text()).toBe("one");
  });

  it("a touch refreshes the mtime, so the next save is not a false conflict", async () => {
    await startEditing();
    typeAtEnd("mine");
    disk.mtime = 7;
    publish([own]);
    await waitFor(() => expect(useDrafts.getState().drafts[key].base.mtime).toBe(7));
    press("s", { metaKey: true });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toMatchObject({ expected: { size: 4, mtime: 7, cksum: 9 } });
  });

  it("⌘R and switching away and back never replace a dirty Draft", async () => {
    const first = render(<FileViewer key="1" item={item} online />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    typeAtEnd("mine");
    const state = useDrafts.getState().drafts[key].state;
    Object.assign(disk, { text: "agent\n", cksum: 31 });
    press("r", { metaKey: true });
    expect(await screen.findByText("File changed on disk")).toBeTruthy();
    first.unmount();
    render(<FileViewer key="2" item={item} online />);
    await waitFor(() => expect(reads()).toBe(3));
    expect(await screen.findByText("File changed on disk")).toBeTruthy();
    expect(text()).toContain("onemine");
    expect(useDrafts.getState().drafts[key]).toMatchObject({ dirty: true });
    expect(useDrafts.getState().drafts[key].state).toBe(state);
  });

  it("Reload takes the disk version after a batch", async () => {
    await startEditing();
    typeAtEnd("mine");
    Object.assign(disk, { text: "agent\n", cksum: 22 });
    publish([own]);
    fireEvent.click(await screen.findByRole("button", { name: "Reload" }));
    await waitFor(() => expect(text()).toBe("agent"));
    expect(useDrafts.getState().drafts[key]).toMatchObject({ dirty: false, conflict: null, base: { cksum: 22 } });
  });

  it("⌘S while the banner is up does not write; Overwrite writes with expected null", async () => {
    await startEditing();
    typeAtEnd("mine");
    Object.assign(disk, { text: "agent\n", cksum: 21 });
    publish([own]);
    await screen.findByText("File changed on disk");
    press("s", { metaKey: true });
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1]).toMatchObject({ expected: null, text: "one\nmine" });
    await waitFor(() => expect(screen.queryByText("File changed on disk")).toBeNull());
  });

  it("a read landing while the app's own save is in flight raises nothing, before or after the save", async () => {
    await startEditing();
    typeAtEnd("two\n");
    let finish!: (v: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((r) => (finish = r)));
    press("s", { metaKey: true });
    await waitFor(() => expect(useDrafts.getState().drafts[key].saving).toBe(true));
    // The disk already has the saved text; the watch echo reads it while the write has not returned.
    Object.assign(disk, { text: "one\ntwo\n", cksum: 10, mtime: 2 });
    publish([own]);
    await waitFor(() => expect(reads()).toBe(2));
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    // Still saving: nothing may have been raised yet.
    expect(useDrafts.getState().drafts[key]).toMatchObject({ saving: true, conflict: null });
    expect(screen.queryByText("File changed on disk")).toBeNull();
    await act(async () => finish({ size: 8, mtime: 2, cksum: 10 }));
    expect(screen.queryByText("File changed on disk")).toBeNull();
    expect(useDrafts.getState().drafts[key]).toMatchObject({ dirty: false, conflict: null });
  });

  it("a read that began before the save and lands after it is ignored, even with a different mtime", async () => {
    await startEditing();
    typeAtEnd("two\n");
    let land!: (v: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((r) => (land = r)));
    publish([own]);
    await waitFor(() => expect(land).toBeDefined());
    press("s", { metaKey: true });
    await waitFor(() => expect(useDrafts.getState().drafts[key]).toMatchObject({ dirty: false, saving: false, gen: 1 }));
    const state = useDrafts.getState().drafts[key].state;
    expect(useDrafts.getState().drafts[key].base.mtime).toBe(2);
    // Same bytes as the saved text, a later mtime: without the gen guard this would refresh the base.
    await act(async () => land({ kind: "text", text: "one\ntwo\n", truncated: false, size: 8, mtime: 3, cksum: 10, editable: true }));
    expect(useDrafts.getState().drafts[key].base.mtime).toBe(2);
    expect(useDrafts.getState().drafts[key].state).toBe(state);
    expect(useDrafts.getState().drafts[key].conflict).toBeNull();
  });

  it("a deleted file under a dirty Draft says so; Save again recreates it", async () => {
    await startEditing();
    typeAtEnd("mine");
    publish([{ ...own, removed: true }]);
    expect(await screen.findByText("File was deleted")).toBeTruthy();
    expect(screen.queryByText("File removed")).toBeNull();
    expect(text()).toContain("onemine");
    fireEvent.click(screen.getByRole("button", { name: "Save again" }));
    await waitFor(() => expect(writes()[0][1]).toMatchObject({ expected: null, text: "one\nmine" }));
  });

  it("Close on a deleted file asks first (the Draft is dirty); Discard closes the item", async () => {
    useApp.getState().openFile(ws, "/r", "a.txt", { pin: true });
    await startEditing();
    typeAtEnd("mine");
    publish([{ ...own, removed: true }]);
    await screen.findByText("File was deleted");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(useApp.getState().openItems.items.map(itemKey)).toEqual([key]);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(useApp.getState().openItems.items).toHaveLength(0));
    expect(useDrafts.getState().drafts[key]).toBeUndefined();
  });

  it("Close on a deleted file then Cancel keeps the Draft and the item", async () => {
    useApp.getState().openFile(ws, "/r", "a.txt", { pin: true });
    await startEditing();
    typeAtEnd("mine");
    publish([{ ...own, removed: true }]);
    await screen.findByText("File was deleted");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useDrafts.getState().drafts[key]).toMatchObject({ dirty: true, conflict: "removed" });
    expect(useApp.getState().openItems.items).toHaveLength(1);
  });

  it("a failed read while the machine is offline is not a deletion", async () => {
    render(<FileViewer item={item} online={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    typeAtEnd("mine");
    vi.mocked(invoke).mockImplementationOnce(async () => {
      throw { code: "not_found", message: "machine local is not connected" };
    });
    publish([own]);
    await waitFor(() => expect(reads()).toBe(2));
    await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
    expect(screen.queryByText("File was deleted")).toBeNull();
    expect(useDrafts.getState().drafts[key].conflict).toBeNull();
  });

  it("a read that began before a save and lands after it is ignored", async () => {
    await startEditing();
    typeAtEnd("mine");
    let land!: (v: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(() => new Promise((r) => (land = r)));
    publish([own]);
    await waitFor(() => expect(land).toBeDefined());
    press("s", { metaKey: true });
    await waitFor(() => expect(useDrafts.getState().drafts[key]).toMatchObject({ dirty: false, saving: false }));
    const state = useDrafts.getState().drafts[key].state;
    await act(async () => land({ kind: "text", text: "one\n", truncated: false, size: 4, mtime: 1, cksum: 9, editable: true }));
    expect(screen.queryByText("File changed on disk")).toBeNull();
    expect(useDrafts.getState().drafts[key].state).toBe(state);
    expect(useDrafts.getState().drafts[key].base.cksum).toBe(10);
  });
});
