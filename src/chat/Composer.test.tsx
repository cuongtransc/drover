import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({
  herdrCall: vi.fn().mockResolvedValue({}),
  imageSaveTemp: vi.fn(),
  completeCommands: vi.fn(),
  completeFiles: vi.fn(),
  completeEntries: vi.fn(),
  chatGitStatus: vi.fn().mockResolvedValue(null),
  claudePromptHistory: vi.fn().mockResolvedValue([]),
}));
vi.mock("./complete", async (orig) => {
  const m = await orig<typeof import("./complete")>();
  return { ...m, rankFiles: vi.fn(m.rankFiles) };
});
import { claudePromptHistory, completeCommands, completeEntries, completeFiles, herdrCall, imageSaveTemp } from "../lib/ipc";
import { rankFiles } from "./complete";
import { DEFAULT_QUICK_REPLIES, useQuickReplies } from "../settings/quickReplies";
import { DEFAULT_HIDDEN_FOLDERS } from "../settings/hiddenFolders";
import { Composer } from "./Composer";
import { clearCompletionCache } from "./useCompletions";
import { useDraftImages } from "./draftImages";
import { SUGGESTION_POLL_MS } from "./useClaudeSuggestion";
import { useApp } from "../store/app";
import { recordPrompt } from "./promptHistory";
import { useBtw } from "./btw";
import { useComposerFill, useRewind } from "./rewind";
const pane = { machine_id: "devtuf", session: "default", pane_id: "w1:p1" };
const png = () => new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });
const sendButton = () => screen.getByRole<HTMLButtonElement>("button", { name: "Send" });
const paste = (box: HTMLElement, files: File[], text = "") =>
  fireEvent.paste(box, { clipboardData: { files, getData: () => text } });

beforeEach(() => {
  vi.mocked(herdrCall).mockReset().mockResolvedValue({});
  vi.mocked(imageSaveTemp).mockReset().mockResolvedValue("/tmp/herdr-paste-1.png");
  clearCompletionCache();
  localStorage.clear();
  useDraftImages.setState({ byPane: {} });
  vi.mocked(completeCommands).mockReset().mockResolvedValue([
    { name: "clear", description: "Clear the conversation", source: "builtin" },
    { name: "compact", description: "Compact conversation context", source: "builtin" },
  ]);
  vi.mocked(claudePromptHistory).mockReset().mockResolvedValue([]);
  vi.mocked(completeFiles).mockReset().mockResolvedValue(["README.md", "src/x.ts", "src/y.ts", "my docs/a.md"]);
  vi.mocked(completeEntries)
    .mockReset()
    .mockImplementation(async (_p, dir) => (dir === "../" ? ["shared/", "Sibling/", ".hidden/", "notes.md"] : ["a.ts"]));
});

