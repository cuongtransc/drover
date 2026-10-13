// Stopping a Claude turn that has not answered yet takes the prompt back: Claude Code drops it
// from the conversation and puts it back in its own input box, as Esc does in its terminal. The
// Chat lens does not show that box, so the next send would be typed after the old prompt. Stop
// therefore moves the prompt from Claude's box into the Composer.
// Screen layout checked against claude 2.1.296, 2026-10-13.

import { sgrRuns } from "./prompt/claudeSuggestion";

type Call = (method: string, params: unknown) => Promise<unknown>;

const RULE_RE = /^[─━]{8,}$/;
/** What Claude shows in its box for a long paste or an image, in place of the text. */
const PLACEHOLDER_RE = /\[(?:Pasted text|Image) #\d+/;
const PASTE_ONLY_RE = /^\[Pasted text #\d+(?: \+\d+ lines)?\]$/;

/**
 * The text typed in Claude's input box (the `❯` lines between the screen's last two rules), or
 * null when it is empty or holds only Claude's grey suggestion.
 */
export function inputBox(ansi: string): string | null {
  const lines = ansi.split("\n").map((l) => l.replace(/\r$/, ""));
  const runs = lines.map(sgrRuns);
  const plain = runs.map((r) => r.map(([t]) => t).join(""));
  let end = plain.length - 1;
  while (end >= 0 && !RULE_RE.test(plain[end].trim())) end--;
  let start = end - 1;
  while (start >= 0 && !RULE_RE.test(plain[start].trim())) start--;
  if (start < 0 || !/^❯[\s ]/.test(plain[start + 1])) return null;
  // Typed text is drawn plain; the suggestion is dim but for the cursor Claude draws on it.
  const typed = runs
    .slice(start + 1, end)
    .some((line) => line.some(([t, dim, inverse]) => !dim && !inverse && t.replace(/^❯/, "").trim() !== ""));
  if (!typed) return null;
  const text = plain
    .slice(start + 1, end)
    .map((l, i) => (i === 0 ? l.slice(2) : l.replace(/^ {1,2}/, "")).replace(/ /g, " ").trimEnd())
    .join("\n")
    .trim();
  return text === "" ? null : text;
}

/**
 * What goes back in the Composer for the text in Claude's box: `sent`, the prompt Drover sent
 * last, when the box shows it (or Claude's placeholder for a paste that long), else the box's own
 * text. Null when the box holds a paste or an image whose text Drover does not have.
 */
export function restoredPrompt(box: string, sent: string | undefined): string | null {
  if (sent !== undefined) {
    // Claude wraps a long line onto the next: only the characters are compared.
    const flat = (s: string) => s.replace(/\s+/g, "");
    if (flat(box) === flat(sent)) return sent;
    // Claude collapses a long paste; a short prompt it shows in full.
    if (PASTE_ONLY_RE.test(box) && (sent.length > 200 || sent.split("\n").length > 2)) return sent;
  }
  return PLACEHOLDER_RE.test(box) ? null : box;
}

export interface StopTiming {
  pollMs: number;
  /** For Claude to put the prompt back after Esc, and to empty its box after Ctrl+C. */
  waitMs: number;
}

/** Ends the wait early, touching nothing: the Composer that asked is gone. */
export type Cancelled = () => boolean;

const TIMING: StopTiming = { pollMs: 150, waitMs: 3000 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * After Esc stopped the Claude in `paneId`: the prompt Claude put back in its input box, taken
 * out of it with Ctrl+C (which empties a box of several lines; Ctrl+U only one). Null, with the
 * box left alone, when Claude keeps nothing there or its text cannot be put back.
 */
export async function takeBackStopped(
  call: Call,
  paneId: string,
  sent: string | undefined,
  cancelled: Cancelled = () => false,
  timing: StopTiming = TIMING,
): Promise<string | null> {
  const box = async () => {
    const r = (await call("pane.read", { pane_id: paneId, source: "visible", format: "ansi", strip_ansi: false })) as
      | { text?: string; read?: { text?: string } }
      | undefined;
    return inputBox(r?.text ?? r?.read?.text ?? "");
  };
  // Each read first checks the Composer is still there: it may have gone during the wait.
  let held: string | null = null;
  for (const end = Date.now() + timing.waitMs; ; await sleep(timing.pollMs)) {
    if (cancelled()) return null;
    held = await box();
    if (held !== null || Date.now() > end) break;
  }
  const restored = held === null ? null : restoredPrompt(held, sent);
  if (restored === null || cancelled()) return null;
  await call("pane.send_keys", { pane_id: paneId, keys: ["ctrl+c"] });
  for (const end = Date.now() + timing.waitMs; ; await sleep(timing.pollMs)) {
    if (cancelled()) return null;
    if ((await box()) === null) return restored;
    if (Date.now() > end) return null;
  }
}
