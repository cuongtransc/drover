import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const win = vi.hoisted(() => ({
  closeHandler: null as null | ((e: { preventDefault: () => void }) => Promise<void> | void),
  destroy: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]), Channel: class {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (cb: typeof win.closeHandler) => {
      win.closeHandler = cb;
      return () => {};
    },
    destroy: win.destroy,
  }),
}));
const save = vi.hoisted(() => ({ saveDraft: vi.fn(async (_k: string, _o?: unknown): Promise<boolean> => true) }));
vi.mock("./files/save", () => save);
vi.mock("./terminal/TerminalLens", () => ({ TerminalLens: () => null }));

import App from "./App";
import { draftKey, useDrafts } from "./files/drafts";
import { filesKey } from "./files/store";

const fk = filesKey({ machine_id: "local", session: "default", workspace_id: "w1" }, "/r");
const openDraft = (rel: string, dirty: boolean) => {
  useDrafts.getState().open({ fk, machineId: "local", root: "/r", rel }, { text: "t", size: 1, mtime: 1, cksum: 1 });
  if (dirty) {
    const s = useDrafts.getState().drafts[draftKey(fk, rel)].state;
    useDrafts.getState().update(draftKey(fk, rel), s.update({ changes: { from: 0, insert: "!" } }).state);
  }
};
const quitRequested = async () => {
  const { listen } = await import("@tauri-apps/api/event");
  const find = () => vi.mocked(listen).mock.calls.filter(([n]) => n === "app://quit-requested").pop();
  await waitFor(() => expect(find()).toBeTruthy());
  const call = find();
  return () => (call![1] as (e: unknown) => void)({ payload: null });
};
const quitCalls = async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  return vi.mocked(invoke).mock.calls.filter(([c]) => c === "app_quit").length;
};

describe("quitting and closing the window with unsaved Drafts", () => {
  beforeEach(async () => {
    useDrafts.setState(useDrafts.getInitialState(), true);
    win.closeHandler = null;
    win.destroy.mockClear();
    save.saveDraft.mockReset().mockResolvedValue(true);
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    vi.mocked(invoke).mockClear();
    vi.mocked(listen).mockClear();
  });

  it("quit: Cancel keeps the app, Discard quits", async () => {
    openDraft("a.txt", true);
    render(<App />);
    const fire = await quitRequested();
    act(() => void fire());
    expect(await screen.findByText("Save changes to a.txt?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Save changes to a.txt?")).toBeNull());
    expect(await quitCalls()).toBe(0);
    expect(useDrafts.getState().drafts[draftKey(fk, "a.txt")]).toBeTruthy();

    act(() => void fire());
    await screen.findByText("Save changes to a.txt?");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(async () => expect(await quitCalls()).toBe(1));
  });

  it("quit with nothing dirty goes straight through; a second request while asking opens no second dialog", async () => {
    render(<App />);
    const fire = await quitRequested();
    act(() => void fire());
    await waitFor(async () => expect(await quitCalls()).toBe(1));

    openDraft("a.txt", true);
    act(() => void fire());
    await screen.findByText("Save changes to a.txt?");
    act(() => void fire());
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(await quitCalls()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("window close: untouched when clean, asks when dirty, destroys on Discard", async () => {
    render(<App />);
    await waitFor(() => expect(win.closeHandler).toBeTruthy());
    const clean = { preventDefault: vi.fn() };
    await act(async () => void (await win.closeHandler!(clean)));
    expect(clean.preventDefault).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    openDraft("a.txt", true);
    const dirty = { preventDefault: vi.fn() };
    act(() => void win.closeHandler!(dirty));
    await screen.findByText("Save changes to a.txt?");
    expect(dirty.preventDefault).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText("Save changes to a.txt?")).toBeNull());
    expect(win.destroy).not.toHaveBeenCalled();

    act(() => void win.closeHandler!({ preventDefault: vi.fn() }));
    await screen.findByText("Save changes to a.txt?");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(win.destroy).toHaveBeenCalledTimes(1));
  });

  it("Save that fails (conflict) keeps the app open: no app_quit, no destroy", async () => {
    save.saveDraft.mockResolvedValue(false);
    openDraft("a.txt", true);
    useDrafts.getState().setConflict(draftKey(fk, "a.txt"), "changed");
    render(<App />);
    const fire = await quitRequested();
    await waitFor(() => expect(win.closeHandler).toBeTruthy());
    act(() => void fire());
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(save.saveDraft).toHaveBeenCalled());
    act(() => void win.closeHandler!({ preventDefault: vi.fn() }));
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await waitFor(() => expect(save.saveDraft).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await quitCalls()).toBe(0);
    expect(win.destroy).not.toHaveBeenCalled();
    expect(useDrafts.getState().drafts[draftKey(fk, "a.txt")]).toBeTruthy();
  });

  it("a failing check keeps the app open with a toast, and the next request goes through", async () => {
    save.saveDraft.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    openDraft("a.txt", true);
    render(<App />);
    const fire = await quitRequested();
    act(() => void fire());
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByText("Could not check unsaved edits; close again to discard")).toBeTruthy();
    expect(await quitCalls()).toBe(0);
    act(() => void fire());
    await waitFor(async () => expect(await quitCalls()).toBe(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
