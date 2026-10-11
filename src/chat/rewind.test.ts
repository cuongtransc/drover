/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { editLast, parseRewind, runRewind, sameMessage, useComposerFill, useRewind } from "./rewind";

// Screens read through herdr `pane.read --source visible --format text` from claude 2.1.296, 2026-10-12.
const screen = (name: string) => readFileSync(join(process.cwd(), "src/chat/rewind-fixtures", `${name}.txt`), "utf8");

const WRITE = "Use the Write tool to create the file note.txt containing the single word hello. Then reply DONE.";
const BANANA = "Remember BANANA. Reply OK.";

describe("parseRewind", () => {
  it("reads the picker, with (current) selected when it opens", () => {
    expect(parseRewind(screen("picker-current"))).toEqual({ kind: "picker", selected: "(current)", changes: null });
  });

  it("reads the selected message and its code changes", () => {
    expect(parseRewind(screen("picker-code"))).toEqual({ kind: "picker", selected: WRITE, changes: "note.txt +1" });
    expect(parseRewind(screen("picker-nocode"))).toEqual({ kind: "picker", selected: BANANA, changes: "No code changes" });
  });

  it("reads the confirm step: the message, what happens to the code, the options", () => {
    expect(parseRewind(screen("confirm-nocode"))).toEqual({
      kind: "confirm",
      message: BANANA,
      code: "The code will be unchanged.",
      options: ["Restore conversation", "Summarize from here", "Summarize up to here", "Never mind"],
      selected: 0,
    });
    expect(parseRewind(screen("confirm-code"))).toMatchObject({
      kind: "confirm",
      message: WRITE,
      code: "The code will be restored -1 in note.txt.",
      options: ["Restore code and conversation", "Restore conversation", "Restore code", "Summarize from here", "Summarize up to here"],
      selected: 0,
    });
    expect(parseRewind(screen("confirm-code-down"))).toMatchObject({ selected: 1, code: "The code will be unchanged." });
  });

  it("is null once the Rewind screen is closed", () => {
    expect(parseRewind(screen("restored"))).toBeNull();
    expect(parseRewind(screen("interrupted"))).toBeNull();
  });
});

describe("sameMessage", () => {
  it("matches the first line, and a line Claude cut short", () => {
    expect(sameMessage(BANANA, BANANA)).toBe(true);
    expect(sameMessage("fix the bug", "fix the bug\nin parser.rs")).toBe(true);
    expect(sameMessage("Use the Write tool to cre…", WRITE)).toBe(true);
    expect(sameMessage("(current)", BANANA)).toBe(false);
    expect(sameMessage("Remember APPLE.", BANANA)).toBe(false);
  });
});

/** A fake pane: `screens` maps the keys sent so far (joined) to what the screen shows. */
function fakePane(script: (keys: string[]) => string) {
  const keys: string[] = [];
  const call = vi.fn(async (method: string, params: unknown) => {
    const p = params as { keys?: string[] };
    if (method === "pane.send_keys") {
      keys.push(...(p.keys ?? []));
      return {};
    }
    if (method === "pane.read") return { text: script(keys) };
    throw new Error(method);
  });
  return { call, keys };
}

const fast = { pollMs: 0, stepMs: 30, idleMs: 30 };
const idle = () => "idle" as const;

/** Claude as measured: Esc Esc opens the picker on (current), Up selects the last message, Enter confirms. */
function claude({ code }: { code: boolean }) {
  return (keys: string[]) => {
    const k = keys.join(" ");
    if (k === "esc esc") return screen("picker-current");
    if (k === "esc esc up") return screen(code ? "picker-code" : "picker-nocode");
    if (k === "esc esc up enter") return screen(code ? "confirm-code" : "confirm-nocode");
    if (code && k === "esc esc up enter down") return screen("confirm-code-down");
    if (/enter (down )?enter$/.test(k)) return code ? screen("restored").replace(BANANA, WRITE) : screen("restored");
    if (k.endsWith("ctrl+u")) return screen("cleared");
    return screen("interrupted");
  };
}

