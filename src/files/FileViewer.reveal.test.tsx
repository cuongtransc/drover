import { fireEvent, render, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "files_read") return { kind: "text", text: "x", truncated: false, size: 1, mtime: 1, cksum: null, editable: false };
    if (cmd === "open_local_file") return "opened";
    return null;
  }),
  Channel: class {},
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }));
vi.mock("../ui/Toast", () => ({ showToast: vi.fn(), showProgressToast: vi.fn(() => 1), updateToast: vi.fn() }));
import { useApp } from "../store/app";
import { FileViewer } from "./FileViewer";

const ref = { machine_id: "m1", session: "default", workspace_id: "w1" };
const item = { kind: "file" as const, ws: ref, root: "/r", rel: "docs/a.md" };
const machine = (kind: string) => ({ id: "m1", label: "m1", kind, state: "connected", home: "/Users/me", sessions: [] }) as never;

describe("FileViewer on this Mac", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    useApp.setState(useApp.getInitialState(), true);
  });

  // Apple's HIG: what a context menu offers is also in the main interface (Chat's path menu has these).
  it("reveals the file in Finder and opens it on this Mac from its header", async () => {
    useApp.setState({ machines: { m1: machine("local") } });
    render(<FileViewer item={item} online />);
    fireEvent.click(await screen.findByRole("button", { name: "Reveal in Finder" }));
    expect(invoke).toHaveBeenCalledWith("reveal_local_file", { path: "/r/docs/a.md" });
    fireEvent.click(screen.getByRole("button", { name: "Open on this Mac" }));
    expect(invoke).toHaveBeenCalledWith("open_local_file", { path: "/r/docs/a.md" });
  });

  it("offers neither for a file on another machine", async () => {
    useApp.setState({ machines: { m1: machine("ssh") } });
    render(<FileViewer item={item} online />);
    await screen.findByRole("button", { name: "Copy path" });
    expect(screen.queryByRole("button", { name: "Reveal in Finder" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open on this Mac" })).toBeNull();
  });
});
