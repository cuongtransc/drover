import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const channels = vi.hoisted(() => [] as { onmessage?: (e: unknown) => void }[]);
/** What files_changed answers with. */
const changedReply = vi.hoisted(() => ({ value: { repo: false, total: 0, changes: [] } as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "files_list_all") return { paths: [], capped: false, refused: false };
    if (cmd === "files_watch") return 1;
    if (cmd === "files_changed") return changedReply.value;
    if (cmd === "files_read") {
      return { kind: "text", text: "x", truncated: false, size: 1, mtime: 1, cksum: null, editable: false };
    }
    return [];
  }),
  Channel: class {
    onmessage?: (e: unknown) => void;
    constructor() {
      channels.push(this);
    }
  },
}));
import { useApp } from "../store/app";
import { NO_ITEMS } from "../store/openItems";
import { setFolder } from "../workspaces/folder";
import { FilesPanel } from "./FilesPanel";
import { useFilesPanel } from "./panelStore";
import { useFilesBus } from "./bus";
import { useFiles } from "./store";
import { DEFAULT_HIDDEN_FOLDERS, loadHiddenFolders, useHiddenFolders } from "../settings/hiddenFolders";

const ref = { machine_id: "local", session: "default", workspace_id: "w1" };

const selected = { machine_id: "local", session: "default", pane_id: "p1" };

