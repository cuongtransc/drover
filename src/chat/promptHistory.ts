// Prompts sent from the Composer, recalled with Up and Down as in the agents' own TUIs. Kept per
// folder (Claude Code keeps its history per working directory), so every agent working there
// shares it and it outlives the pane.
const historyKey = (scope: string) => `drover:history:${scope}`;

/** How many prompts a scope keeps; the oldest go first. */
export const HISTORY_MAX = 100;

/** The scope's prompts, oldest first. */
export function readHistory(scope: string): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(historyKey(scope)) ?? "[]");
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** Add a sent prompt, skipping a blank one and a repeat of the last. */
export function recordPrompt(scope: string, prompt: string) {
  if (prompt.trim() === "") return;
  const list = readHistory(scope);
  if (list[list.length - 1] === prompt) return;
  list.push(prompt);
  try {
    localStorage.setItem(historyKey(scope), JSON.stringify(list.slice(-HISTORY_MAX)));
  } catch {
    /* storage unavailable: nothing to recall later */
  }
}

/** The agent's own history with the prompts sent since it was read after it, skipping a repeat
 *  of the last (the agent may have written the newest one already); the newest `HISTORY_MAX`. */
export function withSent(agent: string[], sent: string[]): string[] {
  const out = [...agent];
  for (const p of sent) if (out[out.length - 1] !== p) out.push(p);
  return out.slice(-HISTORY_MAX);
}

/** What Up walks, oldest first: the folder's other prompts, then this session's (Claude recalls
 *  the running session's first), then those sent since the session was read. */
export function recallList(folder: string[], session: string[], sent: string[]): string[] {
  const inSession = new Set(session);
  return withSent(
    [...folder.filter((p) => !inSession.has(p)), ...session],
    sent.filter((p) => !inSession.has(p)),
  );
}

/**
 * Where Up and Down stand in the history. The first step back keeps the unsent draft, which a
 * step forward past the newest prompt (or `cancel`) hands back, so browsing never loses it.
 */
export class HistoryCursor {
  private list: string[] = [];
  private index: number | null = null;
  private draft = "";

  constructor(private read: () => string[]) {}

  get browsing(): boolean {
    return this.index !== null;
  }

  /** The prompt before the one shown, or null at the oldest or with no history. */
  back(current: string): string | null {
    if (this.index === null) {
      this.list = this.read();
      if (this.list.length === 0) return null;
      this.draft = current;
      this.index = this.list.length - 1;
      return this.list[this.index];
    }
    if (this.index === 0) return null;
    this.index -= 1;
    return this.list[this.index];
  }

  /** The prompt after the one shown, the draft past the newest, or null when not browsing. */
  forward(): string | null {
    if (this.index === null) return null;
    if (this.index < this.list.length - 1) {
      this.index += 1;
      return this.list[this.index];
    }
    return this.cancel();
  }

  /** Stop browsing and hand back the draft; null when not browsing. */
  cancel(): string | null {
    if (this.index === null) return null;
    this.index = null;
    return this.draft;
  }

  /** Stop browsing, keeping what is shown: it was edited, or sent. */
  reset() {
    this.index = null;
  }
}