describe("Composer", () => {
  it("sends on Enter, newline on Shift+Enter", () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "fix the bug" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(herdrCall).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "agent.prompt", { target: "w1:p1", text: "fix the bug" });
    expect((box as HTMLTextAreaElement).value).toBe("");
  });
  it("follows a /btw to Claude for its answer", async () => {
    const ask = vi.fn().mockResolvedValue(undefined);
    useBtw.setState({ asides: {}, ask });
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "/btw why that file?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "agent.prompt", { target: "w1:p1", text: "/btw why that file?" });
    await waitFor(() => expect(ask).toHaveBeenCalledWith(pane, "why that file?", expect.any(Function)));
  });

  it("opens the side column from its /btw key, leaving the draft here alone", () => {
    useBtw.setState({ open: {} });
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    fireEvent.change(box, { target: { value: "and rename the Header" } });
    fireEvent.click(screen.getByRole("button", { name: "/btw" }));
    expect(useBtw.getState().open["devtuf/default/w1:p1"]).toBe(true);
    expect(box.value).toBe("and rename the Header");
    expect(herdrCall).not.toHaveBeenCalled();
  });

  it("has no /btw key for other agents", () => {
    render(<Composer pane={pane} agent="codex" />);
    expect(screen.queryByRole("button", { name: "/btw" })).toBeNull();
  });

  it("takes the message an edit hands back, ready to change and send", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    act(() => useComposerFill.setState({ fill: { "devtuf/default/w1:p1": "fix the bug in parser.rs" } }));
    await waitFor(() => expect(box.value).toBe("fix the bug in parser.rs"));
    expect(document.activeElement).toBe(box);
    expect(useComposerFill.getState().fill["devtuf/default/w1:p1"]).toBeUndefined();
  });

  it("keeps what was typed below the message an edit hands back", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    fireEvent.change(box, { target: { value: "half a thought" } });
    act(() => useComposerFill.setState({ fill: { "devtuf/default/w1:p1": "fix the bug" } }));
    await waitFor(() => expect(box.value).toBe("fix the bug\n\nhalf a thought"));
  });

  it("holds sends while an edit drives Claude's Rewind screen", () => {
    useRewind.setState({ edits: { "devtuf/default/w1:p1": { phase: "running" } } });
    render(<Composer pane={pane} agent="claude" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "next" } });
    expect(sendButton().disabled).toBe(true);
    useRewind.setState({ edits: {} });
  });

  it("leaves a /btw to other agents alone", async () => {
    const ask = vi.fn().mockResolvedValue(undefined);
    useBtw.setState({ asides: {}, ask });
    render(<Composer pane={pane} agent="codex" />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "/btw why?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(herdrCall).toHaveBeenCalled());
    expect(ask).not.toHaveBeenCalled();
  });

  it("holds sends while a /btw answers: Claude's panel would take the keys", () => {
    useBtw.setState({ asides: { "devtuf/default/w1:p1": { question: "q", phase: "asking", signal: { cancelled: false } } } });
    render(<Composer pane={pane} agent="claude" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "next" } });
    expect(sendButton().disabled).toBe(true);
    expect(sendButton().title).toMatch(/btw/);
    useBtw.setState({ asides: {} });
  });

  it("pins the pane's agent tab when it sends", () => {
    useApp.setState({ openItems: { items: [{ kind: "agent", ref: pane }], preview: "agent:devtuf/default/w1:p1", active: "agent:devtuf/default/w1:p1" } });
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(useApp.getState().openItems.preview).toBeNull();
    expect(useApp.getState().openItems.items).toEqual([{ kind: "agent", ref: pane }]);
  });

  it("drives an agent herdr's agent API does not know (a wrapper) through its pane", async () => {
    render(<Composer pane={pane} agent="claude" untracked />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "fix the bug" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "pane.send_input", { pane_id: "w1:p1", text: "\x1b[200~fix the bug\x1b[201~", keys: ["enter"] });
    fireEvent.click(screen.getByRole("button", { name: "Esc" }));
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "pane.send_keys", { pane_id: "w1:p1", keys: ["esc"] });
    expect(vi.mocked(herdrCall).mock.calls.some((c) => String(c[2]).startsWith("agent."))).toBe(false);
  });
  it("shows the context used once it passes half the window, warning from 75% with a /compact reply", () => {
    const meta = (context_tokens: number) => ({ model: "claude-opus-5-5", effort: "high", context_tokens });
    const { rerender } = render(<Composer pane={pane} agent="claude" meta={meta(300_000)} />);
    expect(screen.getByText(/claude-opus-5-5 · high · 300k/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "/compact" })).toBeNull();
    rerender(<Composer pane={pane} agent="claude" meta={meta(620_000)} />);
    const mid = document.querySelector(".composer-model")!;
    expect(mid.textContent).toBe("claude-opus-5-5 · high · 62%");
    expect(mid.className).toContain("ctx-mid");
    expect(screen.queryByRole("button", { name: "/compact" })).toBeNull();
    rerender(<Composer pane={pane} agent="claude" meta={meta(820_000)} />);
    const warn = document.querySelector(".composer-model")!;
    expect(warn.className).toContain("ctx-warn");
    expect(warn.getAttribute("title")).toBe("820k of 1M (82%) · compact at a natural break: /compact");
    fireEvent.click(screen.getByRole("button", { name: "/compact" }));
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "agent.prompt", { target: "w1:p1", text: "/compact" });
    rerender(<Composer pane={pane} agent="claude" meta={meta(950_000)} />);
    expect(document.querySelector(".composer-model")!.className).toContain("ctx-crit");
    expect(screen.getByRole("button", { name: "/compact" }).className).toContain("ctx-crit");
  });
  it("moves the caret to the line's start and end with Home and End", () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    fireEvent.change(box, { target: { value: "first line\nsecond line" } });
    box.setSelectionRange(15, 15);
    fireEvent.keyDown(box, { key: "Home" });
    expect([box.selectionStart, box.selectionEnd]).toEqual([11, 11]);
    fireEvent.keyDown(box, { key: "End" });
    expect([box.selectionStart, box.selectionEnd]).toEqual([22, 22]);
    box.setSelectionRange(4, 4);
    fireEvent.keyDown(box, { key: "End" });
    expect([box.selectionStart, box.selectionEnd]).toEqual([10, 10]);
  });
  it("selects to the line's edge with Shift and to the text's edge with Cmd", () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    fireEvent.change(box, { target: { value: "first line\nsecond line" } });
    box.setSelectionRange(15, 15);
    fireEvent.keyDown(box, { key: "Home", shiftKey: true });
    expect([box.selectionStart, box.selectionEnd, box.selectionDirection]).toEqual([11, 15, "backward"]);
    fireEvent.keyDown(box, { key: "End", shiftKey: true });
    expect([box.selectionStart, box.selectionEnd]).toEqual([15, 22]);
    fireEvent.keyDown(box, { key: "Home", metaKey: true });
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, 0]);
    fireEvent.keyDown(box, { key: "End", ctrlKey: true, shiftKey: true });
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, 22]);
  });
  it("sends Esc", () => {
    render(<Composer pane={pane} agent="claude" />);
    fireEvent.click(screen.getByRole("button", { name: "Esc" }));
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "agent.send_keys", { target: "w1:p1", keys: ["esc"] });
  });

  it("enables Stop only while the agent works, and Stop sends Esc", () => {
    const stop = () => screen.getByRole("button", { name: "Stop" }) as HTMLButtonElement;
    const { rerender } = render(<Composer pane={pane} agent="claude" status="idle" />);
    expect(stop().disabled).toBe(true);
    rerender(<Composer pane={pane} agent="claude" status="working" />);
    expect(stop().disabled).toBe(false);
    fireEvent.click(stop());
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "agent.send_keys", { target: "w1:p1", keys: ["esc"] });
    // Text typed while the agent works still sends: the agent queues it.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "also check the docs" } });
    expect(sendButton().disabled).toBe(false);
  });

  it("keeps each pane's unsent text across remounts and clears it once sent", () => {
    const other = { ...pane, pane_id: "w1:p2" };
    const first = render(<Composer pane={pane} agent="claude" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "half a thought" } });
    first.unmount();

    const second = render(<Composer pane={other} agent="claude" />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    second.unmount();

    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe("half a thought");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(localStorage.getItem("drover:draft:devtuf/default/w1:p1")).toBeNull();
  });

  it("restores the draft when the send fails", async () => {
    vi.mocked(herdrCall).mockRejectedValueOnce({ code: "timeout", message: "timed out" });
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "try again" } });
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(box.value).toBe("try again");
    // Written once the debounce passes.
    await waitFor(() => expect(localStorage.getItem("drover:draft:devtuf/default/w1:p1")).toBe("try again"));
  });

  it("saves a pasted image on the pane's machine and shows it as an attachment", async () => {
    render(<Composer pane={pane} agent="claude" />);
    paste(screen.getByRole("textbox"), [png()]);
    expect(sendButton().disabled).toBe(true);
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    expect(imageSaveTemp).toHaveBeenCalledWith("devtuf", expect.any(Uint8Array), "png");
    expect(screen.getByRole("img", { name: "Pasted image 1" })).toBeTruthy();
  });

  it("attaches an image dropped on the box, and keeps the drop from opening the file", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    const dataTransfer = { files: [png()], types: ["Files"] };
    expect(fireEvent.dragOver(box, { dataTransfer })).toBe(false);
    expect(fireEvent.drop(box, { dataTransfer })).toBe(false);
    await waitFor(() => expect(screen.getByRole("img", { name: "Pasted image 1" })).toBeTruthy());
    expect(imageSaveTemp).toHaveBeenCalledWith("devtuf", expect.any(Uint8Array), "png");
  });

  it("leaves a drop of text to the textarea", () => {
    render(<Composer pane={pane} agent="claude" />);
    const dataTransfer = { files: [], types: ["text/plain"] };
    expect(fireEvent.drop(screen.getByRole("textbox"), { dataTransfer })).toBe(true);
    expect(imageSaveTemp).not.toHaveBeenCalled();
  });

  it("removes a pasted image with its button, or with Backspace in an empty box", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    paste(box, [png(), png()]);
    await waitFor(() => expect(screen.getAllByRole("img", { name: /Pasted image/ })).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
    expect(screen.getAllByRole("img", { name: /Pasted image/ })).toHaveLength(1);
    // Backspace with text in the box edits the text, not the images.
    fireEvent.change(box, { target: { value: "a" } });
    fireEvent.keyDown(box, { key: "Backspace" });
    expect(screen.getAllByRole("img", { name: /Pasted image/ })).toHaveLength(1);
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.keyDown(box, { key: "Backspace" });
    expect(screen.queryByRole("img", { name: /Pasted image/ })).toBeNull();
  });

  it("pastes each image path for claude, then submits the text", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    paste(box, [png()]);
    fireEvent.change(box, { target: { value: "what is this" } });
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    // The submit waits for Claude to attach the pasted image.
    expect(vi.mocked(herdrCall).mock.calls.map((c) => c[2])).toEqual(["pane.send_text"]);
    await waitFor(() => expect(herdrCall).toHaveBeenCalledTimes(2));
    expect(vi.mocked(herdrCall).mock.calls).toEqual([
      ["devtuf", "default", "pane.send_text", { pane_id: "w1:p1", text: "\x1b[200~/tmp/herdr-paste-1.png\x1b[201~" }],
      ["devtuf", "default", "agent.prompt", { target: "w1:p1", text: "what is this" }],
    ]);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("submits images alone with Enter", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    paste(box, [png()]);
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    await waitFor(() => expect(herdrCall).toHaveBeenCalledTimes(2));
    expect(vi.mocked(herdrCall).mock.calls.map((c) => c[2])).toEqual(["pane.send_text", "agent.send_keys"]);
    expect(herdrCall).toHaveBeenLastCalledWith("devtuf", "default", "agent.send_keys", { target: "w1:p1", keys: ["enter"] });
  });

  it("mentions image paths with @ for agents without path-paste attachments", async () => {
    render(<Composer pane={pane} agent="pi" />);
    const box = screen.getByRole("textbox");
    paste(box, [png()]);
    fireEvent.change(box, { target: { value: "describe" } });
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
    expect(vi.mocked(herdrCall).mock.calls).toEqual([
      ["devtuf", "default", "agent.prompt", { target: "w1:p1", text: "@/tmp/herdr-paste-1.png describe" }],
    ]);
  });

  it("removes an attachment", async () => {
    render(<Composer pane={pane} agent="claude" />);
    paste(screen.getByRole("textbox"), [png()]);
    await waitFor(() => expect(screen.getByRole("img", { name: "Pasted image 1" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(sendButton().disabled).toBe(true);
  });

  it("drops the attachment and reports a failed save", async () => {
    vi.mocked(imageSaveTemp).mockRejectedValue({ code: "not_found", message: "machine devtuf is not connected" });
    render(<Composer pane={pane} agent="claude" />);
    paste(screen.getByRole("textbox"), [png()]);
    expect((await screen.findByRole("alert")).textContent).toContain("machine devtuf is not connected");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("keeps a pasted image through a tab switch, for its own pane only", async () => {
    const { unmount } = render(<Composer pane={pane} agent="claude" />);
    paste(screen.getByRole("textbox"), [png()]);
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    unmount();
    const other = render(<Composer pane={{ ...pane, pane_id: "w1:p2" }} agent="claude" />);
    expect(screen.queryByRole("img")).toBeNull();
    other.unmount();
    render(<Composer pane={pane} agent="claude" />);
    expect(screen.getByRole("img", { name: "Pasted image 1" })).toBeTruthy();
    expect(sendButton().disabled).toBe(false);
  });

  it("finishes saving an image pasted just before a tab switch", async () => {
    let finish: (path: string) => void = () => {};
    vi.mocked(imageSaveTemp).mockReturnValue(new Promise((r) => (finish = r)));
    const { unmount } = render(<Composer pane={pane} agent="claude" />);
    paste(screen.getByRole("textbox"), [png()]);
    await waitFor(() => expect(imageSaveTemp).toHaveBeenCalled());
    unmount();
    await act(async () => finish("/tmp/herdr-paste-1.png"));
    render(<Composer pane={pane} agent="claude" />);
    expect(screen.getByRole("img", { name: "Pasted image 1" })).toBeTruthy();
    expect(sendButton().disabled).toBe(false);
  });

  it("shows each pane's own images when one Composer switches panes", async () => {
    const { rerender } = render(<Composer pane={pane} agent="claude" />);
    paste(screen.getByRole("textbox"), [png()]);
    await waitFor(() => expect(sendButton().disabled).toBe(false));
    rerender(<Composer pane={{ ...pane, pane_id: "w1:p2" }} agent="claude" />);
    expect(screen.queryByRole("img")).toBeNull();
    rerender(<Composer pane={pane} agent="claude" />);
    expect(screen.getByRole("img", { name: "Pasted image 1" })).toBeTruthy();
  });

  it("leaves text-only pastes to the textarea", () => {
    render(<Composer pane={pane} agent="claude" />);
    paste(screen.getByRole("textbox"), [], "hello");
    expect(imageSaveTemp).not.toHaveBeenCalled();
  });
});

const RULE = "\u001b[38;2;136;136;136m" + "─".repeat(60) + "\u001b[0m";
const claudeScreen = (suggestion: string) => ["● done", RULE, `❯ \u001b[2m${suggestion}\u001b[0m`, RULE, "  ⏵⏵ accept edits on"].join("\r\n");
const reads = () => vi.mocked(herdrCall).mock.calls.filter((c) => c[2] === "pane.read");

describe("Composer suggestion", () => {
  beforeEach(() => {
    vi.mocked(herdrCall).mockImplementation(async (_m, _s, method) =>
      method === "pane.read" ? { text: claudeScreen("run the tests again") } : {},
    );
  });

  it("shows Claude's suggestion as the placeholder and takes it with Tab", async () => {
    render(<Composer pane={pane} agent="claude" status="done" />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await waitFor(() => expect(box.placeholder).toContain("run the tests again"));
    expect(reads()[0][3]).toEqual({ pane_id: "w1:p1", source: "visible", format: "ansi", strip_ansi: false });
    const tab = fireEvent.keyDown(box, { key: "Tab" });
    expect(tab).toBe(false);
    expect(box.value).toBe("run the tests again");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "agent.prompt", { target: "w1:p1", text: "run the tests again" });
  });

  it("does not read the old suggestion back while a send is on its way", async () => {
    let finish!: () => void;
    render(<Composer pane={pane} agent="claude" status="idle" />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await waitFor(() => expect(box.placeholder).toContain("run the tests again"));
    vi.mocked(herdrCall).mockImplementation(async (_m, _s, method) => {
      if (method === "pane.read") return { text: claudeScreen("run the tests again") };
      await new Promise<void>((r) => (finish = r));
      return {};
    });
    const before = reads().length;
    fireEvent.change(box, { target: { value: "something else" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await act(async () => {});
    expect(reads()).toHaveLength(before);
    expect(box.placeholder).not.toContain("run the tests again");
    await act(async () => finish());
  });

  it("leaves Tab alone while something is typed", async () => {
    render(<Composer pane={pane} agent="claude" status="idle" />);
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    await waitFor(() => expect(box.placeholder).toContain("run the tests again"));
    fireEvent.change(box, { target: { value: "my own" } });
    expect(fireEvent.keyDown(box, { key: "Tab" })).toBe(true);
    expect(box.value).toBe("my own");
  });

  it("reads again while Claude waits, and drops the suggestion once it works", async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<Composer pane={pane} agent="claude" status="idle" />);
      await act(async () => {});
      expect(reads()).toHaveLength(1);
      vi.mocked(herdrCall).mockImplementation(async (_m, _s, method) =>
        method === "pane.read" ? { text: claudeScreen("commit it") } : {},
      );
      await act(async () => vi.advanceTimersByTime(SUGGESTION_POLL_MS));
      expect(reads()).toHaveLength(2);
      const box = screen.getByRole("textbox") as HTMLTextAreaElement;
      expect(box.placeholder).toContain("commit it");

      rerender(<Composer pane={pane} agent="claude" status="working" />);
      expect(box.placeholder).not.toContain("commit it");
      await act(async () => vi.advanceTimersByTime(SUGGESTION_POLL_MS * 3));
      expect(reads()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads no suggestion for other agents", async () => {
    render(<Composer pane={pane} agent="codex" status="idle" />);
    await act(async () => {});
    expect(reads()).toHaveLength(0);
  });
});

const type = (box: HTMLElement, value: string) =>
  fireEvent.change(box, { target: { value, selectionStart: value.length, selectionEnd: value.length } });

describe("Composer completion", () => {
  it("inserts the chosen slash command without sending and counts the pick", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    type(box, "/c");
    await screen.findByRole("option", { name: /\/clear/ });
    expect(completeCommands).toHaveBeenCalledWith(pane);
    expect(screen.getByText("dismiss")).toBeTruthy();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect((box as HTMLTextAreaElement).value).toBe("/compact ");
    expect(herdrCall).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(JSON.parse(localStorage.getItem("drover:slash-usage:claude")!)).toEqual({ compact: 1 });
  });

  it("dismisses with Escape, after which Enter sends", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    type(box, "/c");
    await screen.findByRole("listbox");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "agent.prompt", { target: "w1:p1", text: "/c" });
  });

  it("completes a file path with Tab", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    type(box, "look at @src/x");
    await screen.findByRole("option", { name: /src\/x\.ts/ });
    expect(completeFiles).toHaveBeenCalledWith(pane, DEFAULT_HIDDEN_FOLDERS);
    fireEvent.keyDown(box, { key: "Tab" });
    expect((box as HTMLTextAreaElement).value).toBe("look at @src/x.ts ");
  });

  it("lists the parent folder for @../ and drills into a chosen folder", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    type(box, "@../");
    await screen.findByRole("option", { name: /\.\.\/shared\// });
    expect(completeEntries).toHaveBeenCalledWith(pane, "../");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("../shared/"),
      expect.stringContaining("../Sibling/"),
      expect.stringContaining("../notes.md"),
    ]);
    type(box, "@../s");
    await screen.findByRole("option", { name: /\.\.\/Sibling\// });
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.keyDown(box, { key: "Tab" });
    expect((box as HTMLTextAreaElement).value).toBe("@../shared/");
    await screen.findByRole("option", { name: /\.\.\/shared\/a\.ts/ });
    expect(completeEntries).toHaveBeenCalledWith(pane, "../shared/");
    fireEvent.keyDown(box, { key: "Tab" });
    expect((box as HTMLTextAreaElement).value).toBe("@../shared/a.ts ");
  });

  it("ranks files only when the list or the query changes", async () => {
    const { rerender } = render(<Composer pane={pane} agent="claude" status="idle" />);
    const box = screen.getByRole("textbox");
    type(box, "@src");
    await screen.findByRole("option", { name: /src\/x\.ts/ });
    const calls = vi.mocked(rankFiles).mock.calls.length;
    rerender(<Composer pane={pane} agent="claude" status="working" />);
    expect(vi.mocked(rankFiles).mock.calls.length).toBe(calls);
    type(box, "@src/y");
    await screen.findByRole("option", { name: /src\/y\.ts/ });
    expect(vi.mocked(rankFiles).mock.calls.length).toBe(calls + 1);
  });

  it("quotes a path with spaces", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    type(box, "@my");
    await screen.findByRole("option", { name: /my docs\/a\.md/ });
    fireEvent.keyDown(box, { key: "Enter" });
    expect((box as HTMLTextAreaElement).value).toBe('@"my docs/a.md" ');
  });

  it("chooses a row with the mouse", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    type(box, "/c");
    fireEvent.mouseDown(await screen.findByRole("option", { name: /\/compact/ }));
    expect((box as HTMLTextAreaElement).value).toBe("/compact ");
  });

  it("offers no slash commands to other agents", async () => {
    render(<Composer pane={pane} agent="gemini" />);
    type(screen.getByRole("textbox"), "/c");
    await act(async () => {});
    expect(completeCommands).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows a failed listing in the list and still sends on Enter", async () => {
    vi.mocked(completeFiles).mockRejectedValue({ code: "not_found", message: "machine devtuf is not connected" });
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    type(box, "see @sr");
    expect(await screen.findByText("Couldn't list files")).toBeTruthy();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "agent.prompt", { target: "w1:p1", text: "see @sr" });
  });

  it("closes a failed listing with Escape", async () => {
    vi.mocked(completeFiles).mockRejectedValue({ code: "not_found", message: "machine devtuf is not connected" });
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    type(box, "see @sr");
    await screen.findByText("Couldn't list files");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(herdrCall).not.toHaveBeenCalled();
  });

  it("closes a loading listing with Escape", async () => {
    vi.mocked(completeCommands).mockReturnValue(new Promise(() => {}));
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    type(box, "/c");
    expect(await screen.findByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("leaves Shift+Enter a newline while the list is open", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole("textbox");
    type(box, "/c");
    await screen.findByRole("option", { name: /\/clear/ });
    const shiftEnter = fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    // Not prevented: the textarea inserts its newline.
    expect(shiftEnter).toBe(true);
    expect((box as HTMLTextAreaElement).value).toBe("/c");
    expect(herdrCall).not.toHaveBeenCalled();
  });

  it("keeps showing an expired listing while it refetches", async () => {
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000_000);
      const first = render(<Composer pane={pane} agent="claude" />);
      type(screen.getByRole("textbox"), "/c");
      await screen.findByRole("option", { name: /\/clear/ });
      first.unmount();
      // Start blank rather than from the "/c" draft, so typing it again is a change.
      localStorage.removeItem("drover:draft:devtuf/default/w1:p1");

      render(<Composer pane={pane} agent="claude" />);
      const box = screen.getByRole("textbox");
      type(box, "/c");
      expect(screen.getByRole("option", { name: /\/clear/ })).toBeTruthy();
      expect(completeCommands).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_031_000);
      type(box, "/co");
      expect(screen.getByRole("option", { name: /\/compact/ })).toBeTruthy();
      expect(screen.queryByText(/Loading/)).toBeNull();
      await waitFor(() => expect(completeCommands).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole("option", { name: /\/compact/ })).toBeTruthy();
    } finally {
      now.mockRestore();
    }
  });
});

