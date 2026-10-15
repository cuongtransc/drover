import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatItem } from "../lib/types";
import { pathResolver } from "./pathResolver";

const bash = (command: string): ChatItem => ({ kind: "tool_call", id: command, name: "Bash", input_summary: "", input: { command } });
const text = (markdown: string): ChatItem => ({ kind: "assistant_text", markdown });
const ctx = { root: "/r", home: "/Users/me" };

describe("pathResolver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("asks the machine once for every path named within the wait, each with its places", async () => {
    const msg = text("x");
    const items = [bash("cd /w/wt"), msg, bash("cd /w/later")];
    const ask = vi.fn(async (_m: string, groups: string[][]) => groups.map((g) => g[0]));
    const r = pathResolver("m1", () => items, ask);
    const a = r.resolve(msg, "src/a.ts", ctx);
    const b = r.resolve(msg, "~/notes/b.md", ctx);
    expect(ask).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask).toHaveBeenCalledWith("m1", [["/w/wt/src/a.ts", "/r/src/a.ts"], ["/Users/me/notes/b.md"]]);
    expect([await a, await b]).toEqual(["/w/wt/src/a.ts", "/Users/me/notes/b.md"]);
  });

  it("remembers each answer for its message, so a row shown again asks nothing", async () => {
    const msg = text("x");
    const ask = vi.fn(async (_m: string, groups: string[][]) => groups.map(() => null));
    const r = pathResolver("m1", () => [msg], ask);
    const first = r.resolve(msg, "src/a.ts", ctx);
    await vi.runAllTimersAsync();
    expect(await first).toBeNull();
    expect(r.known(msg, "src/a.ts")).toBeNull();
    const again = r.resolve(msg, "src/a.ts", ctx);
    await vi.runAllTimersAsync();
    expect(await again).toBeNull();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(r.known(text("other"), "src/a.ts")).toBe("pending");
  });

  it("answers undefined when the machine cannot say, and asks again next time", async () => {
    const msg = text("x");
    const ask = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(["/r/src/a.ts"]);
    const r = pathResolver("m1", () => [msg], ask);
    const p = r.resolve(msg, "src/a.ts", ctx);
    await vi.runAllTimersAsync();
    expect(await p).toBeUndefined();
    const q = r.resolve(msg, "src/a.ts", ctx);
    await vi.runAllTimersAsync();
    expect(await q).toBe("/r/src/a.ts");
  });

  it("splits a screen naming more places than one call takes", async () => {
    const items: ChatItem[] = Array.from({ length: 60 }, (_, i) => bash(`cd /w/d${i}`));
    const msgs = Array.from({ length: 30 }, (_, i) => text(`m${i}`));
    items.push(...msgs);
    const ask = vi.fn(async (_m: string, groups: string[][]) => groups.map(() => null));
    const r = pathResolver("m1", () => items, ask);
    msgs.forEach((m, i) => void r.resolve(m, `src/f${i}.ts`, ctx));
    await vi.runAllTimersAsync();
    const sizes = ask.mock.calls.map(([, groups]) => groups.flat().length);
    expect(sizes.every((n) => n <= 1024)).toBe(true);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(30 * 61);
  });
});
