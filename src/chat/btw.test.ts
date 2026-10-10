import { afterEach, describe, expect, it, vi } from "vitest";
import { btwQuestion, closeBtw, mergeScroll, parseBtwScreen, runBtw, useBtw } from "./btw";

// Screens read through herdr `pane.read --source visible --format text` from claude 2.1.295, 2026-10-10.
const BORDER = "▔".repeat(98) + " ◐ medium · /effort ▔";
const PROMPT = ["─".repeat(80), "❯", "─".repeat(80), "  ⏵⏵ auto mode on (shift+tab to cycle)"];

const ANSWERING = [
  "⏺ OK",
  BORDER,
  "",
  "    /btw what is my favourite colour?",
  "",
  "      · Answering…",
  "",
  "    Esc to close",
  ...PROMPT,
].join("\n");

const ANSWERED = [
  "⏺ OK",
  BORDER,
  "",
  "    /btw what is my favourite colour?",
  "",
  "      Teal. You told me that at the start of this conversation.",
  "",
  "    ↑/↓ to scroll · c to copy · f to fork · Esc to close",
  ...PROMPT,
].join("\n");

const MARKDOWN = [
  BORDER,
  "",
  "    /btw give me a markdown answer",
  "",
  "      Formatting check",
  "",
  "      - Heading and a list.",
  "",
  "      echo \"markdown check\"",
  "",
  "      ┌─────────┬───────┐",
  "      │ Bullets │ 3     │",
  "      └─────────┴───────┘",
  "",
  "    ↑/↓ to scroll · c to copy · f to fork · Esc to close",
  ...PROMPT,
].join("\n");

/** Questions asked before stay listed (cut to one line); the answer is to the last one. */
const window = (from: number, to: number) =>
  [
    BORDER,
    "    /btw this is a deliberately long question that goes on and on so that it wraps across …",
    "    /btw list the numbers 1 to 70, one per line, nothing else",
    ...Array.from({ length: to - from + 1 }, (_, i) => `      ${from + i}`),
    "    ⇧←/→ to browse · c to copy · f to fork · x to clear history · Esc to close",
    ...PROMPT,
  ].join("\n");

/** The only question so far: the panel pads the answer with a blank line above and below. */
const lone = (from: number, to: number) =>
  [
    BORDER,
    "",
    "    /btw list the numbers 1 to 70, one per line, nothing else",
    "",
    ...Array.from({ length: to - from + 1 }, (_, i) => `      ${from + i}`),
    "",
    "    ↑/↓ to scroll · c to copy · f to fork · Esc to close",
    ...PROMPT,
  ].join("\n");

describe("btwQuestion", () => {
  it("takes the question after /btw", () => {
    expect(btwQuestion("/btw what changed?")).toBe("what changed?");
    expect(btwQuestion("  /btw  why\nnot  ")).toBe("why\nnot");
  });

  it("is null for anything else, and for a bare /btw (Claude only prints its usage)", () => {
    expect(btwQuestion("/btw")).toBeNull();
    expect(btwQuestion("/btw   ")).toBeNull();
    expect(btwQuestion("/btwx hi")).toBeNull();
    expect(btwQuestion("say /btw hi")).toBeNull();
  });
});

describe("parseBtwScreen", () => {
  it("sees the panel still answering", () => {
    expect(parseBtwScreen(ANSWERING)).toEqual({ state: "answering", asked: "what is my favourite colour?" });
  });

  it("reads the answer, without the panel's indent", () => {
    expect(parseBtwScreen(ANSWERED)).toEqual({
      state: "answered",
      asked: "what is my favourite colour?",
      lines: ["", "Teal. You told me that at the start of this conversation.", ""],
    });
  });

  it("keeps the rendered answer's own lines and indent", () => {
    const s = parseBtwScreen(MARKDOWN);
    expect(s?.state === "answered" && s.lines.join("\n").trim()).toBe(
      ["Formatting check", "", "- Heading and a list.", "", 'echo "markdown check"', "", "┌─────────┬───────┐", "│ Bullets │ 3     │", "└─────────┴───────┘"].join("\n"),
    );
  });

  it("answers the last question when earlier ones are listed", () => {
    expect(parseBtwScreen(window(1, 3))).toEqual({
      state: "answered",
      asked: "list the numbers 1 to 70, one per line, nothing else",
      lines: ["1", "2", "3"],
    });
  });

  it("is null without the panel", () => {
    expect(parseBtwScreen(["⏺ OK", ...PROMPT].join("\n"))).toBeNull();
    expect(parseBtwScreen("")).toBeNull();
  });
});