describe("runRewind", () => {
  it("rewinds to before the last message and clears what Claude put back in its box", async () => {
    const { call, keys } = fakePane(claude({ code: false }));
    await runRewind(call, "w1:p1", BANANA, { status: idle, choose: vi.fn(), timing: fast });
    expect(keys).toEqual(["esc", "esc", "up", "enter", "enter", "ctrl+u"]);
  });

  it("asks what to do with the code when the message changed files, and does it", async () => {
    const { call, keys } = fakePane(claude({ code: true }));
    const choose = vi.fn().mockResolvedValue("conversation");
    await runRewind(call, "w1:p1", WRITE, { status: idle, choose, timing: fast });
    expect(choose).toHaveBeenCalledWith("The code will be restored -1 in note.txt.");
    expect(keys).toEqual(["esc", "esc", "up", "enter", "down", "enter", "ctrl+u"]);
  });

  it("restores the code too when asked to", async () => {
    const { call, keys } = fakePane(claude({ code: true }));
    await runRewind(call, "w1:p1", WRITE, { status: idle, choose: vi.fn().mockResolvedValue("both"), timing: fast });
    expect(keys).toEqual(["esc", "esc", "up", "enter", "enter", "ctrl+u"]);
  });

  it("backs out of Claude's screens when the choice is cancelled", async () => {
    const { call, keys } = fakePane(claude({ code: true }));
    await expect(runRewind(call, "w1:p1", WRITE, { status: idle, choose: vi.fn().mockResolvedValue(null), timing: fast })).rejects.toThrow("Cancelled");
    // Esc leaves the confirm step for the picker, a second closes the picker.
    expect(keys).toEqual(["esc", "esc", "up", "enter", "esc", "esc"]);
  });

  it("refuses, closing the picker, when Claude's last message is another one", async () => {
    const { call, keys } = fakePane(claude({ code: false }));
    await expect(runRewind(call, "w1:p1", "something else", { status: idle, choose: vi.fn(), timing: fast })).rejects.toThrow(/not the last message/);
    expect(keys).toEqual(["esc", "esc", "up", "esc"]);
  });

  it("stops a working Claude first, then rewinds once it is idle", async () => {
    const { call, keys } = fakePane(claude({ code: false }));
    let state: "working" | "idle" = "working";
    const status = () => state;
    const run = runRewind(call, "w1:p1", BANANA, { status, choose: vi.fn(), timing: { ...fast, idleMs: 2000 } });
    await new Promise((r) => setTimeout(r, 20));
    expect(keys).toEqual(["esc"]);
    state = "idle";
    keys.length = 0;
    await run;
    expect(keys).toEqual(["esc", "esc", "up", "enter", "enter", "ctrl+u"]);
  });

  it("fails, sending nothing more, when the picker does not open", async () => {
    const { call, keys } = fakePane(() => screen("interrupted"));
    await expect(runRewind(call, "w1:p1", BANANA, { status: idle, choose: vi.fn(), timing: fast })).rejects.toThrow(/did not open/);
    expect(keys).toEqual(["esc", "esc"]);
  });
});

describe("editLast", () => {
  const pane = { machine_id: "local", session: "s", pane_id: "w1:p1" };
  const KEY = "local/s/w1:p1";
  afterEach(() => useRewind.setState({ edits: {} }));

  it("rewinds, then hands the message to the Composer", async () => {
    const { call } = fakePane(claude({ code: false }));
    const done = editLast(pane, BANANA, call, idle, fast);
    expect(useRewind.getState().edits[KEY]).toMatchObject({ phase: "running" });
    await done;
    expect(useRewind.getState().edits[KEY]).toBeUndefined();
    expect(useComposerFill.getState().fill[KEY]).toBe(BANANA);
  });

  it("waits on the user's choice when the message changed files", async () => {
    const { call, keys } = fakePane(claude({ code: true }));
    const done = editLast(pane, WRITE, call, idle, fast);
    await vi.waitFor(() => expect(useRewind.getState().edits[KEY]).toMatchObject({ phase: "choose", code: "The code will be restored -1 in note.txt." }));
    useRewind.getState().edits[KEY].answer?.("conversation");
    await done;
    expect(keys).toContain("down");
    expect(useComposerFill.getState().fill[KEY]).toBe(WRITE);
  });

  it("keeps the error, and fills nothing", async () => {
    useComposerFill.setState({ fill: {} });
    const { call } = fakePane(() => screen("interrupted"));
    await editLast(pane, BANANA, call, idle, fast);
    expect(useRewind.getState().edits[KEY]).toMatchObject({ phase: "failed", error: expect.stringMatching(/did not open/) });
    expect(useComposerFill.getState().fill[KEY]).toBeUndefined();
  });

  it("a cancelled choice ends quietly", async () => {
    const { call } = fakePane(claude({ code: true }));
    const done = editLast(pane, WRITE, call, idle, fast);
    await vi.waitFor(() => expect(useRewind.getState().edits[KEY]?.phase).toBe("choose"));
    useRewind.getState().edits[KEY].answer?.(null);
    await done;
    expect(useRewind.getState().edits[KEY]).toBeUndefined();
  });
});
