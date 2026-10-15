import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({
  chatImage: vi.fn(),
  openLocalFile: vi.fn().mockResolvedValue("opened"),
  revealLocalFile: vi.fn().mockResolvedValue(undefined),
  filesFirstFile: vi.fn(),
}));
vi.mock("../ui/Toast", () => ({ showToast: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }));
import { filesFirstFile, openLocalFile, revealLocalFile } from "../lib/ipc";
import { showToast } from "../ui/Toast";
import type { ChatItem } from "../lib/types";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useFilesBus } from "../files/bus";
import { useApp } from "../store/app";
import { NO_ITEMS } from "../store/openItems";
import { ChatItemView } from "./ChatItemView";
import { ChatPaneContext } from "./images";
import { ChatPathsContext, chatPaths } from "./pathContext";

const pane = { machine_id: "m1", session: "s", pane_id: "p1" };
const machine = (kind: string) =>
  ({
    id: "m1",
    label: "m1",
    kind,
    state: "connected",
    home: "/Users/me",
    sessions: [{ name: "s", workspaces: [{ workspace_id: "w1", tabs: [{ panes: [{ pane_id: "p1", cwd: "/Users/me/app" }] }] }] }],
  }) as never;

function show(markdown: string) {
  render(
    <ChatPaneContext.Provider value={pane}>
      <ChatItemView item={{ kind: "assistant_text", markdown }} />
    </ChatPaneContext.Provider>,
  );
}

/** Renders `items` as a chat whose Bash and file tools the paths may be found from. */
function showChat(items: ChatItem[]) {
  render(
    <ChatPaneContext.Provider value={pane}>
      <ChatPathsContext.Provider value={chatPaths(items)}>
        {items.map((it, i) => (it.kind === "assistant_text" ? <ChatItemView key={i} item={it} /> : null))}
      </ChatPathsContext.Provider>
    </ChatPaneContext.Provider>,
  );
}
const bash = (command: string): ChatItem => ({ kind: "tool_call", id: command, name: "Bash", input_summary: "", input: { command } });

beforeEach(() => {
  // The machine has the first place tried, unless a test says otherwise.
  vi.mocked(filesFirstFile).mockReset().mockImplementation(async (_m, paths) => paths[0] ?? null);
  vi.mocked(showToast).mockClear();
  vi.mocked(openLocalFile).mockClear();
  vi.mocked(revealLocalFile).mockClear();
  vi.mocked(writeText).mockClear();
  useApp.setState({ machines: { m1: machine("local") }, openItems: NO_ITEMS });
  useFilesBus.setState({ jump: null });
});

