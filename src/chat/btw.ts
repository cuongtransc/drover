import { create } from "zustand";
import { paneKey, type PaneRef } from "../lib/types";

// Claude Code's `/btw <question>` answers from the whole conversation, without tools and
// without interrupting the turn, in a panel drawn over its terminal. The question and the answer
// never reach the transcript, so the Chat lens reads the answer off the screen, then closes the
// panel: while it is open, Claude holds back the turn's own updates.
// Screen layout checked against claude 2.1.295, 2026-10-10.

type Call = (method: string, params: unknown) => Promise<unknown>;

/** The question of a `/btw <question>` prompt, or null (a bare `/btw` only prints its usage). */
export function btwQuestion(text: string): string | null {
  const m = /^\s*\/btw\s+([\s\S]*\S)\s*$/.exec(text);
  return m ? m[1] : null;
}

function lastIndex(lines: string[], test: (l: string) => boolean): number {
  for (let i = lines.length - 1; i >= 0; i--) if (test(lines[i])) return i;
  return -1;
}

export type BtwScreen =
  | { state: "answering"; asked: string }
  | { state: "answered"; asked: string; lines: string[] };

/**
 * The `/btw` panel on a screen, or null. It sits between a `▔` border and a footer ending in
 * "Esc to close"; questions asked before are listed above the last one, which is the one answered.
 * The answer is rendered (no markdown left), indented by six spaces.
 */
export function parseBtwScreen(screen: string): BtwScreen | null {
  const lines = screen.split("\n");
  const footer = lastIndex(lines, (l) => l.trimEnd().endsWith("Esc to close"));
  if (footer < 0) return null;
  const top = lastIndex(lines.slice(0, footer), (l) => l.trimStart().startsWith("▔▔▔"));
  if (top < 0) return null;
  const body = lines.slice(top + 1, footer);
  const qi = lastIndex(body, (l) => /^ {4}\/btw /.test(l));
  if (qi < 0) return null;
  const asked = body[qi].slice("    /btw ".length).trim();
  const rest = body.slice(qi + 1);
  if (rest.some((l) => /Answering…\s*$/.test(l)) || !/to copy|Copied/.test(lines[footer])) return { state: "answering", asked };
  return { state: "answered", asked, lines: rest.map((l) => l.replace(/^ {0,6}/, "").trimEnd()) };
}

/**
 * `acc` (the answer so far, ending with `prev`) with what scrolling to `next` brought in, or
 * null when it did not move or the two windows do not overlap. The overlap must hold some text:
 * blank lines alone match anywhere.
 */
export function mergeScroll(acc: string[], prev: string[], next: string[]): string[] | null {
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);
  if (same(prev, next)) return null;
  for (let m = Math.min(prev.length, next.length) - 1; m > 0; m--) {
    const overlap = next.slice(0, m);
    if (overlap.some((l) => l !== "") && same(prev.slice(prev.length - m), overlap)) return [...acc, ...next.slice(m)];
  }
  return null;
}

/** A window without the blank lines the panel pads it with (and any at its edges). */
function trimBlank(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a] === "") a++;
  while (b > a && lines[b - 1] === "") b--;
  return lines.slice(a, b);
}

/** The panel cuts a long question to one line ending in "…". */
function sameQuestion(asked: string, question: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const a = norm(asked);
  const q = norm(question);
  return a.endsWith("…") ? q.startsWith(a.slice(0, -1).trimEnd()) : a === q;
}

export interface BtwTiming {
  pollMs: number;
  /** For the panel to show up after the question was sent. */
  openMs: number;
  /** For the answer, once the panel is up. */
  answerMs: number;
  /** For the terminal to redraw after a scroll; a window unchanged by then is the end. */
  scrollMs: number;
}

const TIMING: BtwTiming = { pollMs: 400, openMs: 10_000, answerMs: 120_000, scrollMs: 800 };
const REDRAW_POLL_MS = 80;
/** A scroll moves three lines; this many cover any answer worth reading here. */
const MAX_SCROLLS = 300;