describe("mergeScroll", () => {
  it("adds the lines a scroll brought in", () => {
    expect(mergeScroll(["1", "2", "3", "4"], ["1", "2", "3", "4"], ["4", "5", "6", "7"])).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("adds a short last step", () => {
    expect(mergeScroll(["1", "2", "3", "4", "5"], ["2", "3", "4", "5"], ["3", "4", "5", "6"])).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("is null when the scroll did not move", () => {
    expect(mergeScroll(["1", "2"], ["1", "2"], ["1", "2"])).toBeNull();
  });

  it("does not join windows on a blank line alone", () => {
    expect(mergeScroll(["1", "2", ""], ["1", "2", ""], ["", "3", "4"])).toBeNull();
  });

  it("is null when the windows do not overlap (the screen changed under it)", () => {
    expect(mergeScroll(["1", "2"], ["1", "2"], ["x", "y"])).toBeNull();
  });
});

/** A fake pane: each read returns the next screen; `down` moves a window over 1..total. */
function fakePane(screens: string[], scroll?: { total: number; height: number; step: number; draw?: typeof window; lag?: number }) {
  let top = 1;
  let shown = 1;
  let stale = 0;
  const keys: string[] = [];
  const call = vi.fn(async (method: string, params: unknown) => {
    const p = params as { keys?: string[] };
    if (method === "pane.send_keys") {
      keys.push(...(p.keys ?? []));
      if (scroll && p.keys?.[0] === "down") {
        top = Math.min(top + scroll.step, scroll.total - scroll.height + 1);
        // the terminal redraws a few reads later
        stale = scroll.lag ?? 0;
      }
      return {};
    }
    if (method === "pane.read") {
      if (screens.length > 1) return { text: screens.shift() };
      if (scroll) {
        if (stale > 0) stale--;
        else shown = top;
        return { text: (scroll.draw ?? window)(shown, shown + scroll.height - 1) };
      }
      return { text: screens[0] };
    }
    throw new Error(method);
  });
  return { call, keys };
}

const fast = { pollMs: 0, openMs: 50, answerMs: 50, scrollMs: 0 };

describe("runBtw", () => {
  it("waits for the answer, then closes the panel so the agent is not held up", async () => {
    const { call, keys } = fakePane([ANSWERING, ANSWERING, ANSWERED]);
    const answer = await runBtw(call, "w1:p1", "what is my favourite colour?", fast);
    expect(answer).toBe("Teal. You told me that at the start of this conversation.");
    // one Down tells a short answer from a long one; Esc closes the panel
    expect(keys).toEqual(["down", "esc"]);
  });

  it("scrolls a long answer to its end", async () => {
    const { call, keys } = fakePane([], { total: 70, height: 25, step: 3 });
    const answer = await runBtw(call, "w1:p1", "list the numbers 1 to 70, one per line, nothing else", fast);
    expect(answer).toBe(Array.from({ length: 70 }, (_, i) => String(i + 1)).join("\n"));
    expect(keys[keys.length - 1]).toBe("esc");
  });

  it("scrolls a long answer to its end when the panel pads it with blank lines", async () => {
    const { call } = fakePane([], { total: 70, height: 26, step: 3, draw: lone });
    const answer = await runBtw(call, "w1:p1", "list the numbers 1 to 70, one per line, nothing else", fast);
    expect(answer).toBe(Array.from({ length: 70 }, (_, i) => String(i + 1)).join("\n"));
  });

  it("waits for the terminal to redraw after each scroll", async () => {
    const { call } = fakePane([], { total: 70, height: 25, step: 3, lag: 2 });
    const answer = await runBtw(call, "w1:p1", "list the numbers 1 to 70, one per line, nothing else", { ...fast, scrollMs: 500 });
    expect(answer.split("\n")).toHaveLength(70);
  });

  it("matches a question the panel cut short", async () => {
    const cut = ANSWERED.replace("what is my favourite colour?", "what is my fav…");
    const { call } = fakePane([cut]);
    await expect(runBtw(call, "w1:p1", "what is my favourite colour?", fast)).resolves.toContain("Teal");
  });

  it("fails, leaving the screen alone, when no panel opens", async () => {
    const { call, keys } = fakePane([["⏺ OK", ...PROMPT].join("\n")]);
    await expect(runBtw(call, "w1:p1", "q", fast)).rejects.toThrow(/did not open/);
    expect(keys).toEqual([]);
  });

  it("fails when the panel shows another question", async () => {
    const { call, keys } = fakePane([ANSWERED]);
    await expect(runBtw(call, "w1:p1", "something else", fast)).rejects.toThrow(/did not open/);
    expect(keys).toEqual([]);
  });

  it("fails when the answer does not come", async () => {
    const { call } = fakePane([ANSWERING]);
    await expect(runBtw(call, "w1:p1", "what is my favourite colour?", fast)).rejects.toThrow(/No answer/);
  });

  it("stops when cancelled", async () => {
    const { call, keys } = fakePane([ANSWERING]);
    const signal = { cancelled: false };
    const run = runBtw(call, "w1:p1", "what is my favourite colour?", { ...fast, answerMs: 5000 }, signal);
    await new Promise((r) => setTimeout(r, 20));
    signal.cancelled = true;
    await expect(run).rejects.toThrow(/Cancelled/);
    expect(keys).toEqual([]);
  });
});

describe("useBtw", () => {
  afterEach(() => useBtw.setState({ asides: {}, history: {} }));
  const pane = { machine_id: "local", session: "s", pane_id: "w1:p1" };

  it("holds the answer per pane", async () => {
    const { call } = fakePane([ANSWERED]);
    const done = useBtw.getState().ask(pane, "what is my favourite colour?", call, fast);
    expect(useBtw.getState().asides["local/s/w1:p1"]).toMatchObject({ question: "what is my favourite colour?", phase: "asking" });
    await done;
    expect(useBtw.getState().asides["local/s/w1:p1"]).toMatchObject({ phase: "done", answer: expect.stringContaining("Teal") });
  });

  it("keeps earlier answers of the pane as a thread when a new question starts", async () => {
    await useBtw.getState().ask(pane, "what is my favourite colour?", fakePane([ANSWERED]).call, fast);
    const next = useBtw.getState().ask(pane, "why?", fakePane([ANSWERING]).call, { ...fast, openMs: 5000 });
    expect(useBtw.getState().history["local/s/w1:p1"]).toEqual([
      expect.objectContaining({ question: "what is my favourite colour?", phase: "done", answer: expect.stringContaining("Teal") }),
    ]);
    expect(useBtw.getState().asides["local/s/w1:p1"]).toMatchObject({ question: "why?", phase: "asking" });
    await closeBtw(pane, vi.fn().mockResolvedValue({}));
    await next;
  });

  it("closing drops the whole thread", async () => {
    await useBtw.getState().ask(pane, "what is my favourite colour?", fakePane([ANSWERED]).call, fast);
    await useBtw.getState().ask(pane, "what is my favourite colour?", fakePane([ANSWERED]).call, fast);
    expect(useBtw.getState().history["local/s/w1:p1"]).toHaveLength(1);
    await closeBtw(pane, vi.fn());
    expect(useBtw.getState().history["local/s/w1:p1"]).toBeUndefined();
    expect(useBtw.getState().asides["local/s/w1:p1"]).toBeUndefined();
  });

  it("keeps the error", async () => {
    const { call } = fakePane([""]);
    await useBtw.getState().ask(pane, "q", call, fast);
    expect(useBtw.getState().asides["local/s/w1:p1"]).toMatchObject({ phase: "failed", error: expect.stringMatching(/did not open/) });
  });

  it("closing while it answers cancels it in Claude with Esc", async () => {
    const { call, keys } = fakePane([ANSWERING]);
    const done = useBtw.getState().ask(pane, "what is my favourite colour?", call, { ...fast, answerMs: 5000 });
    await new Promise((r) => setTimeout(r, 20));
    await closeBtw(pane, call);
    await done;
    expect(useBtw.getState().asides["local/s/w1:p1"]).toBeUndefined();
    expect(keys).toEqual(["esc"]);
  });

  it("closing while it scrolls the answer closes the panel once", async () => {
    const { call, keys } = fakePane([], { total: 70, height: 25, step: 3 });
    const slow = vi.fn(async (m: string, p: unknown) => (await new Promise((r) => setTimeout(r, 2)), call(m, p)));
    const done = useBtw.getState().ask(pane, "list the numbers 1 to 70, one per line, nothing else", slow, fast);
    while (!keys.includes("down")) await new Promise((r) => setTimeout(r, 1));
    await closeBtw(pane, slow);
    await done;
    // a second Esc on Claude's prompt would open its rewind menu
    expect(keys.filter((k) => k === "esc")).toEqual(["esc"]);
    expect(keys.filter((k) => k === "down").length).toBeLessThan(15);
  });

  it("closing an answered one sends nothing", async () => {
    const { call, keys } = fakePane([ANSWERED]);
    await useBtw.getState().ask(pane, "what is my favourite colour?", call, fast);
    keys.length = 0;
    await closeBtw(pane, call);
    expect(keys).toEqual([]);
    expect(useBtw.getState().asides["local/s/w1:p1"]).toBeUndefined();
  });
});
