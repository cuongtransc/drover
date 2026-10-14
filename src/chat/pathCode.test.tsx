import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({ chatImage: vi.fn(), openLocalFile: vi.fn().mockResolvedValue("opened") }));
import { openLocalFile } from "../lib/ipc";
import { useFilesBus } from "../files/bus";
import { useApp } from "../store/app";
import { NO_ITEMS } from "../store/openItems";
import { ChatItemView } from "./ChatItemView";
import { ChatPaneContext } from "./images";

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

beforeEach(() => {
  vi.mocked(openLocalFile).mockClear();
  useApp.setState({ machines: { m1: machine("local") }, openItems: NO_ITEMS });
  useFilesBus.setState({ jump: null });
});

describe("paths in chat", () => {
  it("opens a path inside the workspace folder in Files, at its line", () => {
    show("See `src/chat/markdown.tsx:34`.");
    fireEvent.click(screen.getByRole("link", { name: "src/chat/markdown.tsx:34" }));
    const s = useApp.getState();
    const ws = { machine_id: "m1", session: "s", workspace_id: "w1" };
    expect(s.openItems.items).toEqual([{ kind: "file", ws, root: "/Users/me/app", rel: "src/chat/markdown.tsx" }]);
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

  it("hands a path to macOS on Cmd+click, inside the folder or not", () => {
    show("Saved to `/private/tmp/shots/a.png`, from `src/a.ts`.");
    fireEvent.click(screen.getByRole("link", { name: "/private/tmp/shots/a.png" }), { metaKey: true });
    fireEvent.click(screen.getByRole("link", { name: "src/a.ts" }), { metaKey: true });
    expect(vi.mocked(openLocalFile).mock.calls).toEqual([["/private/tmp/shots/a.png"], ["/Users/me/app/src/a.ts"]]);
    expect(useApp.getState().openItems.items).toEqual([]);
  });

  it("opens in Files on Cmd+click on another machine, whose files this Mac cannot open", () => {
    useApp.setState({ machines: { m1: machine("ssh") } });
    show("`/tmp/x/a.md`");
    fireEvent.click(screen.getByRole("link", { name: "/tmp/x/a.md" }), { metaKey: true });
    expect(openLocalFile).not.toHaveBeenCalled();
    expect(useApp.getState().openItems.items).toHaveLength(1);
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
