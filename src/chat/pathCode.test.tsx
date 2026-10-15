import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({
  chatImage: vi.fn(),
  openLocalFile: vi.fn().mockResolvedValue("opened"),
  revealLocalFile: vi.fn().mockResolvedValue(undefined),
  filesFirstFiles: vi.fn(),
}));
vi.mock("../ui/Toast", () => ({ showToast: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }));
import { filesFirstFiles, openLocalFile, revealLocalFile } from "../lib/ipc";
import { showToast } from "../ui/Toast";
import type { ChatItem } from "../lib/types";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useFilesBus } from "../files/bus";
import { useApp } from "../store/app";
import { NO_ITEMS } from "../store/openItems";
import { ChatItemView } from "./ChatItemView";
import { ChatPaneContext } from "./images";
import { ChatPathsContext, pathResolver } from "./pathResolver";

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
      <ChatPathsContext.Provider value={pathResolver("m1", () => items)}>
        {items.map((it, i) => (it.kind === "assistant_text" ? <ChatItemView key={i} item={it} /> : null))}
      </ChatPathsContext.Provider>
    </ChatPaneContext.Provider>,
  );
}
const bash = (command: string): ChatItem => ({ kind: "tool_call", id: command, name: "Bash", input_summary: "", input: { command } });

beforeEach(() => {
  vi.mocked(filesFirstFiles).mockReset();
  vi.mocked(showToast).mockClear();
  vi.mocked(openLocalFile).mockClear();
  vi.mocked(revealLocalFile).mockClear();
  vi.mocked(writeText).mockClear();
  useApp.setState({ machines: { m1: machine("local") }, openItems: NO_ITEMS });
  useFilesBus.setState({ jump: null });
});

