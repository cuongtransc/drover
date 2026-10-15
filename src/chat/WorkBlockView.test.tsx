import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatItem } from "../lib/types";
import { WorkBlockView } from "./WorkBlockView";
import type { ToolResult, WorkBlock } from "./workBlocks";

const block: WorkBlock = {
  id: "a",
  items: [
    { kind: "assistant_text", markdown: "Checking the files." },
    { kind: "tool_call", id: "a", name: "Bash", input_summary: "ls", input: { command: "ls" } },
  ],
  start: "2026-10-03T00:00:00Z",
  end: "2026-10-03T00:00:07Z",
};
const results = new Map<string, ToolResult>([["a", { kind: "tool_result", call_id: "a", output: "a.txt", is_error: false }]]);

describe("WorkBlockView", () => {
  it("folds to its header", () => {
    render(<WorkBlockView block={block} results={results} open={false} onToggle={() => {}} live={false} />);
    expect(screen.getByRole("button", { name: /Worked for 7s · 1 command/ })).toBeTruthy();
    expect(screen.queryByText("Checking the files.")).toBeNull();
  });

  it("asks to toggle when its header is clicked", () => {
    const onToggle = vi.fn();
    render(<WorkBlockView block={block} results={results} open={false} onToggle={onToggle} live={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Worked/ }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith("a", false);
  });

  it("shows narration and tool rows when open", () => {
    render(<WorkBlockView block={block} results={results} open onToggle={() => {}} live={false} />);
    expect(screen.getByText("Checking the files.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Bash/ }));
    expect(screen.getByText("a.txt")).toBeTruthy();
  });

  it("shows only its summary while the agent runs: the working line below carries the spinner and clock", () => {
    render(<WorkBlockView block={{ ...block, end: null }} results={results} open={false} onToggle={() => {}} live />);
    const head = screen.getByRole("button", { name: /^1 command$/ });
    expect(head.querySelector(".spin")).toBeNull();
    expect(head.textContent).not.toContain("Working");
  });

  it("spins on the call still waiting for its result while the agent runs", () => {
    const running: WorkBlock = { ...block, items: [...block.items, { kind: "tool_call", id: "b", name: "Bash", input_summary: "pnpm build", input: { command: "pnpm build" } }], end: null };
    const { rerender } = render(<WorkBlockView block={running} results={results} open onToggle={() => {}} live />);
    expect(screen.getByRole("button", { name: /pnpm build/ }).querySelector(".spin")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Bash\s*·\s*ls/ }).querySelector(".spin")).toBeNull();
    // A turn that ended with a call unanswered (interrupted) is not running.
    rerender(<WorkBlockView block={running} results={results} open onToggle={() => {}} live={false} />);
    expect(screen.getByRole("button", { name: /pnpm build/ }).querySelector(".spin")).toBeNull();
    // Blocked on the user (a permission prompt): live, but the call is not running.
    rerender(<WorkBlockView block={running} results={results} open onToggle={() => {}} live working={false} />);
    expect(screen.getByRole("button", { name: /pnpm build/ }).querySelector(".spin")).toBeNull();
  });

  describe("thinking", () => {
    const thought = "Linking to /wallets/<id>/ is enough; no new detail page.";
    const withThinking: WorkBlock = {
      ...block,
      items: [{ kind: "thinking", text: `${thought}\n\n` }, { kind: "thinking", text: "  \n" }, ...block.items],
    };

    it("shows its text under the folded header, without the narration", () => {
      const { container } = render(<WorkBlockView block={withThinking} results={results} open={false} onToggle={() => {}} live={false} />);
      // Trimmed: the line keeps newlines inside the text, so a trailing one would add a blank line.
      expect(container.querySelector(".chat-work-thinking span")?.textContent).toBe(thought);
      expect(screen.queryByText("Checking the files.")).toBeNull();
      // A thinking block with no text of its own has no line.
      expect(container.querySelectorAll(".chat-work-thinking")).toHaveLength(1);
    });

    it("keeps its text shown once, in its place, when the block opens", () => {
      render(<WorkBlockView block={withThinking} results={results} open onToggle={() => {}} live={false} />);
      expect(screen.getAllByText(thought)).toHaveLength(1);
      expect(screen.getByText(thought).closest("details")?.open).toBe(true);
    });

    it("adds no lines when the turn has none", () => {
      const { container } = render(<WorkBlockView block={block} results={results} open={false} onToggle={() => {}} live={false} />);
      expect(container.querySelector(".chat-work-thinking")).toBeNull();
    });
  });

  it("reads Worked when the span is unknown", () => {
    const untimed: WorkBlock = { ...block, start: null };
    render(<WorkBlockView block={untimed} results={results} open={false} onToggle={() => {}} live={false} />);
    expect(screen.getByRole("button", { name: /^Worked · 1 command$/ })).toBeTruthy();
  });
});

describe("TodoWrite in a work block", () => {
  const todo: ChatItem = {
    kind: "tool_call", id: "t", name: "TodoWrite", input_summary: "",
    input: { todos: [{ content: "Write tests", status: "completed" }, { content: "Implement", status: "in_progress" }, { content: "Ship", status: "pending" }] },
  };
  const ok = new Map<string, ToolResult>([["t", { kind: "tool_result", call_id: "t", output: "Todos have been modified successfully.", is_error: false }]]);

  it("summarizes the list and opens to a checklist instead of the raw result", () => {
    render(<WorkBlockView block={{ ...block, items: [todo] }} results={ok} open onToggle={() => {}} live={false} />);
    fireEvent.click(screen.getByRole("button", { name: /TodoWrite\s*·\s*1\/3 done/ }));
    expect(screen.getByRole("list", { name: "Todos" })).toBeTruthy();
    expect(screen.getByText("Implement").closest("li")?.className).toContain("in_progress");
    expect(screen.queryByText("Todos have been modified successfully.")).toBeNull();
  });

  it("scrolls the focused call's card into view once open, then reports it handled", () => {
    const scroll = vi.fn();
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      const handled = vi.fn();
      const { rerender } = render(<WorkBlockView block={block} results={results} open={false} onToggle={() => {}} live={false} focusCall="a" onFocusHandled={handled} />);
      expect(scroll).not.toHaveBeenCalled();
      rerender(<WorkBlockView block={block} results={results} open onToggle={() => {}} live={false} focusCall="a" onFocusHandled={handled} />);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect((scroll.mock.contexts[0] as HTMLElement).dataset.call).toBe("a");
      expect(handled).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = orig;
    }
  });
});
