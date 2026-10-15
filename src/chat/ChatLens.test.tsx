import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestFind } from "../files/findBus";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]), Channel: class {} }));
vi.mock("../lib/ipc", () => ({
  herdrCall: vi.fn(),
  claudePromptHistory: vi.fn().mockResolvedValue([]),
  chatPage: vi.fn().mockResolvedValue([]),
  chatLocate: vi.fn(() => opened),
  imageSaveTemp: vi.fn(),
  completeCommands: vi.fn().mockResolvedValue([]),
  completeFiles: vi.fn().mockResolvedValue([]),
  chatGitStatus: vi.fn().mockResolvedValue(null),
}));
// jsdom lays nothing out, so the virtualizer renders no rows. A test that needs rows sets
// `viewport.on`, giving the scroll element a size; the others keep the real (empty) measuring.
const viewport = vi.hoisted(() => ({ on: false }));
/** Rows the list was asked to scroll to (Find), in order. */
const scrolledTo = vi.hoisted(() => [] as number[]);
vi.mock("@tanstack/react-virtual", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-virtual")>();
  return {
    ...actual,
    useVirtualizer: (opts: Parameters<typeof actual.useVirtualizer>[0]) => {
      const v = actual.useVirtualizer({
        ...opts,
        ...(viewport.on && {
          observeElementRect: (_v: unknown, cb: (rect: { width: number; height: number }) => void) => {
            cb({ width: 800, height: 4000 });
            return () => {};
          },
        }),
      });
      const scroll = v.scrollToIndex.bind(v);
      v.scrollToIndex = (i, o) => {
        scrolledTo.push(i);
        scroll(i, o);
      };
      return v;
    },
  };
});
let opened: Promise<unknown> = new Promise(() => {});
const channels = vi.hoisted(() => [] as { onmessage: (ev: unknown) => void }[]);
const openedPaths = vi.hoisted(() => [] as (string | null)[]);
vi.mock("./chatSession", () => ({
  openChat: (_p: unknown, path: string | null, ch: { onmessage: (ev: unknown) => void }) => {
    channels.push(ch);
    openedPaths.push(path);
    return { opened, close: () => {} };
  },
  onOpenFailure: () => "error",
  watchMachine: () => ({ sawDown: false, reopen: false }),
}));
import { chatLocate, chatPage, herdrCall } from "../lib/ipc";
import type { PaneView } from "../lib/types";
import { ChatLens } from "./ChatLens";
import { useLensSettings } from "../settings/lens";
import { useForks } from "../agents/forkSession";
import { paneKey } from "../lib/types";
import { useApp } from "../store/app";
import { useBtw } from "./btw";

const pane = { machine_id: "devtuf", session: "default", pane_id: "w1:p1" };
const idlePi = { status: "idle", agent: "pi", title: "pi" } as PaneView;
const picker = `
>

→ ✓ a-model [p] · default
    b-model [p]

 Enter to select · Ctrl+S to set as default · Escape/Ctrl+C to cancel
────────────────────────
/tmp/app
`;

let shown = "";

beforeEach(() => {
  viewport.on = false;
  localStorage.clear();
  opened = new Promise(() => {});
  channels.length = 0;
  openedPaths.length = 0;
  vi.mocked(chatLocate).mockClear();
  shown = "";
  vi.mocked(herdrCall)
    .mockReset()
    .mockImplementation(async (_m, _s, method) => {
      if (method === "agent.prompt") shown = picker;
      return method === "pane.read" ? { text: shown } : {};
    });
});

/** Opens the folded background strip and returns its list. */
function openStrip() {
  fireEvent.click(screen.getByRole("button", { name: /in background/ }));
  return screen.getByRole("list", { name: "Background tasks" });
}

