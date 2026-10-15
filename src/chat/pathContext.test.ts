import { describe, expect, it, vi } from "vitest";
import type { ChatItem } from "../lib/types";
import { chatPaths } from "./pathContext";

const bash = (command: string): ChatItem => ({ kind: "tool_call", id: command, name: "Bash", input_summary: "", input: { command } });
const text = (markdown: string): ChatItem => ({ kind: "assistant_text", markdown });

describe("chatPaths", () => {
  it("reads the chat only when asked, and only what came before the message", () => {
    const msg = text("`a/b.ts`");
    const items = [bash("cd /one"), msg, bash("cd /two")];
    const get = vi.fn(() => items);
    const paths = chatPaths(get);
    expect(get).not.toHaveBeenCalled();
    expect(paths.hintsBefore(msg)).toEqual({ hints: [{ at: 0, kind: "dir", path: "/one" }], upTo: 1 });
  });

  it("sees items added since it was made, and takes all of them for a message it does not hold", () => {
    const items: ChatItem[] = [bash("cd /one")];
    const paths = chatPaths(() => items);
    items.push(bash("cd /two"));
    expect(paths.hintsBefore(null).hints.map((h) => h.path)).toEqual(["/one", "/two"]);
    expect(paths.hintsBefore(text("not in this chat")).upTo).toBe(2);
  });
});