describe("Composer quick replies", () => {
  beforeEach(() => useQuickReplies.setState({ show: true, replies: [...DEFAULT_QUICK_REPLIES] }));

  it("sends a quick reply at once, leaving the draft alone", () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    fireEvent.change(box, { target: { value: "half a thought" } });
    const group = screen.getByRole("group", { name: "Quick replies" });
    fireEvent.click(within(group).getByRole("button", { name: "continue" }));
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "agent.prompt", { target: "w1:p1", text: "continue" });
    expect(box.value).toBe("half a thought");
  });

  it("disables the replies while one is on its way", async () => {
    let finish: (v: unknown) => void = () => {};
    vi.mocked(herdrCall).mockReturnValueOnce(new Promise((r) => (finish = r)));
    render(<Composer pane={pane} agent="claude" />);
    fireEvent.click(screen.getByRole("button", { name: "ok" }));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "continue" }).disabled).toBe(true);
    await act(async () => finish({}));
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "continue" }).disabled).toBe(false);
  });

  it("shows the replies with text only, and none when switched off", () => {
    useQuickReplies.setState({ replies: ["ship it", "  "] });
    const { unmount } = render(<Composer pane={pane} agent="claude" />);
    expect(within(screen.getByRole("group", { name: "Quick replies" })).getAllByRole("button")).toHaveLength(1);
    unmount();
    useQuickReplies.setState({ show: false });
    render(<Composer pane={pane} agent="claude" />);
    expect(screen.queryByRole("group", { name: "Quick replies" })).toBeNull();
  });
});

