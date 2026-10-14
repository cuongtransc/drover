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
import { useApp } from "../store/app";
import { itemKey } from "../store/openItems";
import { useFilesBus } from "./bus";
import { useDrafts } from "./drafts";
import { FileViewer } from "./FileViewer";
import { useFiles } from "./store";
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

  it("hides Outline, Render/Source and the find bar while a Draft exists", async () => {
    Object.assign(disk, { text: "# T\n" });
    const md = { ...item, rel: "a.md" };
    render(<FileViewer item={md} online />);
    expect(await screen.findByRole("button", { name: "Source" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Outline" })).toBeNull();
    press("f", { metaKey: true });
    expect(screen.queryByRole("textbox", { name: /find/i })).toBeNull();
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
});