describe("FilesPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    useHiddenFolders.setState({ folders: loadHiddenFolders() });
    channels.length = 0;
    changedReply.value = { repo: false, total: 0, changes: [] };
    useFiles.setState(useFiles.getInitialState(), true);
    useFilesBus.setState(useFilesBus.getInitialState(), true);
    useFilesPanel.setState({ ...useFilesPanel.getInitialState(), collapsed: false }, true);
    useApp.setState({
      machines: { local: { id: "local", label: "local", kind: "local", state: "connected", error: null, version: null, status: "idle", sessions: [{ name: "default", running: true, status: "idle", error: null, workspaces: [
        { workspace_id: "w1", label: "app", number: 1, status: "idle", tabs: [{ tab_id: "t1", label: "t", panes: [{ pane_id: "p1", cwd: "/r" }] }] },
        { workspace_id: "w2", label: "other", number: 2, status: "idle", tabs: [{ tab_id: "t2", label: "t", panes: [{ pane_id: "p2", cwd: "/o" }] }] },
      ] }] } } as never,
      selected,
      openItems: NO_ITEMS,
    });
  });

  it("shows the root from the pane and offers to save it as the workspace folder", () => {
    render(<FilesPanel />);
    expect(screen.getByRole("button", { name: "Files" })).toBeTruthy();
    expect(screen.getByText("app")).toBeTruthy();
    expect(screen.getByTitle("/r")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set as workspace folder" })).toBeTruthy();
  });

  it("lists git's changes above the tree, opens one on click and marks the open one", async () => {
    changedReply.value = { repo: true, total: 2, changes: [{ code: " M", path: "src/a.ts" }, { code: "??", path: "b.md" }] };
    render(<FilesPanel />);
    fireEvent.click(await screen.findByTitle("src/a.ts"));
    expect(useApp.getState().openItems.items).toEqual([{ kind: "file", ws: ref, root: "/r", rel: "src/a.ts" }]);
    expect(screen.getByTitle("src/a.ts").classList.contains("sel")).toBe(true);
    expect(screen.getByTitle("b.md").classList.contains("sel")).toBe(false);
  });

  it("reads git's changes again once the watch reports file changes", async () => {
    render(<FilesPanel />);
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("files_changed", { machineId: "local", root: "/r" }));
    const before = vi.mocked(invoke).mock.calls.filter(([c]) => c === "files_changed").length;
    changedReply.value = { repo: true, total: 1, changes: [{ code: "??", path: "new.md" }] };
    act(() => channels[0].onmessage?.({ type: "changes", changes: [{ path: "new.md", isDir: false, removed: false }] }));
    expect(await screen.findByText("CHANGED (1)", undefined, { timeout: 2000 })).toBeTruthy();
    expect(vi.mocked(invoke).mock.calls.filter(([c]) => c === "files_changed").length).toBe(before + 1);
  });

  it("toggles the hidden folders in the tree, hidden by default", async () => {
    render(<FilesPanel />);
    const btn = screen.getByRole("button", { name: "Show hidden folders" });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("files_list_dir", { machineId: "local", root: "/r", rel: "", showHeavy: true, hidden: DEFAULT_HIDDEN_FOLDERS }),
    );
  });

  it("lists and watches again with the hidden list edited in Settings", async () => {
    render(<FilesPanel />);
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("files_watch", expect.objectContaining({ hidden: DEFAULT_HIDDEN_FOLDERS })));
    act(() => void useHiddenFolders.getState().add("tmp"));
    const hidden = [...DEFAULT_HIDDEN_FOLDERS, "tmp"];
    await waitFor(() => {
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("files_list_all", { machineId: "local", root: "/r", hidden });
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("files_list_dir", { machineId: "local", root: "/r", rel: "", showHeavy: false, hidden });
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("files_watch", expect.objectContaining({ root: "/r", hidden }));
    });
  });

  it("shows Machine offline when the machine is not connected", () => {
    useApp.setState((s) => ({ machines: { local: { ...s.machines.local, state: "disconnected" } } as never }));
    render(<FilesPanel />);
    expect(screen.getByText("Machine offline")).toBeTruthy();
  });

  it("shows the machine label for an ssh machine", () => {
    useApp.setState((s) => ({ machines: { local: { ...s.machines.local, kind: "ssh", label: "devbox" } } as never }));
    render(<FilesPanel />);
    expect(screen.getByText("devbox")).toBeTruthy();
  });

  it("shows nothing to browse with no selection and no open file", () => {
    useApp.setState({ selected: null, openItems: NO_ITEMS });
    render(<FilesPanel />);
    expect(screen.getByText("Select an agent to browse its files")).toBeTruthy();
  });

  it("follows the active file item's workspace and root, not the selected pane's", async () => {
    useApp.getState().openFile({ machine_id: "local", session: "default", workspace_id: "w2" }, "/o", "a.md", { pin: true });
    render(<FilesPanel />);
    expect(screen.getByText("other")).toBeTruthy();
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledWith("files_list_all", expect.objectContaining({ root: "/o" })));
    expect(useApp.getState().selected?.pane_id).toBe("p1");
  });

  it("clicking a file opens it as the active preview item", async () => {
    vi.mocked(invoke).mockImplementation((async (cmd: string) =>
      cmd === "files_list_dir" ? [{ name: "a.md", kind: "file" }] : cmd === "files_watch" ? 1 : { paths: [], capped: false, refused: false }) as never);
    render(<FilesPanel />);
    fireEvent.click(await screen.findByText("a.md"));
    expect(useApp.getState().openItems.active).toBe("file:local/default/w1|/r|a.md");
    expect(useApp.getState().openItems.preview).toBe("file:local/default/w1|/r|a.md");
  });

  it("folds from its header like a sidebar section; focusTree expands it and focuses the tree", async () => {
    render(<FilesPanel />);
    const head = screen.getByRole("button", { name: "Files" });
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(head.querySelector(".chev.open")).toBeTruthy();
    fireEvent.click(head);
    expect(screen.queryByRole("tree")).toBeNull();
    expect(head.getAttribute("aria-expanded")).toBe("false");
    // Its actions go with the tree.
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show hidden folders" })).toBeNull();
    act(() => useFilesPanel.getState().focusTree());
    await waitFor(() => expect(document.activeElement?.closest("[role=tree]")).toBeTruthy());
  });

  it("focusGoto expands the panel and focuses Go to file", async () => {
    useFilesPanel.getState().setCollapsed(true);
    render(<FilesPanel />);
    act(() => useFilesPanel.getState().focusGoto());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox")));
  });

  it("a focus request that also switches the Workspace focuses the tree of the new one", async () => {
    render(<FilesPanel />);
    expect(screen.getByText("app")).toBeTruthy();
    act(() => {
      useApp.getState().select({ machine_id: "local", session: "default", pane_id: "p2" });
      useFilesPanel.getState().focusTree();
    });
    expect(screen.getByText("other")).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.closest("[role=tree]")).toBeTruthy());
    expect(useFilesPanel.getState().focusHandled).toBe(useFilesPanel.getState().focusTick);
  });

  it("a request made with no Workspace shown does not fire when one appears later", async () => {
    useApp.setState({ selected: null });
    render(<FilesPanel />);
    act(() => useFilesPanel.getState().focusTree());
    act(() => useApp.getState().select({ machine_id: "local", session: "default", pane_id: "p1" }));
    await screen.findByRole("tree");
    expect(document.activeElement?.closest("[role=tree]")).toBeNull();
  });

  it("dragging the splitter sets a height clamped to keep both halves", () => {
    render(
      <div style={{ height: 600 }}>
        <FilesPanel />
      </div>,
    );
    const sep = screen.getByRole("separator");
    expect(sep.getAttribute("aria-orientation")).toBe("horizontal");
    fireEvent.mouseDown(sep, { clientY: 300 });
    fireEvent.mouseMove(window, { clientY: 290 });
    fireEvent.mouseUp(window);
    expect(useFilesPanel.getState().height).not.toBeNull();
    expect(useFilesPanel.getState().height!).toBeGreaterThanOrEqual(120);
  });

  it("offers Change folder… when the root does not exist", async () => {
    const prev = vi.mocked(invoke).getMockImplementation();
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "files_list_all") throw { code: "not_found", message: "no such folder" };
      return [];
    }) as never);
    render(<FilesPanel />);
    expect(await screen.findByRole("button", { name: "Change folder…" })).toBeTruthy();
    vi.mocked(invoke).mockImplementation(prev!);
  });

  it("does not call the root missing when the machine is disconnected", async () => {
    useApp.setState((s) => ({ machines: { local: { ...s.machines.local, state: "disconnected" } } as never }));
    const prev = vi.mocked(invoke).getMockImplementation();
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "files_list_all") throw { code: "not_found", message: "machine local is not connected" };
      return [];
    }) as never);
    render(<FilesPanel />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("button", { name: "Change folder…" })).toBeNull();
    expect(screen.getByText("Machine offline")).toBeTruthy();
    vi.mocked(invoke).mockImplementation(prev!);
  });

  it("clears the missing state on reload once the root lists again", async () => {
    const prev = vi.mocked(invoke).getMockImplementation();
    vi.mocked(invoke).mockImplementation((async (cmd: string) => {
      if (cmd === "files_list_all") throw { code: "not_found", message: "gone" };
      return [];
    }) as never);
    render(<FilesPanel />);
    expect(await screen.findByRole("button", { name: "Change folder…" })).toBeTruthy();
    vi.mocked(invoke).mockImplementation(prev!);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(await screen.findByRole("combobox")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change folder…" })).toBeNull();
  });

  it("keeps the root it opened with; setting a folder re-resolves it", async () => {
    render(<FilesPanel />);
    expect(screen.getByTitle("/r")).toBeTruthy();
    // A cd in the pane does not move the open panel.
    act(() =>
      useApp.setState((s) => ({
        machines: { local: { ...s.machines.local, sessions: [{ ...s.machines.local.sessions[0], workspaces: [{ ...s.machines.local.sessions[0].workspaces[0], tabs: [{ tab_id: "t1", label: "t", panes: [{ pane_id: "p1", cwd: "/x" }] }] }, s.machines.local.sessions[0].workspaces[1]] }] } } as never,
      })),
    );
    expect(screen.getByTitle("/r")).toBeTruthy();
    // Saving the same path as the workspace folder keeps the root.
    fireEvent.click(screen.getByRole("button", { name: "Set as workspace folder" }));
    expect(screen.queryByRole("button", { name: "Set as workspace folder" })).toBeNull();
    expect(screen.getByTitle("/r")).toBeTruthy();
    // Another folder is another root.
    act(() => setFolder(ref, "/new"));
    expect(screen.getByTitle("/new")).toBeTruthy();
  });

  describe("keys", () => {
    const press = (extra: Partial<KeyboardEventInit> = {}) =>
      act(() => {
        fireEvent.keyDown(window, { key: "r", metaKey: true, ...extra });
      });
    const listAlls = () => vi.mocked(invoke).mock.calls.filter((c) => c[0] === "files_list_all").length;

    it("⌘R with focus in the panel reloads the lists once", async () => {
      render(<FilesPanel />);
      await waitFor(() => expect(listAlls()).toBe(1));
      screen.getByRole("combobox").focus();
      press();
      await waitFor(() => expect(listAlls()).toBe(2));
    });

    it("⌘R with focus elsewhere does nothing", async () => {
      render(<FilesPanel />);
      await waitFor(() => expect(listAlls()).toBe(1));
      (document.activeElement as HTMLElement | null)?.blur();
      press();
      await new Promise((r) => setTimeout(r, 20));
      expect(listAlls()).toBe(1);
    });

    it("leaves ⌘R to the file viewer when a file of this root is active", async () => {
      useApp.getState().openFile(ref, "/r", "a.md", { pin: true });
      render(<FilesPanel />);
      await waitFor(() => expect(listAlls()).toBe(1));
      screen.getByRole("combobox").focus();
      press();
      await new Promise((r) => setTimeout(r, 20));
      expect(listAlls()).toBe(1);
    });
  });

  describe("read errors and the watch", () => {
    let prev: ReturnType<ReturnType<typeof vi.mocked<typeof invoke>>["getMockImplementation"]>;
    beforeEach(() => {
      prev = vi.mocked(invoke).getMockImplementation();
    });
    afterEach(() => {
      vi.mocked(invoke).mockImplementation(prev!);
      vi.useRealTimers();
    });

    const watch = () => channels[channels.length - 1];

    it("shows the folder missing when the watch reports the root removed", async () => {
      render(<FilesPanel />);
      await waitFor(() => expect(watch()).toBeTruthy());
      act(() => watch().onmessage!({ type: "changes", changes: [{ path: "", isDir: true, removed: true }] }));
      expect(await screen.findByText("This folder no longer exists.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Change folder…" })).toBeTruthy();
    });

    const listAlls = () => vi.mocked(invoke).mock.calls.filter((c) => c[0] === "files_list_all").length;

    it("the first resync after opening does not list everything again", async () => {
      render(<FilesPanel />);
      await waitFor(() => expect(watch()).toBeTruthy());
      await waitFor(() => expect(listAlls()).toBe(1));
      act(() => watch().onmessage!({ type: "resync" }));
      await new Promise((r) => setTimeout(r, 20));
      expect(listAlls()).toBe(1);
    });

    it("a resync after the watch failed reloads, even the first one", async () => {
      render(<FilesPanel />);
      await waitFor(() => expect(watch()).toBeTruthy());
      await waitFor(() => expect(listAlls()).toBe(1));
      act(() => watch().onmessage!({ type: "error", message: "ssh: connect failed" }));
      act(() => watch().onmessage!({ type: "resync" }));
      await waitFor(() => expect(listAlls()).toBe(2));
    });

    it("the first resync after coming back online reloads", async () => {
      render(<FilesPanel />);
      await waitFor(() => expect(watch()).toBeTruthy());
      act(() => watch().onmessage!({ type: "resync" }));
      const setState = (state: string) =>
        act(() => useApp.setState((s) => ({ machines: { local: { ...s.machines.local, state } } as never })));
      setState("disconnected");
      const before = channels.length;
      setState("connected");
      await waitFor(() => expect(channels.length).toBe(before + 1));
      vi.mocked(invoke).mockClear();
      act(() => watch().onmessage!({ type: "resync" }));
      await waitFor(() => expect(listAlls()).toBe(1));
    });

    it("a later resync reloads the lists and the open folders", async () => {
      render(<FilesPanel />);
      await waitFor(() => expect(watch()).toBeTruthy());
      act(() => watch().onmessage!({ type: "resync" }));
      vi.mocked(invoke).mockClear();
      act(() => watch().onmessage!({ type: "resync" }));
      await waitFor(() => {
        const cmds = vi.mocked(invoke).mock.calls.map((c) => c[0]);
        expect(cmds).toContain("files_list_all");
        expect(cmds).toContain("files_list_dir");
      });
    });

    it("keeps watching while collapsed and hands the changes to the open file", async () => {
      useFilesPanel.getState().setCollapsed(true);
      render(<FilesPanel />);
      await waitFor(() => expect(watch()).toBeTruthy());
      expect(screen.queryByRole("tree")).toBeNull();
      expect(screen.queryByRole("combobox")).toBeNull();
      act(() => watch().onmessage!({ type: "changes", changes: [{ path: "a.md", isDir: false, removed: false }] }));
      expect(useFilesBus.getState().batches["local/default/w1|/r"]?.changes).toEqual([{ path: "a.md", isDir: false, removed: false }]);
    });

    it("shows and clears the auto-refresh error", async () => {
      render(<FilesPanel />);
      await waitFor(() => expect(watch()).toBeTruthy());
      act(() => watch().onmessage!({ type: "error", message: "upper limit on inotify watches reached!" }));
      expect(screen.getByRole("status").textContent).toBe("Auto-refresh stopped: upper limit on inotify watches reached!");
      act(() => watch().onmessage!({ type: "resync" }));
      expect(screen.queryByRole("status")).toBeNull();
    });
  });
});