describe("Composer /model to pi", () => {
  const sendText = (value: string) => {
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value } });
    fireEvent.keyDown(box, { key: "Enter" });
  };

  it("calls onPiModel once /model has gone to pi", async () => {
    const onPiModel = vi.fn();
    render(<Composer pane={pane} agent="pi" onPiModel={onPiModel} />);
    sendText(" /model ");
    await waitFor(() => expect(onPiModel).toHaveBeenCalledTimes(1));
  });

  it("calls onPiModel for /model with a name after it", async () => {
    const onPiModel = vi.fn();
    render(<Composer pane={pane} agent="pi" onPiModel={onPiModel} />);
    sendText("/model sonnet");
    await waitFor(() => expect(onPiModel).toHaveBeenCalledTimes(1));
  });

  it("does not call onPiModel for claude, for another command, or for a failed send", async () => {
    const onPiModel = vi.fn();
    const { unmount } = render(<Composer pane={pane} agent="claude" onPiModel={onPiModel} />);
    sendText("/model");
    unmount();
    render(<Composer pane={{ ...pane, pane_id: "w1:p2" }} agent="pi" onPiModel={onPiModel} />);
    sendText("/models");
    sendText("/tree");
    vi.mocked(herdrCall).mockRejectedValueOnce({ code: "timeout", message: "timed out" });
    sendText("/model");
    await waitFor(() => expect(herdrCall).toHaveBeenCalledTimes(4));
    await act(async () => {});
    expect(onPiModel).not.toHaveBeenCalled();
  });
});

