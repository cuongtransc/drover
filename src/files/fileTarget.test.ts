import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({
  menuSetFileTarget: vi.fn(async () => {}),
  onMenuFile: vi.fn(async () => () => {}),
  revealLocalFile: vi.fn(async () => {}),
  openLocalFile: vi.fn(async () => "opened"),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }));
vi.mock("../ui/Toast", () => ({ showToast: vi.fn() }));
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { menuSetFileTarget, onMenuFile, revealLocalFile } from "../lib/ipc";
import { useApp } from "../store/app";
import { fileTarget, startFileMenu } from "./fileTarget";

const ws = { machine_id: "m1", session: "s", workspace_id: "w1" };
const machine = (kind: string) => ({ id: "m1", label: "m1", kind, state: "connected", home: "/Users/me", sessions: [] }) as never;
const openFile = () => useApp.getState().openFile(ws, "/r", "docs/a.md", { pin: false });
const focusPath = (abs: string, local: boolean) => {
  const a = document.createElement("a");
  a.className = "chat-path";
  a.href = "#";
  a.dataset.abs = abs;
  a.dataset.local = local ? "1" : "0";
  a.textContent = "p";
  document.body.append(a);
  a.focus();
};

describe("fileTarget", () => {
  beforeEach(() => {
    useApp.setState(useApp.getInitialState(), true);
    document.body.replaceChildren();
    vi.mocked(menuSetFileTarget).mockClear();
  });

  it("is the file shown in Files, on this Mac", () => {
    useApp.setState({ machines: { m1: machine("local") } });
    openFile();
    expect(fileTarget()).toEqual({ abs: "/r/docs/a.md", local: true });
  });

  it("is remote for a file on another machine", () => {
    useApp.setState({ machines: { m1: machine("ssh") } });
    openFile();
    expect(fileTarget()).toEqual({ abs: "/r/docs/a.md", local: false });
  });

  it("is the focused Chat path before the open file", () => {
    useApp.setState({ machines: { m1: machine("local") } });
    openFile();
    focusPath("/x/b.ts", true);
    expect(fileTarget()).toEqual({ abs: "/x/b.ts", local: true });
  });

  it("is null with neither", () => {
    expect(fileTarget()).toBeNull();
  });

  it("tells the menu bar the kind as it changes, and reveals on File › Reveal in Finder", async () => {
    let onFile: (w: "reveal" | "open" | "copy") => void = () => {};
    vi.mocked(onMenuFile).mockImplementation(async (cb) => {
      onFile = cb;
      return () => {};
    });
    useApp.setState({ machines: { m1: machine("local") } });
    const stop = startFileMenu();
    expect(menuSetFileTarget).toHaveBeenLastCalledWith("none");
    openFile();
    expect(menuSetFileTarget).toHaveBeenLastCalledWith("local");
    await Promise.resolve();
    onFile("reveal");
    expect(revealLocalFile).toHaveBeenCalledWith("/r/docs/a.md");
    onFile("copy");
    expect(writeText).toHaveBeenCalledWith("/r/docs/a.md");
    stop();
  });
});
