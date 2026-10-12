import { create } from "zustand";
import { paneKey } from "../lib/types";
import type { Located, PaneRef, PaneView, WorkspaceView } from "../lib/types";
import { findPane, useApp } from "../store/app";
import { prunePaneKeys } from "./protect";
import { launchAgent } from "./launchAgent";

type Call = (method: string, params: unknown) => Promise<unknown>;

/** Resuming a long transcript takes longer than starting a fresh agent. */
const FORK_START_MS = 15000;

/**
 * Why `pane` cannot be forked now, or null. A fork of a turn still running sees its unfinished
 * tool call as cut off and runs it again (checked against claude 2.1.295, 2026-10-09), so only an
 * idle or done Claude pane forks.
 */
export function forkBlocked(pane: PaneView): string | null {
  if (pane.agent !== "claude") return "Only Claude sessions can be forked";
  if (pane.untracked) return "herdr does not track this Claude session";
  if (pane.status === "working") return "Busy: a fork now would run its unfinished command again. Fork once it finishes.";
  if (pane.status === "blocked") return "Waiting for an answer: a fork now would run its unfinished command again. Answer it first.";
  return null;
}

export interface ForkOrigin {
  /** The pane it was forked from. */
  of: PaneRef;
  /** The forked pane's title. */
  from: string;
  /** When it was forked (ms). */
  at: number;
  /** The worktree Claude made for it, if any. */
  worktree: string | null;
  /** The original's transcript: the fork's Chat lens shows it until the fork writes its own. */
  path?: string;
}

const KEY = "drover:forks";

function load(): Record<string, ForkOrigin> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, ForkOrigin>) : {};
  } catch {
    return {};
  }
}

/** By the fork's paneKey: where it came from, for the Chat lens banner. */
function save(forks: Record<string, ForkOrigin>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(forks));
  } catch {
    /* ignore */
  }
}

interface ForksStore {
  forks: Record<string, ForkOrigin>;
  add: (key: string, o: ForkOrigin) => void;
  remove: (key: string) => void;
  replace: (forks: Record<string, ForkOrigin>) => void;
}

export const useForks = create<ForksStore>((set, get) => ({
  forks: load(),
  add: (key, o) => get().replace({ ...get().forks, [key]: o }),
  remove: (key) => {
    const { [key]: _, ...rest } = get().forks;
    get().replace(rest);
  },
  replace: (forks) => {
    save(forks);
    set({ forks });
  },
}));

/** Forgets the records of panes gone from their machine (herdr reuses pane ids); returns the unsubscribe. */
export function watchForkPrune(): () => void {
  return useApp.subscribe((s, prev) => {
    if (s.machines === prev.machines) return;
    let forks = useForks.getState().forks;
    for (const [id, m] of Object.entries(s.machines)) if (m !== prev.machines[id]) forks = prunePaneKeys(forks, m);
    if (forks !== useForks.getState().forks) useForks.getState().replace(forks);
  });
}

const pad = (n: number) => String(n).padStart(2, "0");
function stamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Opens a tab beside `ref` running `claude --resume <its session> --fork-session`, in a new
 * worktree when asked (Claude's `--worktree`). Refuses, before opening anything, a pane that
 * cannot fork, a session herdr has not reported, and one with no transcript yet or only a guessed one.
 */
export async function forkSession(
  ref: PaneRef,
  ws: WorkspaceView,
  pane: PaneView,
  { worktree }: { worktree: boolean },
  { call, locate }: { call: Call; locate: (p: PaneRef) => Promise<Located> },
): Promise<void> {
  const blocked = forkBlocked(pane);
  if (blocked) throw new Error(blocked);
  const got = (await call("agent.get", { target: ref.pane_id })) as { agent?: { agent_session?: { kind?: string; value?: string } | null } };
  const session = got?.agent?.agent_session;
  if (session?.kind !== "id" || !session.value) throw new Error("herdr has not reported this pane's session yet");
  const where = await locate(ref);
  if (where.pending) throw new Error("Nothing to fork yet: send it a first message");
  if (where.ambiguous) throw new Error("Drover is not sure which session this pane runs, so it cannot fork it");
  // The menu's pane may be stale by now: a turn that started meanwhile must not be forked.
  const live = findPane(useApp.getState().machines, ref);
  const stillBlocked = live && forkBlocked(live);
  if (stillBlocked) throw new Error(stillBlocked);

  const now = new Date();
  const tree = worktree ? `fork-${stamp(now)}` : null;
  const res = (await call("tab.create", { workspace_id: ws.workspace_id, ...(pane.cwd ? { cwd: pane.cwd } : {}), label: "fork", focus: false })) as {
    root_pane: { pane_id: string };
  };
  const fork = { machine_id: ref.machine_id, session: ref.session, pane_id: res.root_pane.pane_id };
  const key = paneKey(fork);
  const title = pane.title.trim();
  // Opens on Chat whatever new agents open on: its banner says what it is and leads back.
  useForks.getState().add(key, { of: ref, from: title || "a Claude session", at: now.getTime(), worktree: tree, path: where.path });
  useApp.getState().setLensOverride(key, "chat");
  useApp.getState().select(fork);
  const args = ["--resume", session.value, "--fork-session", "--name", title ? `Fork · ${title}` : "Fork", ...(tree ? ["--worktree", tree] : [])];
  try {
    await launchAgent(call, fork, "claude", { name: "fork", args, timeoutMs: FORK_START_MS });
  } catch (e) {
    // The tab stays, showing what the shell did; it is no fork.
    useForks.getState().remove(key);
    throw e;
  }
}