describe("Composer model label", () => {
  it("shows the Model, effort and context tokens when known", () => {
    render(<Composer pane={pane} agent="claude" meta={{ model: "claude-opus-5-5", effort: "high", context_tokens: 48612 }} />);
    const label = screen.getByTitle("Model · reasoning effort · context tokens");
    expect(label.textContent).toBe("claude-opus-5-5 · high · 48.6k");
  });
  it("shows nothing when neither is known", () => {
    render(<Composer pane={pane} agent="pi" meta={{ model: null, effort: null, context_tokens: null }} />);
    expect(screen.queryByTitle("Model · reasoning effort · context tokens")).toBeNull();
  });
  it("stays plain text for agents other than Claude", () => {
    render(<Composer pane={pane} agent="pi" meta={{ model: "gpt-5", effort: null, context_tokens: null }} />);
    expect(screen.getByTitle("Model · reasoning effort · context tokens").tagName).toBe("SPAN");
  });
});

describe("Composer model menu", () => {
  const meta = { model: "claude-opus-5-5", effort: "high", context_tokens: null };
  const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /claude-opus-5-5 · high/ }));

  it("switches Claude's model with /model", () => {
    render(<Composer pane={pane} agent="claude" status="idle" meta={meta} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "sonnet" }));
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "agent.prompt", { target: "w1:p1", text: "/model sonnet" });
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("sets Claude's effort with /effort", () => {
    render(<Composer pane={pane} agent="claude" status="idle" meta={meta} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "max" }));
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "agent.prompt", { target: "w1:p1", text: "/effort max" });
  });
  it("checks the current model and effort", () => {
    render(<Composer pane={pane} agent="claude" status="idle" meta={meta} />);
    openMenu();
    expect(screen.getByRole("menuitemradio", { name: "opus" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "fable" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("menuitemradio", { name: "high" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "sonnet" }).getAttribute("aria-checked")).toBe("false");
  });
  it("closes on Escape without sending", () => {
    render(<Composer pane={pane} agent="claude" status="idle" meta={meta} />);
    openMenu();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(herdrCall).not.toHaveBeenCalledWith("devtuf", "default", "agent.prompt", expect.anything());
  });
  it("offers the menu before the Transcript names a model", () => {
    render(<Composer pane={pane} agent="claude" status="idle" />);
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    expect(screen.getByRole("menu")).toBeTruthy();
  });
  it("is unavailable while Claude works or waits on a prompt", () => {
    const { rerender } = render(<Composer pane={pane} agent="claude" status="working" meta={meta} />);
    const button = () => screen.getByRole<HTMLButtonElement>("button", { name: /claude-opus-5-5 · high/ });
    expect(button().disabled).toBe(true);
    rerender(<Composer pane={pane} agent="claude" status="blocked" meta={meta} />);
    expect(button().disabled).toBe(true);
  });
});