describe("paths in chat", () => {
  describe("a relative path not in the session's folder", () => {
    const items = [
      bash("cd ~/Dev/other && git worktree add .worktrees/wt && cd .worktrees/wt && cp ~/x.svg profiles/a.svg"),
      { kind: "assistant_text", markdown: "Saved `profiles/a.svg`." } as ChatItem,
    ];

    it("opens where the agent worked, the first place the machine has it", async () => {
      vi.mocked(filesFirstFile).mockResolvedValue("/Users/me/Dev/other/.worktrees/wt/profiles/a.svg");
      showChat(items);
      fireEvent.click(screen.getByRole("link", { name: "profiles/a.svg" }));
      const ws = { machine_id: "m1", session: "s", workspace_id: "w1" };
      await waitFor(() =>
        expect(useApp.getState().openItems.items).toEqual([{ kind: "file", ws, root: "/Users/me/Dev/other/.worktrees/wt/profiles", rel: "a.svg" }]),
      );
      expect(filesFirstFile).toHaveBeenCalledWith("m1", [
        "/Users/me/Dev/other/.worktrees/wt/profiles/a.svg",
        "/Users/me/Dev/other/profiles/a.svg",
        "/Users/me/app/profiles/a.svg",
      ]);
    });

    it("copies and reveals the path found", async () => {
      vi.mocked(filesFirstFile).mockResolvedValue("/Users/me/Dev/other/.worktrees/wt/profiles/a.svg");
      showChat(items);
      fireEvent.contextMenu(screen.getByRole("link", { name: "profiles/a.svg" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy Path" }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("/Users/me/Dev/other/.worktrees/wt/profiles/a.svg"));
      fireEvent.contextMenu(screen.getByRole("link", { name: "profiles/a.svg" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Reveal in Finder" }));
      await waitFor(() => expect(revealLocalFile).toHaveBeenCalledWith("/Users/me/Dev/other/.worktrees/wt/profiles/a.svg"));
    });

    it("says so, and opens nothing, when no place has it", async () => {
      vi.mocked(filesFirstFile).mockResolvedValue(null);
      showChat(items);
      fireEvent.click(screen.getByRole("link", { name: "profiles/a.svg" }));
      await waitFor(() => expect(showToast).toHaveBeenCalledWith("Not found: profiles/a.svg (looked in 3 places)"));
      expect(useApp.getState().openItems.items).toEqual([]);
    });

    it("falls back to the session's folder when the machine cannot be asked", async () => {
      vi.mocked(filesFirstFile).mockRejectedValue({ code: "unavailable", message: "offline" });
      showChat(items);
      fireEvent.click(screen.getByRole("link", { name: "profiles/a.svg" }));
      const ws = { machine_id: "m1", session: "s", workspace_id: "w1" };
      await waitFor(() => expect(useApp.getState().openItems.items).toEqual([{ kind: "file", ws, root: "/Users/me/app", rel: "profiles/a.svg" }]));
    });
  });

  it("never asks the machine about an absolute path", () => {
    show("`/Users/me/app/src/a.ts`");
    fireEvent.click(screen.getByRole("link", { name: "/Users/me/app/src/a.ts" }));
    expect(filesFirstFile).not.toHaveBeenCalled();
    expect(useApp.getState().openItems.items).toHaveLength(1);
  });

  it("opens a path inside the workspace folder in Files, at its line", async () => {
    show("See `src/chat/markdown.tsx:34`.");
    fireEvent.click(screen.getByRole("link", { name: "src/chat/markdown.tsx:34" }));
    const ws = { machine_id: "m1", session: "s", workspace_id: "w1" };
    await waitFor(() => expect(useApp.getState().openItems.items).toEqual([{ kind: "file", ws, root: "/Users/me/app", rel: "src/chat/markdown.tsx" }]));
    expect(useFilesBus.getState().jump?.hash).toBe("L34");
    expect(openLocalFile).not.toHaveBeenCalled();
  });

  it("opens a path outside the folder on this Mac in Files, from its own folder, at its line", () => {
    show("Edit `/Users/me/other/src/main.rs:12`.");
    fireEvent.click(screen.getByRole("link", { name: "/Users/me/other/src/main.rs:12" }));
    const ws = { machine_id: "m1", session: "s", workspace_id: "w1" };
    expect(useApp.getState().openItems.items).toEqual([{ kind: "file", ws, root: "/Users/me/other/src", rel: "main.rs" }]);
    expect(useFilesBus.getState().jump?.hash).toBe("L12");
    expect(openLocalFile).not.toHaveBeenCalled();
  });

  it("hands a path to macOS on Cmd+click, inside the folder or not", async () => {
    show("Saved to `/private/tmp/shots/a.png`, from `src/a.ts`.");
    fireEvent.click(screen.getByRole("link", { name: "/private/tmp/shots/a.png" }), { metaKey: true });
    fireEvent.click(screen.getByRole("link", { name: "src/a.ts" }), { metaKey: true });
    await waitFor(() => expect(vi.mocked(openLocalFile).mock.calls).toEqual([["/private/tmp/shots/a.png"], ["/Users/me/app/src/a.ts"]]));
    expect(useApp.getState().openItems.items).toEqual([]);
  });

  it("opens in Files on Cmd+click on another machine, whose files this Mac cannot open", () => {
    useApp.setState({ machines: { m1: machine("ssh") } });
    show("`/tmp/x/a.md`");
    fireEvent.click(screen.getByRole("link", { name: "/tmp/x/a.md" }), { metaKey: true });
    expect(openLocalFile).not.toHaveBeenCalled();
    expect(useApp.getState().openItems.items).toHaveLength(1);
  });

  describe("right-click menu", () => {
    const items = () => screen.getAllByRole("menuitem").map((b) => b.textContent);
    const pick = (name: string) => fireEvent.click(screen.getByRole("menuitem", { name }));

    it("on this Mac: open in Files, open on this Mac, reveal in Finder, copy the path", () => {
      show("Edit `src/a.ts:3`.");
      fireEvent.contextMenu(screen.getByRole("link", { name: "src/a.ts:3" }));
      expect(items()).toEqual(["Open in Files", "Open on this Mac", "Reveal in Finder", "Copy Path"]);
    });

    it("reveals the path without its line, and closes", async () => {
      show("Edit `src/a.ts:3`.");
      fireEvent.contextMenu(screen.getByRole("link", { name: "src/a.ts:3" }));
      pick("Reveal in Finder");
      await waitFor(() => expect(revealLocalFile).toHaveBeenCalledWith("/Users/me/app/src/a.ts"));
      expect(screen.queryByRole("menu")).toBeNull();
      expect(useApp.getState().openItems.items).toEqual([]);
    });

    it("opens in Files at the line, or on this Mac, as a click and a Cmd+click do", async () => {
      show("Edit `src/a.ts:3`.");
      fireEvent.contextMenu(screen.getByRole("link", { name: "src/a.ts:3" }));
      pick("Open in Files");
      await waitFor(() => expect(useApp.getState().openItems.items).toHaveLength(1));
      expect(useFilesBus.getState().jump?.hash).toBe("L3");
      fireEvent.contextMenu(screen.getByRole("link", { name: "src/a.ts:3" }));
      pick("Open on this Mac");
      await waitFor(() => expect(openLocalFile).toHaveBeenCalledWith("/Users/me/app/src/a.ts"));
    });

    it("copies the absolute path, without its line", async () => {
      show("Edit `src/a.ts:3`.");
      fireEvent.contextMenu(screen.getByRole("link", { name: "src/a.ts:3" }));
      pick("Copy Path");
      await waitFor(() => expect(writeText).toHaveBeenCalledWith("/Users/me/app/src/a.ts"));
    });

    it("copies the text selected when the menu opened", () => {
      show("Edit `src/a.ts:3` now.");
      const spy = vi.spyOn(window, "getSelection").mockReturnValue({ toString: () => "Edit src/a.ts:3" } as Selection);
      fireEvent.contextMenu(screen.getByRole("link", { name: "src/a.ts:3" }));
      spy.mockRestore();
      expect(items()).toEqual(["Open in Files", "Open on this Mac", "Reveal in Finder", "Copy Path", "Copy"]);
      pick("Copy");
      expect(writeText).toHaveBeenCalledWith("Edit src/a.ts:3");
    });

    it("on another machine: only what does not need this Mac", () => {
      useApp.setState({ machines: { m1: machine("ssh") } });
      show("`/tmp/x/a.md`");
      fireEvent.contextMenu(screen.getByRole("link", { name: "/tmp/x/a.md" }));
      expect(items()).toEqual(["Open in Files", "Copy Path"]);
    });
  });

  it("opens a path outside the folder on another machine in Files, from its own folder", () => {
    useApp.setState({ machines: { m1: machine("ssh") } });
    show("Saved at `/tmp/claude-1000/x/fe-reply.md:7`.");
    fireEvent.click(screen.getByRole("link", { name: "/tmp/claude-1000/x/fe-reply.md:7" }));
    const ws = { machine_id: "m1", session: "s", workspace_id: "w1" };
    expect(useApp.getState().openItems.items).toEqual([{ kind: "file", ws, root: "/tmp/claude-1000/x", rel: "fe-reply.md" }]);
    expect(useFilesBus.getState().jump?.hash).toBe("L7");
    expect(openLocalFile).not.toHaveBeenCalled();
  });

  it("links a bare path in prose the same way, keeping the text around it", () => {
    show("- /Users/me/other/notes/a.md: why not teams");
    const link = screen.getByRole("link", { name: "/Users/me/other/notes/a.md" });
    expect(link.querySelector("code")).toBeNull();
    expect(link.parentElement?.textContent).toBe("/Users/me/other/notes/a.md: why not teams");
    fireEvent.click(link);
    const ws = { machine_id: "m1", session: "s", workspace_id: "w1" };
    expect(useApp.getState().openItems.items).toEqual([{ kind: "file", ws, root: "/Users/me/other/notes", rel: "a.md" }]);
  });

  it("never links a bare path inside a markdown link", () => {
    show("[the note /Users/me/a.md](https://example.com)");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("leaves code that is not a path as code", () => {
    show("`mise run ci`");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("mise run ci").tagName).toBe("CODE");
  });

  it("never links code inside a fenced block", () => {
    show("```\nsrc/chat/markdown.tsx:34\n```");
    expect(screen.queryByRole("link")).toBeNull();
  });
});
