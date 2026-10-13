// Editing the last message the way Claude Code's Esc Esc does: its Rewind screen goes back to
// before the message, in the same session (the transcript gets a new branch), and puts the
// message back in Claude's input box. The Chat lens drives that screen through the pane's keys,
// checking each step on the screen, then hands the message to its own Composer.
// Screen layout checked against claude 2.1.296, 2026-10-12.

import { create } from "zustand";
import { paneKey, type PaneRef } from "../lib/types";

type Call = (method: string, params: unknown) => Promise<unknown>;

export type RewindScreen =
  | { kind: "picker"; selected: string; changes: string | null }
  | { kind: "confirm"; message: string; code: string; options: string[]; selected: number };

/** Claude's Rewind screen on `screen`, or null when it is not open. */
export function parseRewind(screen: string): RewindScreen | null {
  const lines = screen
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");
  const head = lines.findIndex((l, i) => l.trim() === "Rewind" && /^\s*(Restore the code|Confirm you want to restore)/.test(lines[i + 1] ?? ""));
  if (head < 0) return null;
  const body = lines.slice(head + 1);
  if (body[0].trim().startsWith("Confirm you want to restore")) {
    const message: string[] = [];
    let code = "";
    const options: string[] = [];
    let selected = -1;
    for (const l of body.slice(1)) {
      const quoted = /^\s*│ (.*)$/.exec(l);
      const option = /^\s*(❯|↓|↑)?\s*\d+\. (.+)$/.exec(l);
      if (quoted && !/^\(.* ago\)$/.test(quoted[1].trim())) message.push(quoted[1]);
      else if (l.trim().startsWith("The code will")) code = l.trim();
      else if (option) {
        if (option[1] === "❯") selected = options.length;
        options.push(option[2].trim());
      }
    }
    return { kind: "confirm", message: message.join("\n"), code, options, selected };
  }
  const at = body.findIndex((l) => /^\s*❯ /.test(l));
  if (at < 0) return null;
  const selected = body[at].replace(/^\s*❯ /, "").trim();
  const next = body[at + 1]?.trim() ?? "";
  const changes = next && !/^(❯|↓|↑|Enter to continue)/.test(next) ? next : null;
  return { kind: "picker", selected, changes };
}

/** Whether a line Claude shows (its first line, maybe cut short with "…") is `message`. */
export function sameMessage(shown: string, message: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const first = norm(message.split("\n").find((l) => l.trim()) ?? "");
  const s = norm(shown);
  return s.endsWith("…") ? first.startsWith(s.slice(0, -1).trimEnd()) && s.length > 1 : s === first;
}

export interface RewindTiming {
  pollMs: number;
  /** For each screen to show up after a key. */
  stepMs: number;
  /** For a working Claude to stop after Esc. */
  idleMs: number;
}

const TIMING: RewindTiming = { pollMs: 120, stepMs: 3000, idleMs: 10_000 };

export type CodeChoice = "both" | "conversation";