describe("Composer prompt history", () => {
  const up = (box: HTMLElement) => fireEvent.keyDown(box, { key: "ArrowUp" });
  const down = (box: HTMLElement) => fireEvent.keyDown(box, { key: "ArrowDown" });
  const sendText = async (box: HTMLElement, value: string) => {
    type(box, value);
    await act(async () => fireEvent.keyDown(box, { key: "Enter" }));
  };

  it("recalls Claude's own history for the folder, then what was sent since, as Claude's terminal does", async () => {
    vi.mocked(claudePromptHistory).mockResolvedValue(["from the terminal", "from yesterday"]);
    recordPrompt("devtuf/default/w1:p1", "only in Drover");
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    await waitFor(() => expect(claudePromptHistory).toHaveBeenCalledWith(pane));
    await act(async () => {});
    up(box);
    expect(box.value).toBe("from yesterday");
    up(box);
    expect(box.value).toBe("from the terminal");
    down(box);
    down(box);
    await sendText(box, "just now");
    up(box);
    expect(box.value).toBe("just now");
    up(box);
    expect(box.value).toBe("from yesterday");
  });

  it("recalls this session's prompts first, Claude's or pi's", async () => {
    vi.mocked(claudePromptHistory).mockResolvedValue(["mine", "another session's"]);
    render(<Composer pane={pane} agent="claude" sessionPrompts={["mine"]} />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    await act(async () => {});
    up(box);
    expect(box.value).toBe("mine");
    up(box);
    expect(box.value).toBe("another session's");
  });

  it("gives a pi pane its session's prompts before Drover's for the folder", async () => {
    recordPrompt("devtuf/default/w1:p1", "sent from Drover");
    render(<Composer pane={pane} agent="pi" sessionPrompts={["typed in pi"]} />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    up(box);
    expect(box.value).toBe("typed in pi");
    up(box);
    expect(box.value).toBe("sent from Drover");
  });

  it("falls back to Drover's own history when Claude's cannot be read", async () => {
    vi.mocked(claudePromptHistory).mockRejectedValue({ code: "io", message: "no ssh" });
    recordPrompt("devtuf/default/w1:p1", "only in Drover");
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    await act(async () => {});
    up(box);
    expect(box.value).toBe("only in Drover");
  });

  it("does not ask a pi pane for Claude's history", async () => {
    render(<Composer pane={pane} agent="pi" />);
    await act(async () => {});
    expect(claudePromptHistory).not.toHaveBeenCalled();
  });

  it("recalls sent prompts with Up and returns the unsent draft with Down", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    await sendText(box, "fix the bug");
    await sendText(box, "run the tests");
    type(box, "half typed");
    up(box);
    expect(box.value).toBe("run the tests");
    up(box);
    expect(box.value).toBe("fix the bug");
    up(box);
    expect(box.value).toBe("fix the bug");
    down(box);
    expect(box.value).toBe("run the tests");
    down(box);
    expect(box.value).toBe("half typed");
  });

  it("gives the draft back on Escape", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    await sendText(box, "fix the bug");
    type(box, "draft");
    up(box);
    expect(box.value).toBe("fix the bug");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(box.value).toBe("draft");
  });

  it("leaves Up and Down to the caret inside multi-line text", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    await sendText(box, "fix the bug");
    type(box, "line one\nline two\nline three");
    box.setSelectionRange(12, 12);
    expect(up(box)).toBe(true);
    expect(box.value).toBe("line one\nline two\nline three");
    box.setSelectionRange(3, 3);
    expect(down(box)).toBe(true);
    expect(box.value).toBe("line one\nline two\nline three");
    // On the first line Up recalls; on the last, Down has nothing past the draft.
    expect(up(box)).toBe(false);
    expect(box.value).toBe("fix the bug");
  });

  it("keeps stepping back from a recalled multi-line prompt with the caret at its end", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    await sendText(box, "older");
    await sendText(box, "first\nsecond");
    up(box);
    expect(box.value).toBe("first\nsecond");
    box.setSelectionRange(box.value.length, box.value.length);
    up(box);
    expect(box.value).toBe("older");
  });

  it("starts again from the newest once a recalled prompt is edited", async () => {
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    await sendText(box, "one");
    await sendText(box, "two");
    up(box);
    up(box);
    type(box, "one more");
    box.setSelectionRange(0, 0);
    up(box);
    expect(box.value).toBe("two");
    down(box);
    expect(box.value).toBe("one more");
  });

  it("leaves Up to the completion list while it is open", async () => {
    recordPrompt("devtuf/default/w1:p1", "fix the bug");
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    type(box, "/c");
    await screen.findByRole("listbox");
    up(box);
    expect(box.value).toBe("/c");
  });

  it("leaves Up to the completion list while it is still loading", () => {
    vi.mocked(completeCommands).mockReset().mockReturnValue(new Promise(() => {}));
    recordPrompt("devtuf/default/w1:p1", "fix the bug");
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    type(box, "/c");
    expect(screen.getByRole("listbox")).toBeTruthy();
    up(box);
    expect(box.value).toBe("/c");
  });

  it("does not record a failed send", async () => {
    vi.mocked(herdrCall).mockRejectedValueOnce({ code: "timeout", message: "timed out" });
    render(<Composer pane={pane} agent="claude" />);
    const box = screen.getByRole<HTMLTextAreaElement>("textbox");
    await sendText(box, "lost");
    type(box, "");
    up(box);
    expect(box.value).toBe("");
  });

  it("shares the history between panes in the same folder", async () => {
    const panes = [
      { pane_id: "w1:p1", cwd: "/Users/me/app" },
      { pane_id: "w1:p2", cwd: "/Users/me/app" },
      { pane_id: "w1:p3", cwd: "/Users/me/other" },
    ];
    useApp.setState({
      machines: { devtuf: { id: "devtuf", sessions: [{ name: "default", workspaces: [{ workspace_id: "w1", tabs: [{ panes }] }] }] } as never },
    });
    const { unmount } = render(<Composer pane={pane} agent="claude" />);
    await sendText(screen.getByRole("textbox"), "fix the bug");
    unmount();
    const { unmount: unmount2 } = render(<Composer pane={{ ...pane, pane_id: "w1:p2" }} agent="claude" />);
    up(screen.getByRole("textbox"));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("fix the bug");
    unmount2();
    render(<Composer pane={{ ...pane, pane_id: "w1:p3" }} agent="claude" />);
    up(screen.getByRole("textbox"));
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("");
    useApp.setState({ machines: {} });
  });
});