describe("ChatLens", () => {
  it("lets a new Claude be chatted with before its transcript exists", async () => {
    opened = Promise.resolve({ agent: "claude", path: "/h/sid.jsonl", ambiguous: false, candidates: ["/h/sid.jsonl"], pending: true });
    render(<ChatLens pane={pane} view={{ status: "idle", agent: "claude", title: "claude" } as PaneView} />);
    expect(await screen.findByText(/first message/)).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("names a new Claude's Model and effort from its startup screen until a reply names them", async () => {
    shown = " ▐▛███▛█   Claude Code v2.1.296\n▝▜██████▀  Opus 5.5 · Claude Max\n\n          ◐ medium · /effort\n";
    opened = Promise.resolve({ agent: "claude", path: "/h/sid.jsonl", ambiguous: false, candidates: ["/h/sid.jsonl"], pending: true });
    render(<ChatLens pane={pane} view={{ status: "idle", agent: "claude", title: "claude" } as PaneView} />);
    expect(await screen.findByRole("button", { name: "Opus 5.5 · medium" })).toBeTruthy();
    await waitFor(() => expect(channels.length).toBe(1));
    act(() => channels[0].onmessage({ type: "meta", model: "claude-opus-5-5", effort: "high", context_tokens: null, queued: [], background: [] }));
    expect(await screen.findByRole("button", { name: "claude-opus-5-5 · high" })).toBeTruthy();
  });

  it("shows pi's model picker as a card once /model is sent, though pi stays idle", async () => {
    render(<ChatLens pane={pane} view={idlePi} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "/model" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByText("Select model (currently a-model [p])")).toBeTruthy();
    expect(screen.getByRole("button", { name: /b-model/ })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/Waiting for/)).toBeNull();
  });

  it("does not read the screen of an idle pi Pane that was sent no /model", async () => {
    shown = picker;
    render(<ChatLens pane={pane} view={idlePi} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(herdrCall).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("goes back to the Composer once the picker closes", async () => {
    render(<ChatLens pane={pane} view={idlePi} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "/model" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByText("Select model (currently a-model [p])");
    shown = "";
    await waitFor(() => expect(screen.getByRole("textbox")).toBeTruthy(), { timeout: 3000 });
  });

  it("forgets the /model it was sent once the Pane changes", async () => {
    // the picker never shows, so the Pane stays armed until the change
    vi.mocked(herdrCall).mockImplementation(async (_m, _s, method) => (method === "pane.read" ? { text: "" } : {}));
    const other = { ...pane, pane_id: "w1:p2" };
    const { rerender } = render(<ChatLens pane={pane} view={idlePi} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "/model" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(vi.mocked(herdrCall).mock.calls.some(([, , m]) => m === "pane.read")).toBe(true));
    vi.mocked(herdrCall).mockClear();
    rerender(<ChatLens pane={other} view={idlePi} />);
    rerender(<ChatLens pane={pane} view={idlePi} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(vi.mocked(herdrCall).mock.calls.filter(([, , m]) => m === "pane.read")).toEqual([]);
  });

  it("locates a transcript reopened from the running tail again, and follows it when it moved", async () => {
    const was = { agent: "claude", path: "/h/old.jsonl", ambiguous: false, candidates: ["/h/old.jsonl"], pending: false };
    const moved = { ...was, path: "/h/new.jsonl", candidates: ["/h/new.jsonl"] };
    opened = Promise.resolve({ ...was, cached: true });
    vi.mocked(chatLocate).mockResolvedValueOnce(moved);
    render(<ChatLens pane={pane} view={idlePi} />);
    await waitFor(() => expect(openedPaths).toEqual([null, "/h/new.jsonl"]));
    expect(chatLocate).toHaveBeenCalledTimes(1);
  });

  it("does not locate again after an open that located, or a reattach to the same file", async () => {
    const at = { agent: "claude", path: "/h/a.jsonl", ambiguous: false, candidates: ["/h/a.jsonl"], pending: false };
    opened = Promise.resolve(at);
    const first = render(<ChatLens pane={pane} view={idlePi} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(chatLocate).not.toHaveBeenCalled();
    first.unmount();
    opened = Promise.resolve({ ...at, cached: true });
    vi.mocked(chatLocate).mockResolvedValueOnce(at);
    render(<ChatLens pane={pane} view={idlePi} />);
    await waitFor(() => expect(chatLocate).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(openedPaths).toEqual([null, null]);
  });

  it("says the transcript is loading once a located open waits for its reset", async () => {
    opened = Promise.resolve({ agent: "claude", path: "/h/a.jsonl", ambiguous: false, candidates: ["/h/a.jsonl"], pending: false });
    render(<ChatLens pane={pane} view={idlePi} />);
    expect(screen.queryByText("Loading transcript…")).toBeNull();
    expect(await screen.findByText("Loading transcript…", undefined, { timeout: 100 })).toBeTruthy();
  });

  it("does not say loading while reattaching to the running tail", async () => {
    opened = Promise.resolve({ agent: "claude", path: "/h/a.jsonl", ambiguous: false, candidates: ["/h/a.jsonl"], pending: false, cached: true });
    vi.mocked(chatLocate).mockReturnValueOnce(new Promise(() => {}));
    render(<ChatLens pane={pane} view={idlePi} />);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText("Loading transcript…")).toBeNull();
  });

  // Edit › Find… (⌘F; the menu bar takes the key, ADR 0010) finds in your messages and the answers.
  it("finds in the loaded messages and answers from Edit › Find, and steps with Find Next", async () => {
    render(<ChatLens pane={pane} view={idlePi} />);
    await waitFor(() => expect(channels.length).toBeGreaterThan(0));
    act(() =>
      channels[channels.length - 1].onmessage({
        type: "reset",
        items: [
          { kind: "user", text: "fix the parser" },
          { kind: "assistant_text", markdown: "The **parser** is fixed; the parser tests pass." },
        ],
        total: 2,
      }),
    );
    act(() => requestFind("open"));
    const input = screen.getByPlaceholderText("Find in chat");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "parser" } });
    const count = () => document.querySelector(".files-find-count")!.textContent;
    expect(count()).toBe("1 / 3");
    act(() => requestFind("next"));
    expect(count()).toBe("2 / 3");
    act(() => requestFind("prev"));
    act(() => requestFind("prev"));
    expect(count()).toBe("3 / 3");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Find in chat")).toBeNull();
  });

  it("scrolls to a match once, not again as the chat grows while Find is open", async () => {
    render(<ChatLens pane={pane} view={idlePi} />);
    await waitFor(() => expect(channels.length).toBeGreaterThan(0));
    const ch = channels[channels.length - 1];
    act(() => ch.onmessage({ type: "reset", items: [{ kind: "user", text: "fix the parser" }], total: 1 }));
    act(() => requestFind("open"));
    fireEvent.change(screen.getByPlaceholderText("Find in chat"), { target: { value: "parser" } });
    const after = scrolledTo.filter((i) => i === 0).length;
    expect(after).toBeGreaterThan(0);
    act(() => ch.onmessage({ type: "append", items: [{ kind: "assistant_text", markdown: "working on it" }] }));
    act(() => ch.onmessage({ type: "append", items: [{ kind: "assistant_text", markdown: "still working" }] }));
    expect(scrolledTo.filter((i) => i === 0).length).toBe(after);
  });

  it("says the transcript is loading until the first reset or error", async () => {
    const { unmount } = render(<ChatLens pane={pane} view={idlePi} />);
    expect(screen.queryByText("Loading transcript…")).toBeNull();
    expect(await screen.findByText("Loading transcript…")).toBeTruthy();
    act(() => channels[channels.length - 1].onmessage({ type: "reset", items: [], total: 0 }));
    expect(screen.queryByText("Loading transcript…")).toBeNull();
    unmount();
    render(<ChatLens pane={pane} view={idlePi} />);
    act(() => channels[channels.length - 1].onmessage({ type: "error", error: { code: "io", message: "gone" } }));
    expect(screen.queryByText("Loading transcript…")).toBeNull();
  });

  describe("thinking under a folded Work block", () => {
    const turn = [
      { kind: "user", text: "go", ts: "2026-10-16T01:00:00Z" },
      { kind: "thinking", text: "Plan: link to the wallet page", ts: "2026-10-16T01:00:01Z" },
      { kind: "tool_call", id: "c1", name: "Bash", input_summary: "ls", input: { command: "ls" }, ts: "2026-10-16T01:00:02Z" },
      { kind: "tool_result", call_id: "c1", output: "a", is_error: false, ts: "2026-10-16T01:00:03Z" },
      { kind: "assistant_text", markdown: "Done.", ts: "2026-10-16T01:00:04Z" },
    ];
    const show = (agent: string) => {
      viewport.on = true;
      render(<ChatLens pane={pane} view={{ status: "idle", agent, title: agent } as PaneView} />);
      act(() => channels[channels.length - 1].onmessage({ type: "reset", items: turn, total: turn.length }));
    };

    it("shows Claude's: a one-line summary written for the reader", () => {
      show("claude");
      expect(screen.getByText("Plan: link to the wallet page")).toBeTruthy();
    });

    it("keeps pi's folded: its thinking is the whole raw reasoning", () => {
      show("pi");
      expect(screen.getByText("Done.")).toBeTruthy();
      expect(screen.queryByText("Plan: link to the wallet page")).toBeNull();
    });
  });

  it("shows a message sent mid-turn as queued until the agent reads it", () => {
    render(<ChatLens pane={pane} view={{ status: "working", agent: "claude", title: "claude" } as PaneView} />);
    const send = (queued: string[]) =>
      act(() => channels[channels.length - 1].onmessage({ type: "meta", model: null, effort: null, context_tokens: null, queued, background: [] }));
    act(() => channels[channels.length - 1].onmessage({ type: "reset", items: [], total: 0 }));
    expect(screen.queryByRole("list", { name: "Queued messages" })).toBeNull();
    send(["sao không commit đi?"]);
    const list = screen.getByRole("list", { name: "Queued messages" });
    expect(list.textContent).toContain("sao không commit đi?");
    expect(list.textContent).toContain("Queued");
    send([]);
    expect(screen.queryByRole("list", { name: "Queued messages" })).toBeNull();
  });

  it("shows the background tasks while the agent runs, and hides them once it is gone", () => {
    const view = { status: "idle", agent: "claude", title: "claude" } as PaneView;
    const { rerender } = render(<ChatLens pane={pane} view={view} />);
    act(() =>
      channels[channels.length - 1].onmessage({
        type: "meta", model: null, effort: null, context_tokens: null, queued: [],
        background: [{ call_id: "t1", kind: "bash", description: "Run CI", started: "2026-10-10T17:08:00.000Z" }],
      }),
    );
    expect(screen.getByRole("button", { name: /1 shell in background/ })).toBeTruthy();
    rerender(<ChatLens pane={pane} view={{ ...view, agent: null }} />);
    expect(screen.queryByRole("button", { name: /in background/ })).toBeNull();
  });

  it("says a forked pane is a fork, of what and since when, and goes back to the original", () => {
    const of = { machine_id: "m1", session: "s", pane_id: "w1:p1" };
    useForks.setState({ forks: { [paneKey(pane)]: { of, from: "Port Files panel", at: new Date(2026, 9, 9, 16, 5).getTime(), worktree: "fork-20261009-1605" } } });
    render(<ChatLens pane={pane} view={idlePi} />);
    const banner = screen.getByRole("status", { name: "Fork" });
    expect(banner.textContent).toContain("Forked from Port Files panel at 16:05");
    expect(banner.textContent).toContain("worktree fork-20261009-1605");
    expect(banner.textContent).toContain("knows nothing the original did after that");
    fireEvent.click(screen.getByRole("button", { name: "Back to original" }));
    expect(useApp.getState().selected).toEqual(of);
    useForks.setState({ forks: {} });
  });

  describe("a fork with no transcript of its own yet", () => {
    const of = { machine_id: "devtuf", session: "default", pane_id: "w1:p0" };
    const at = Date.parse("2026-10-10T04:48:00Z");
    const pendingFork = { agent: "claude", path: "/p/fork.jsonl", ambiguous: false, candidates: [], pending: true };
    const history = [
      { kind: "user", text: "before the fork", ts: "2026-10-10T04:40:00Z" },
      { kind: "assistant_text", markdown: "an answer", ts: "2026-10-10T04:41:00Z" },
      { kind: "user", text: "after the fork", ts: "2026-10-10T04:50:00Z" },
    ];
    const outlined = () => [...screen.getByRole("navigation", { name: "Conversation outline" }).querySelectorAll("ol button")].map((b) => b.textContent);

    it("shows the original's history up to the fork, then its own transcript once Claude writes it", async () => {
      useForks.setState({ forks: { [paneKey(pane)]: { of, from: "Main", at, worktree: null, path: "/p/orig.jsonl" } } });
      opened = Promise.resolve(pendingFork);
      vi.mocked(chatLocate).mockImplementation(() => Promise.resolve(pendingFork) as never);
      render(<ChatLens pane={pane} view={idlePi} />);
      await waitFor(() => expect(openedPaths).toEqual([null, "/p/orig.jsonl"]));
      act(() => channels[1].onmessage({ type: "reset", items: history, total: history.length }));
      expect(outlined()).toEqual(["before the fork"]);
      expect(screen.getByText(/History copied from Main up to the fork/)).toBeTruthy();
      expect(screen.queryByText("New conversation: send the first message to start it.")).toBeNull();
      // The first message makes Claude write the fork's own transcript: the lens moves to it.
      vi.mocked(chatLocate).mockImplementation(() => Promise.resolve({ ...pendingFork, path: "/p/fork2.jsonl", pending: false }) as never);
      await waitFor(() => expect(openedPaths[openedPaths.length - 1]).toBeNull(), { timeout: 3000 });
      expect(openedPaths.length).toBeGreaterThan(2);
      useForks.setState({ forks: {} });
    });

    it("badges none of the original's running tasks while it only previews the original", async () => {
      useForks.setState({ forks: { [paneKey(pane)]: { of, from: "Main", at, worktree: null, path: "/p/orig.jsonl" } } });
      opened = Promise.resolve(pendingFork);
      vi.mocked(chatLocate).mockImplementation(() => Promise.resolve(pendingFork) as never);
      viewport.on = true;
      render(<ChatLens pane={pane} view={{ status: "idle", agent: "claude", title: "claude" } as PaneView} />);
      await waitFor(() => expect(openedPaths).toEqual([null, "/p/orig.jsonl"]));
      const items = [
        { kind: "user", text: "run ci", ts: "2026-10-10T04:40:00Z" },
        { kind: "tool_call", id: "bg1", name: "Bash", input_summary: "ci", input: { command: "ci" }, ts: "2026-10-10T04:40:01Z" },
        { kind: "assistant_text", markdown: "started", ts: "2026-10-10T04:41:00Z" },
      ];
      act(() => channels[1].onmessage({ type: "reset", items, total: items.length }));
      act(() =>
        channels[1].onmessage({
          type: "meta", model: null, effort: null, context_tokens: null, queued: [],
          background: [{ call_id: "bg1", kind: "bash", description: "Run CI", started: null }],
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: /^Worked/ }));
      expect(screen.getByText("ci")).toBeTruthy();
      expect(screen.queryByText("background · running")).toBeNull();
      useForks.setState({ forks: {} });
    });

    it("finds the original's transcript for a fork recorded without one", async () => {
      useForks.setState({ forks: { [paneKey(pane)]: { of, from: "Main", at, worktree: null } } });
      opened = Promise.resolve(pendingFork);
      vi.mocked(chatLocate).mockImplementation(((p: { pane_id: string }) =>
        Promise.resolve(p.pane_id === of.pane_id ? { ...pendingFork, path: "/p/orig.jsonl", pending: false } : pendingFork)) as never);
      render(<ChatLens pane={pane} view={idlePi} />);
      await waitFor(() => expect(openedPaths).toEqual([null, "/p/orig.jsonl"]));
      useForks.setState({ forks: {} });
    });
  });

  it("runs at the chat width chosen in Settings, and follows a change", () => {
    useLensSettings.setState({ chatWidth: "comfortable" });
    const { container } = render(<ChatLens pane={pane} view={idlePi} />);
    const lens = container.querySelector<HTMLElement>(".chat-lens")!;
    expect(lens.dataset.width).toBe("comfortable");
    act(() => useLensSettings.getState().setChatWidth("full"));
    expect(lens.dataset.width).toBe("full");
  });

  it("outlines the user turns beside the transcript", () => {
    render(<ChatLens pane={pane} view={idlePi} />);
    const items = [
      { kind: "user", text: "fix the header" },
      { kind: "assistant_text", markdown: "done" },
      { kind: "user", text: "now the footer" },
    ];
    act(() => channels[channels.length - 1].onmessage({ type: "reset", items, total: items.length }));
    const nav = screen.getByRole("navigation", { name: "Conversation outline" });
    expect([...nav.querySelectorAll("ol button")].map((b) => b.textContent)).toEqual(["fix the header", "now the footer"]);
  });

  it("puts the /btw column in the outline's place while it is open", () => {
    render(<ChatLens pane={pane} view={{ ...idlePi, agent: "claude" }} />);
    screen.getByRole("navigation", { name: "Conversation outline" });
    act(() => useBtw.getState().openBtw(pane));
    const column = screen.getByRole("region", { name: "Side question" });
    expect(column.previousElementSibling?.classList.contains("chat-main")).toBe(true);
    expect(screen.queryByRole("navigation", { name: "Conversation outline" })).toBeNull();
    act(() => useBtw.setState({ open: {} }));
    screen.getByRole("navigation", { name: "Conversation outline" });
  });

  it("keeps the turn picked in the outline lit until the transcript is scrolled", () => {
    const { container } = render(<ChatLens pane={pane} view={idlePi} />);
    const items = [
      { kind: "user", text: "fix the header" },
      { kind: "assistant_text", markdown: "done" },
      { kind: "user", text: "now the footer" },
    ];
    act(() => channels[channels.length - 1].onmessage({ type: "reset", items, total: items.length }));
    const lit = () => screen.getByRole("navigation", { name: "Conversation outline" }).querySelector("[aria-current]")?.textContent;
    expect(lit()).toBe("fix the header");
    fireEvent.click(screen.getByRole("button", { name: "now the footer" }));
    expect(lit()).toBe("now the footer");
    fireEvent.wheel(container.querySelector(".chat-scroll")!);
    expect(lit()).toBe("fix the header");
  });

  it("folds every turn's work by default, the latest one too", async () => {
    viewport.on = true;
    opened = Promise.resolve({ agent: "pi", path: "/h/sid.jsonl", ambiguous: false, candidates: ["/h/sid.jsonl"], pending: false });
    render(<ChatLens pane={pane} view={idlePi} />);
    await act(async () => {});
    const items = [
      { kind: "user", text: "fix the header" },
      { kind: "tool_call", id: "c1", name: "Bash", input_summary: "git status", input: {} },
      { kind: "tool_result", call_id: "c1", output: "clean", is_error: false },
      { kind: "assistant_text", markdown: "done" },
    ];
    act(() => channels[channels.length - 1].onmessage({ type: "reset", items, total: items.length }));
    const head = screen.getByRole("button", { name: /^Worked/ });
    expect(head.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
  });

  describe("background tasks in folded work", () => {
    let cleanupRerender: (view: PaneView) => void = () => {};
    const load = async (extra: unknown[] = []) => {
      viewport.on = true;
      opened = Promise.resolve({ agent: "claude", path: "/h/sid.jsonl", ambiguous: false, candidates: ["/h/sid.jsonl"], pending: false });
      const { rerender } = render(<ChatLens pane={pane} view={{ status: "idle", agent: "claude", title: "claude" } as PaneView} />);
      cleanupRerender = (view) => rerender(<ChatLens pane={pane} view={view} />);
      await act(async () => {});
      const items = [
        { kind: "user", text: "run the ci" },
        { kind: "tool_call", id: "bg1", name: "Bash", input_summary: "mise run ci", input: { command: "mise run ci" } },
        { kind: "tool_result", call_id: "bg1", output: "started", is_error: false },
        ...extra,
        { kind: "assistant_text", markdown: "started it" },
      ];
      act(() => channels[channels.length - 1].onmessage({ type: "reset", items, total: items.length }));
    };

    it("opens the folded work block holding a task when its strip row is clicked", async () => {
      await load();
      act(() =>
        channels[channels.length - 1].onmessage({
          type: "meta", model: null, effort: null, context_tokens: null, queued: [],
          background: [{ call_id: "bg1", kind: "bash", description: "Run CI", started: null }],
        }),
      );
      const head = screen.getByRole("button", { name: /^Worked/ });
      expect(head.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(within(openStrip()).getByRole("button", { name: /Run CI/ }));
      expect(screen.getByRole("button", { name: /^Worked/ }).getAttribute("aria-expanded")).toBe("true");
    });

    it("brings the task's own card into view after opening its block", async () => {
      const scroll = vi.fn();
      const orig = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = scroll;
      try {
        await load();
        bgMeta();
        fireEvent.click(within(openStrip()).getByRole("button", { name: /Run CI/ }));
        const cards = () => (scroll.mock.contexts as HTMLElement[]).map((el) => el.dataset.call);
        await waitFor(() => expect(cards()).toContain("bg1"));
      } finally {
        Element.prototype.scrollIntoView = orig;
      }
    });

    const bgMeta = () =>
      act(() =>
        channels[channels.length - 1].onmessage({
          type: "meta", model: null, effort: null, context_tokens: null, queued: [],
          background: [{ call_id: "bg1", kind: "bash", description: "Run CI", started: null }],
        }),
      );

    it("badges a running task's call, and stops once the agent is gone", async () => {
      await load();
      bgMeta();
      fireEvent.click(screen.getByRole("button", { name: /^Worked/ }));
      expect(screen.getByText("background · running")).toBeTruthy();
      cleanupRerender({ status: "idle", agent: null, title: "sh" } as PaneView);
      expect(screen.queryByText("background · running")).toBeNull();
    });

    // Claude Code shows such an agent as done (◯): only its own shell runs, which the
    // transcript may never report ending.
    it("neither badges nor lists an agent waiting on its own background work", async () => {
      await load();
      act(() =>
        channels[channels.length - 1].onmessage({
          type: "meta", model: null, effort: null, context_tokens: null, queued: [],
          background: [{ call_id: "bg1", kind: "agent", description: "Review", started: null, waiting: true }],
        }),
      );
      expect(screen.queryByRole("button", { name: /in background/ })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /^Worked/ }));
      expect(screen.queryByText("background · running")).toBeNull();
    });

    it("shows a neutral `ended` for a task end with no status", async () => {
      await load([{ kind: "system", text: "", task: { call_id: "bg1", status: "" } }]);
      fireEvent.click(screen.getByRole("button", { name: /^Worked/ }));
      expect(screen.getByText("ended").className).toContain("neutral");
    });

    it("loads older pages until the clicked task's call appears, then opens its block", async () => {
      vi.mocked(chatPage).mockReset().mockImplementation((async (_p: unknown, before: number) =>
        before === 4 ? [{ kind: "user", text: "u2" }, { kind: "assistant_text", markdown: "a2" }]
          : before === 2 ? [
            { kind: "tool_call", id: "bg9", name: "Bash", input_summary: "sleep", input: { command: "sleep" } },
            { kind: "tool_result", call_id: "bg9", output: "started", is_error: false },
          ] : []) as never);
      viewport.on = true;
      opened = Promise.resolve({ agent: "claude", path: "/h/sid.jsonl", ambiguous: false, candidates: ["/h/sid.jsonl"], pending: false });
      render(<ChatLens pane={pane} view={{ status: "idle", agent: "claude", title: "claude" } as PaneView} />);
      await act(async () => {});
      const items = [{ kind: "user", text: "now" }, { kind: "assistant_text", markdown: "ok" }];
      act(() => channels[channels.length - 1].onmessage({ type: "reset", items, total: 6 }));
      act(() =>
        channels[channels.length - 1].onmessage({
          type: "meta", model: null, effort: null, context_tokens: null, queued: [],
          background: [{ call_id: "bg9", kind: "bash", description: "Old job", started: null }],
        }),
      );
      fireEvent.click(within(openStrip()).getByRole("button", { name: /Old job/ }));
      await waitFor(() => expect(screen.getAllByRole("button", { name: /^Worked/ })[0].getAttribute("aria-expanded")).toBe("true"));
      expect(vi.mocked(chatPage).mock.calls.map((c) => c[1])).toEqual([4, 2]);
    });

    it("says so when the clicked task's call is not in the transcript at all", async () => {
      vi.mocked(chatPage).mockReset().mockResolvedValue([]);
      viewport.on = true;
      opened = Promise.resolve({ agent: "claude", path: "/h/sid.jsonl", ambiguous: false, candidates: ["/h/sid.jsonl"], pending: false });
      render(<ChatLens pane={pane} view={{ status: "idle", agent: "claude", title: "claude" } as PaneView} />);
      await act(async () => {});
      const items = [{ kind: "user", text: "now" }];
      act(() => channels[channels.length - 1].onmessage({ type: "reset", items, total: 5 }));
      act(() =>
        channels[channels.length - 1].onmessage({
          type: "meta", model: null, effort: null, context_tokens: null, queued: [],
          background: [{ call_id: "gone", kind: "bash", description: "Lost job", started: null }],
        }),
      );
      fireEvent.click(within(openStrip()).getByRole("button", { name: /Lost job/ }));
      expect(await screen.findByText(/Task call not found in the transcript/)).toBeTruthy();
    });

    it("badges a finished task's call with how it ended", async () => {
      await load([{ kind: "system", text: "Background command finished", task: { call_id: "bg1", status: "completed", exit_code: 0 } }]);
      fireEvent.click(screen.getByRole("button", { name: /^Worked/ }));
      expect(screen.getByText("exit 0")).toBeTruthy();
    });
  });
});
