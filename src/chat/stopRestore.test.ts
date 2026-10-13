import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { inputBox, restoredPrompt, takeBackStopped } from "./stopRestore";

// Claude Code 2.1.296 read by herdr with ANSI, 2 s after Esc stopped a turn that had not answered yet.
const screen = (name: string) => readFileSync(join(process.cwd(), "src/chat/stop-fixtures", `${name}.ansi`), "utf8");
const RULE = "\u001b[0m\u001b[38;2;138;138;138m" + "─".repeat(60) + "\u001b[0m";

describe("inputBox", () => {
  it("reads the prompt Claude put back in its input box, every line of it", () => {
    expect(inputBox(screen("short"))).toBe("short one run sleep 60");
    expect(inputBox(screen("multi"))).toBe("MULTI line one\nline two");
    expect(inputBox(screen("pasted"))).toBe("[Pasted text #4]");
  });

  it("finds nothing in an empty box, nor in Claude's grey suggestion", () => {
    expect(inputBox(screen("empty"))).toBeNull();
    expect(inputBox(["● done", RULE, "❯ \u001b[2mrun the tests again\u001b[0m", RULE].join("\r\n"))).toBeNull();
    expect(inputBox("❯ loose text")).toBeNull();
  });
});

describe("restoredPrompt", () => {
  it("is the prompt Drover sent when the box shows it, or Claude's placeholder for its long paste", () => {
    expect(restoredPrompt("short one", "short one")).toBe("short one");
    expect(restoredPrompt("MULTI line one\nline two", "MULTI line one\nline two")).toBe("MULTI line one\nline two");
    const long = "x ".repeat(500);
    expect(restoredPrompt("[Pasted text #4]", long)).toBe(long);
    expect(restoredPrompt("[Pasted text #2 +12 lines]", long)).toBe(long);
  });

  it("is the box's own text for a prompt typed in the terminal", () => {
    expect(restoredPrompt("typed in the terminal", "sent earlier")).toBe("typed in the terminal");
    expect(restoredPrompt("typed in the terminal", undefined)).toBe("typed in the terminal");
  });

  it("is nothing when the box holds a paste or an image Drover cannot put back", () => {
    expect(restoredPrompt("[Pasted text #4]", undefined)).toBeNull();
    expect(restoredPrompt("[Pasted text #4]", "a short prompt")).toBeNull();
    expect(restoredPrompt("look at [Image #1]", "sent earlier")).toBeNull();
  });
});

describe("takeBackStopped", () => {
  const timing = { pollMs: 1, waitMs: 50 };
  const fake = (screens: string[]) => {
    const keys: string[][] = [];
    const call = vi.fn(async (method: string, params: unknown) => {
      if (method === "pane.read") return { text: screens.length > 1 ? screens.shift() : screens[0] };
      keys.push((params as { keys: string[] }).keys);
      if ((params as { keys: string[] }).keys[0] === "ctrl+c") screens.splice(0, screens.length, screen("empty"));
      return {};
    });
    return { call, keys };
  };

  it("empties Claude's box with one Ctrl+C and hands back the prompt", async () => {
    const { call, keys } = fake([screen("empty"), screen("short")]);
    expect(await takeBackStopped(call, "w1:p1", "short one run sleep 60", undefined, timing)).toBe("short one run sleep 60");
    expect(keys).toEqual([["ctrl+c"]]);
    expect(call).toHaveBeenCalledWith("pane.read", { pane_id: "w1:p1", source: "visible", format: "ansi", strip_ansi: false });
  });

  it("leaves Claude alone when the box stays empty: the turn had answered, and Claude kept nothing", async () => {
    const { call, keys } = fake([screen("empty")]);
    expect(await takeBackStopped(call, "w1:p1", "short one run sleep 60", undefined, timing)).toBeNull();
    expect(keys).toEqual([]);
  });

  it("leaves Claude's box as it is when Drover cannot put its text back", async () => {
    const { call, keys } = fake([screen("pasted")]);
    expect(await takeBackStopped(call, "w1:p1", undefined, undefined, timing)).toBeNull();
    expect(keys).toEqual([]);
  });

  it("hands nothing back when Ctrl+C did not empty the box, so the prompt is not there twice", async () => {
    const call = vi.fn(async (method: string) => (method === "pane.read" ? { text: screen("short") } : {}));
    expect(await takeBackStopped(call, "w1:p1", "short one run sleep 60", undefined, timing)).toBeNull();
  });

  it("stops reading, and leaves the box alone, once cancelled", async () => {
    const { call, keys } = fake([screen("empty"), screen("short")]);
    // Cancelled while it waits between reads (the Composer unmounted): no read after that.
    let asked = 0;
    const cancelled = () => ++asked > 1;
    expect(await takeBackStopped(call, "w1:p1", "short one run sleep 60", cancelled, timing)).toBeNull();
    expect(call.mock.calls.filter((c) => c[0] === "pane.read")).toHaveLength(1);
    expect(keys).toEqual([]);
  });
});