export interface RewindOptions {
  /** The pane's agent status now, as herdr reports it. */
  status: () => string | undefined;
  /** Asked when the message changed files: `code` is Claude's own line for restoring them too. */
  choose: (code: string) => Promise<CodeChoice | null>;
  timing?: RewindTiming;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Rewinds the Claude in `paneId` to before `message`, its last message, and empties the input box
 * Claude puts the message back into. A working Claude is stopped first (Esc ends its turn).
 * Any screen that is not the expected one stops it, backing out of Rewind with Esc.
 */
export async function runRewind(call: Call, paneId: string, message: string, opts: RewindOptions): Promise<void> {
  const timing = opts.timing ?? TIMING;
  const keys = (...k: string[]) => k.reduce((p, key) => p.then(() => call("pane.send_keys", { pane_id: paneId, keys: [key] })), Promise.resolve<unknown>(undefined));
  const read = async () => {
    const r = (await call("pane.read", { pane_id: paneId, source: "visible", format: "text", strip_ansi: true })) as
      | { text?: string; read?: { text?: string } }
      | undefined;
    return r?.text ?? r?.read?.text ?? "";
  };
  const until = async <T>(what: (screen: string) => T | null | undefined, ms: number): Promise<T | null> => {
    for (const end = Date.now() + ms; ; await sleep(timing.pollMs)) {
      const got = what(await read());
      if (got) return got;
      if (Date.now() > end) return null;
    }
  };
  const busy = () => ["working", "blocked"].includes(opts.status() ?? "");

  if (busy()) {
    await keys("esc");
    for (const end = Date.now() + timing.idleMs; busy(); await sleep(timing.pollMs)) {
      if (Date.now() > end) throw new Error("Claude did not stop: try again, or use the Terminal lens");
    }
  }

  await keys("esc", "esc");
  let picker = await until((s) => {
    const r = parseRewind(s);
    return r?.kind === "picker" ? r : null;
  }, timing.stepMs);
  if (!picker) throw new Error("Claude's Rewind did not open");
  if (picker.selected === "(current)") {
    await keys("up");
    picker = await until((s) => {
      const r = parseRewind(s);
      return r?.kind === "picker" && r.selected !== "(current)" ? r : null;
    }, timing.stepMs);
    if (!picker) {
      await keys("esc");
      throw new Error("Claude's Rewind lists no message to go back to");
    }
  }
  if (!sameMessage(picker.selected, message)) {
    await keys("esc");
    throw new Error("This is not the last message Claude has: use the Terminal lens to rewind further");
  }

  await keys("enter");
  const confirm = await until((s) => {
    const r = parseRewind(s);
    return r?.kind === "confirm" ? r : null;
  }, timing.stepMs);
  const back = () => keys("esc", "esc");
  if (!confirm || !sameMessage(confirm.message.split("\n")[0], message)) {
    await back();
    throw new Error("Claude's Rewind asked about another message");
  }

  let label = "Restore conversation";
  if (confirm.options.includes("Restore code and conversation")) {
    const choice = await opts.choose(confirm.code);
    if (!choice) {
      await back();
      throw new Error("Cancelled");
    }
    if (choice === "both") label = "Restore code and conversation";
  }
  const target = confirm.options.indexOf(label);
  if (target < 0 || confirm.selected < 0) {
    await back();
    throw new Error(`Claude's Rewind offers no "${label}"`);
  }
  for (let i = confirm.selected; i < target; i++) await keys("down");
  for (let i = confirm.selected; i > target; i--) await keys("up");
  if (target !== confirm.selected) {
    const moved = await until((s) => {
      const r = parseRewind(s);
      return r?.kind === "confirm" && r.selected === target ? r : null;
    }, timing.stepMs);
    if (!moved) {
      await back();
      throw new Error(`Could not pick "${label}" in Claude's Rewind`);
    }
  }
  await keys("enter");

  // Claude puts the message back in its input box: the Composer takes it from here. Ctrl+C empties
  // the box whatever its lines; Ctrl+U would clear only the one the cursor is on.
  const restored = await until((s) => (parseRewind(s) === null && boxHolds(s, message) ? true : null), timing.stepMs);
  if (!restored) throw new Error("Rewound, but Claude's input box did not show the message: check the Terminal lens");
  await keys("ctrl+c");
}

/** Whether Claude's input box (the `❯` line between two rules) starts with `message`. */
function boxHolds(screen: string, message: string): boolean {
  const lines = screen.split("\n");
  // The box is the last such pair: earlier ones are transcript scrolled past.
  for (let i = lines.length - 1; i >= 1; i--) {
    // Claude puts a no-break space after its prompt mark.
    const box = /^❯\s(.*)$/.exec(lines[i]);
    if (/^─{10,}/.test(lines[i - 1].trim()) && box) return sameMessage(box[1], message);
  }
  return false;
}

export interface Edit {
  phase: "running" | "choose" | "failed";
  /** While choosing: Claude's line for restoring the code too. */
  code?: string;
  error?: string;
  /** While choosing: answers Claude's question; null backs out. */
  answer?: (choice: CodeChoice | null) => void;
}

/** Each pane's edit of its last message in flight, by pane key. */
export const useRewind = create<{ edits: Record<string, Edit> }>(() => ({ edits: {} }));

/** Text for a pane's Composer to take over, by pane key: set by an edit, taken once. */
export const useComposerFill = create<{ fill: Record<string, string> }>(() => ({ fill: {} }));

function setEdit(key: string, edit: Edit | null) {
  useRewind.setState((s) => {
    const { [key]: _, ...rest } = s.edits;
    return { edits: edit ? { ...rest, [key]: edit } : rest };
  });
}

/** Clears a failed edit's notice. */
export const dismissEdit = (pane: PaneRef) => setEdit(paneKey(pane), null);

/**
 * Takes `message`, the pane's last, back to edit: Claude rewinds to before it, and the
 * Composer gets its text. When the message changed files the user picks what to restore.
 */
export async function editLast(pane: PaneRef, message: string, call: Call, status: () => string | undefined, timing?: RewindTiming): Promise<void> {
  const key = paneKey(pane);
  setEdit(key, { phase: "running" });
  const choose = (code: string) =>
    new Promise<CodeChoice | null>((resolve) =>
      setEdit(key, {
        phase: "choose",
        code,
        answer: (c) => {
          setEdit(key, { phase: "running" });
          resolve(c);
        },
      }),
    );
  try {
    await runRewind(call, pane.pane_id, message, { status, choose, timing });
    setEdit(key, null);
    useComposerFill.setState((s) => ({ fill: { ...s.fill, [key]: message } }));
  } catch (e) {
    const error = (e as Error)?.message ?? String(e);
    setEdit(key, error === "Cancelled" ? null : { phase: "failed", error });
  }
}