describe("paths in chat", () => {
  describe("keys on a focused path", () => {
    const press = (init: KeyboardEventInit) => {
      show("Edit `src/a.ts:3` now.");
      const link = screen.getByRole("link", { name: "src/a.ts:3" });
      link.focus();
      const outside = vi.fn();
      window.addEventListener("keydown", outside);
      fireEvent.keyDown(link, init);
      window.removeEventListener("keydown", outside);
      return outside;
    };

    it("⌥⌘R reveals it in Finder, and no app shortcut sees the key", () => {
      const outside = press({ key: "®", code: "KeyR", metaKey: true, altKey: true });
      expect(revealLocalFile).toHaveBeenCalledWith("/Users/me/app/src/a.ts");
      expect(outside).not.toHaveBeenCalled();
    });

    it("⌥⌘C copies its path", () => {
      press({ key: "ç", code: "KeyC", metaKey: true, altKey: true });
      expect(writeText).toHaveBeenCalledWith("/Users/me/app/src/a.ts");
    });

    it("⌘↩ opens it on this Mac", () => {
      press({ key: "Enter", code: "Enter", metaKey: true });
      expect(openLocalFile).toHaveBeenCalledWith("/Users/me/app/src/a.ts");
    });

    it("⇧F10 and the Menu key open its menu", () => {
      press({ key: "F10", code: "F10", shiftKey: true });
      expect(screen.getByRole("menu")).toBeTruthy();
      fireEvent.keyDown(window, { key: "Escape" });
      fireEvent.keyDown(screen.getByRole("link", { name: "src/a.ts:3" }), { key: "ContextMenu", code: "ContextMenu" });
      expect(screen.getByRole("menu")).toBeTruthy();
    });

    it("leaves other keys alone", () => {
      const outside = press({ key: "r", code: "KeyR", metaKey: true });
      expect(outside).toHaveBeenCalled();
      expect(revealLocalFile).not.toHaveBeenCalled();
    });

    it("on another machine, reveals nothing and ⌘↩ opens it in Files", () => {
      useApp.setState({ machines: { m1: machine("ssh") } });
      press({ key: "®", code: "KeyR", metaKey: true, altKey: true });
      expect(revealLocalFile).not.toHaveBeenCalled();
      fireEvent.keyDown(screen.getByRole("link", { name: "src/a.ts:3" }), { key: "Enter", code: "Enter", metaKey: true });
      expect(openLocalFile).not.toHaveBeenCalled();
      expect(useApp.getState().openItems.items).toHaveLength(1);
    });
  });

  describe("in a Chat, which asks the machine where each path is", () => {
    const items = [
      bash("cd ~/Dev/other && git worktree add .worktrees/wt && cd .worktrees/wt && cp ~/x.svg profiles/a.svg"),
      { kind: "assistant_text", markdown: "Saved `profiles/a.svg`, see `/tmp/gone.log`." } as ChatItem,
    ];
    const WT = "/Users/me/Dev/other/.worktrees/wt/profiles/a.svg";

    it("is plain code until the machine answers", async () => {
      vi.mocked(filesFirstFiles).mockReturnValue(new Promise(() => {}));
      showChat(items);
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText("profiles/a.svg").tagName).toBe("CODE");
      // Asked once the wait is over, still unanswered.
      await waitFor(() => expect(filesFirstFiles).toHaveBeenCalled());
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("links a path to where the agent worked, asking once for the whole message", async () => {
      vi.mocked(filesFirstFiles).mockResolvedValue([WT, "/tmp/gone.log"]);
      showChat(items);
      fireEvent.click(await screen.findByRole("link", { name: "profiles/a.svg" }));
      const ws = { machine_id: "m1", session: "s", workspace_id: "w1" };
      expect(useApp.getState().openItems.items).toEqual([{ kind: "file", ws, root: "/Users/me/Dev/other/.worktrees/wt/profiles", rel: "a.svg" }]);
      expect(filesFirstFiles).toHaveBeenCalledTimes(1);
      expect(filesFirstFiles).toHaveBeenCalledWith("m1", [
        [WT, "/Users/me/Dev/other/profiles/a.svg", "/Users/me/app/profiles/a.svg"],
        ["/tmp/gone.log"],
      ]);
    });

    it("copies and reveals the path found", async () => {
      vi.mocked(filesFirstFiles).mockResolvedValue([WT, null]);
      showChat(items);
      fireEvent.contextMenu(await screen.findByRole("link", { name: "profiles/a.svg" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Copy Path" }));
      expect(writeText).toHaveBeenCalledWith(WT);
      fireEvent.contextMenu(screen.getByRole("link", { name: "profiles/a.svg" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Reveal in Finder" }));
      expect(revealLocalFile).toHaveBeenCalledWith(WT);
    });

    it("leaves a path no place has as plain code, relative or absolute", async () => {
      vi.mocked(filesFirstFiles).mockResolvedValue([null, null]);
      showChat(items);
      await waitFor(() => expect(filesFirstFiles).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.getByText("/tmp/gone.log").tagName).toBe("CODE");
    });

    it("links as written when the machine cannot say", async () => {
      vi.mocked(filesFirstFiles).mockRejectedValue({ code: "unavailable", message: "offline" });
      showChat(items);
      fireEvent.click(await screen.findByRole("link", { name: "profiles/a.svg" }));
      const ws = { machine_id: "m1", session: "s", workspace_id: "w1" };
      expect(useApp.getState().openItems.items).toEqual([{ kind: "file", ws, root: "/Users/me/app", rel: "profiles/a.svg" }]);
    });
  });

  it("outside a Chat, links a path as written without asking the machine", () => {
    show("`/Users/me/app/src/a.ts`");
    fireEvent.click(screen.getByRole("link", { name: "/Users/me/app/src/a.ts" }));
    expect(filesFirstFiles).not.toHaveBeenCalled();
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
    // The label, without the keys shown at the item's end.
    const items = () => screen.getAllByRole("menuitem").map((b) => b.textContent!.replace(b.querySelector(".ctx-keys")?.textContent ?? "", ""));
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

    // WebKit on macOS selects the link under the pointer between a right (or Ctrl+) mousedown and
    // the contextmenu event, whatever the page prevents (seen in a WKWebView, 2026-10-15).
    const webkitSelects = (link: HTMLElement) => {
      const range = document.createRange();
      range.selectNodeContents(link);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
    };
    const rightClick = (link: HTMLElement, init: MouseEventInit = { button: 2 }) => {
      fireEvent.mouseDown(link, init);
      webkitSelects(link);
      fireEvent.contextMenu(link);
    };

    it("leaves nothing selected and offers no Copy when nothing was selected before", () => {
      getSelection()!.removeAllRanges();
      show("Edit `src/a.ts:3` now.");
      const link = screen.getByRole("link", { name: "src/a.ts:3" });
      rightClick(link);
      expect(getSelection()!.toString()).toBe("");
      expect(items()).not.toContain("Copy");
    });

    it("does the same for a Ctrl+click, which also opens the menu", () => {
      getSelection()!.removeAllRanges();
      show("Edit `src/a.ts:3` now.");
      rightClick(screen.getByRole("link", { name: "src/a.ts:3" }), { button: 0, ctrlKey: true });
      expect(getSelection()!.toString()).toBe("");
      expect(items()).not.toContain("Copy");
    });

    it("keeps the selection made before, and copies that", () => {
      show("Edit `src/a.ts:3` now.");
      const link = screen.getByRole("link", { name: "src/a.ts:3" });
      const range = document.createRange();
      range.selectNodeContents(link.parentElement!);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      rightClick(link);
      expect(getSelection()!.toString()).toBe("Edit src/a.ts:3 now.");
      pick("Copy");
      expect(writeText).toHaveBeenCalledWith("Edit src/a.ts:3 now.");
    });

    it("shows the keys that do the same on a focused path", () => {
      show("Edit `src/a.ts:3` now.");
      fireEvent.contextMenu(screen.getByRole("link", { name: "src/a.ts:3" }));
      const keys = screen.getAllByRole("menuitem").map((b) => b.querySelector(".ctx-keys")?.textContent ?? "");
      expect(keys).toEqual(["↩", "⌘↩", "⌥⌘R", "⌥⌘C"]);
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
