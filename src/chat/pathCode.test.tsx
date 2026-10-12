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

  it("opens a path outside the folder on this Mac", () => {
    show("Saved to `/private/tmp/shots/a.png`.");
    fireEvent.click(screen.getByRole("link", { name: "/private/tmp/shots/a.png" }));
    expect(openLocalFile).toHaveBeenCalledWith("/private/tmp/shots/a.png");
    expect(useApp.getState().openItems.items).toEqual([]);
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