export interface BtwSignal {
  cancelled: boolean;
  /** Set once the panel was seen: only then is Esc safe (on a working Claude, it interrupts the turn). */
  opened?: boolean;
  /** Set once the answer is in: from then on runBtw closes the panel itself, cancelled or not. */
  closing?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reads the answer to `question`, just sent as `/btw`, off the pane's screen: waits for it,
 * scrolls a long one to its end, then closes the panel with Esc.
 */
export async function runBtw(
  call: Call,
  paneId: string,
  question: string,
  timing: BtwTiming = TIMING,
  signal: BtwSignal = { cancelled: false },
): Promise<string> {
  const read = async () => {
    const r = (await call("pane.read", { pane_id: paneId, source: "visible", format: "text", strip_ansi: true })) as
      | { text?: string; read?: { text?: string } }
      | undefined;
    return parseBtwScreen(r?.text ?? r?.read?.text ?? "");
  };
  const keys = (k: string) => call("pane.send_keys", { pane_id: paneId, keys: [k] });
  const check = () => {
    if (signal.cancelled) throw new Error("Cancelled");
  };

  let screen: BtwScreen | null = null;
  for (const until = Date.now() + timing.openMs; ; await sleep(timing.pollMs)) {
    check();
    screen = await read();
    check();
    if (screen && sameQuestion(screen.asked, question)) break;
    if (Date.now() > until) throw new Error("The /btw panel did not open");
  }
  signal.opened = true;
  for (const until = Date.now() + timing.answerMs; screen?.state !== "answered"; ) {
    if (Date.now() > until) throw new Error("No answer from /btw yet");
    await sleep(timing.pollMs);
    check();
    screen = await read();
    check();
    if (!screen) throw new Error("The /btw panel closed before it answered");
  }

  signal.closing = true;
  let acc = trimBlank(screen.lines);
  let prev = acc;
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);
  for (let i = 0; i < MAX_SCROLLS && !signal.cancelled; i++) {
    await keys("down");
    let next = await read();
    for (const until = Date.now() + timing.scrollMs; next?.state === "answered" && same(trimBlank(next.lines), prev) && Date.now() < until; ) {
      await sleep(REDRAW_POLL_MS);
      next = await read();
    }
    if (next?.state !== "answered") break;
    const window = trimBlank(next.lines);
    const merged = mergeScroll(acc, prev, window);
    if (!merged) break;
    acc = merged;
    prev = window;
  }
  await keys("esc");
  check();

  return acc.join("\n");
}

export interface Aside {
  question: string;
  phase: "asking" | "done" | "failed";
  answer?: string;
  error?: string;
  signal: BtwSignal;
}

interface BtwState {
  /** The pane's latest question: while it is asking, Claude's panel holds the pane's keys. */
  asides: Record<string, Aside>;
  /** The pane's earlier questions in this app run, oldest first: the thread above the latest. */
  history: Record<string, Aside[]>;
  /** Follows the `/btw` just sent to `pane` until its answer is read or fails. */
  ask: (pane: PaneRef, question: string, call: Call, timing?: BtwTiming) => Promise<void>;
}

export const useBtw = create<BtwState>((set, get) => ({
  asides: {},
  history: {},
  ask: async (pane, question, call, timing) => {
    const key = paneKey(pane);
    const signal: BtwSignal = { cancelled: false };
    set((s) => {
      const prev = s.asides[key];
      // An answered or failed question joins the thread; one still asking is replaced.
      const history = prev && prev.phase !== "asking" ? { ...s.history, [key]: [...(s.history[key] ?? []), prev] } : s.history;
      return { asides: { ...s.asides, [key]: { question, phase: "asking", signal } }, history };
    });
    const settle = (patch: Partial<Aside>) => {
      // a newer question, or a close, replaced this one
      if (get().asides[key]?.signal !== signal) return;
      set((s) => ({ asides: { ...s.asides, [key]: { ...s.asides[key], ...patch } } }));
    };
    try {
      settle({ phase: "done", answer: await runBtw(call, pane.pane_id, question, timing, signal) });
    } catch (e) {
      settle({ phase: "failed", error: (e as Error)?.message ?? String(e) });
    }
  },
}));

/** Drops the pane's thread; a question still answering is cancelled in Claude too. */
export async function closeBtw(pane: PaneRef, call: Call): Promise<void> {
  const key = paneKey(pane);
  const aside = useBtw.getState().asides[key];
  useBtw.setState((s) => {
    const { [key]: _, ...asides } = s.asides;
    const { [key]: _h, ...history } = s.history;
    return { asides, history };
  });
  if (!aside) return;
  if (aside.phase !== "asking") return;
  aside.signal.cancelled = true;
  if (aside.signal.opened && !aside.signal.closing) await call("pane.send_keys", { pane_id: pane.pane_id, keys: ["esc"] }).catch(() => {});
}
