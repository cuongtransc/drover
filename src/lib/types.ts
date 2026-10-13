// Mirrors the Rust structs in src-tauri field-for-field (snake_case). Filled in by later tasks.

export interface PaneRef {
  machine_id: string;
  session: string;
  pane_id: string;
}

export interface AppError {
  code: string;
  message: string;
}

export function paneKey(ref: PaneRef): string {
  return `${ref.machine_id}/${ref.session}/${ref.pane_id}`;
}

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export type MachineState =
  | "disconnected"
  | "authenticating"
  | "probing"
  | "connected"
  | "incompatible"
  | "error";

export interface PaneView {
  pane_id: string;
  terminal_id: string;
  title: string;
  /** A shell's: what it does now (its terminal title, else the command it runs), shown after the title. */
  activity?: string | null;
  cwd: string | null;
  agent: string | null;
  status: AgentStatus;
  /** A shell's: whether a command holds its terminal; null for an agent or before herdr was asked. */
  busy?: boolean | null;
  /** An agent herdr's agent API does not know (started through a wrapper): driven as a pane. */
  untracked?: boolean;
}

export interface TabView {
  tab_id: string;
  label: string;
  number: number;
  status: AgentStatus;
  panes: PaneView[];
}

export interface WorkspaceView {
  workspace_id: string;
  label: string;
  number: number;
  status: AgentStatus;
  tabs: TabView[];
}

export interface SessionView {
  name: string;
  running: boolean;
  status: AgentStatus;
  error: AppError | null;
  workspaces: WorkspaceView[];
}

export interface MachineView {
  id: string;
  label: string;
  /** "local" or "ssh" */
  kind: string;
  state: MachineState;
  error: AppError | null;
  version: string | null;
  /** The login user's home folder, once known; optional so older fixtures need not set it. */
  home?: string | null;
  status: AgentStatus;
  sessions: SessionView[];
}

export interface PaneStatusEvent {
  pane: PaneRef;
  status: AgentStatus;
  previous: AgentStatus;
  title: string;
}

export type AttachEvent =
  | { type: "attached" }
  | { type: "held" }
  | { type: "exited"; code: number | null }
  | { type: "detached" };

export interface ImageRef { ref: string; media_type: string }
export interface SkillUse { name: string; path: string }
/** The Model, Reasoning effort and context size (tokens) the Transcript last named. */
/** A pi alias Model as pi's footer names it; `fallback`: what served it is not the chain's head. */
export interface ModelAlias { name: string; label: string; provider: string | null; fallback: boolean }

/** A background Bash command or Agent the Transcript started and has not yet ended; `started`: ISO 8601, if known. */
export interface BackgroundTask { call_id: string; kind: "bash" | "agent" | "monitor" | "workflow"; description: string; started: string | null; waiting?: boolean }
/** How a background task ended, carried on the System item that reports it. */
export interface TaskEnd { call_id: string; status: string; exit_code?: number }

/** `model` is what served the last reply; with `alias`, the alias's target. */
export interface ChatMeta { model: string | null; effort: string | null; context_tokens: number | null; alias?: ModelAlias | null }

/** `ts`: when the Transcript record was written (ISO 8601), if it says. */
export type ChatItem = (
  | { kind: "user"; text: string; images?: ImageRef[]; skills?: SkillUse[] }
  | { kind: "assistant_text"; markdown: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; id: string; name: string; input_summary: string; input: unknown }
  | { kind: "tool_result"; call_id: string; output: string; is_error: boolean; images?: ImageRef[] }
  | { kind: "system"; text: string; task?: TaskEnd }
  | { kind: "shell_command"; command: string }
  | { kind: "shell_output"; stdout: string; stderr: string }
) & { ts?: string };

export type ChatEvent =
  | { type: "reset"; items: ChatItem[]; total: number }
  | { type: "append"; items: ChatItem[] }
  | ({ type: "meta"; queued: string[]; background: BackgroundTask[] } & ChatMeta)
  | { type: "error"; error: AppError };

/** The folder and git branch a Pane works in (`branch` is null outside a repository). */
export interface GitStatus {
  folder: string;
  path: string;
  branch: string | null;
  dirty: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  /** How many files have any change; `changes` lists the first few. */
  changed: number;
  changes: GitChange[];
}

export interface Located {
  agent: string;
  path: string;
  ambiguous: boolean;
  candidates: string[];
  /** The file does not exist yet: Claude writes it on the first prompt, at `path`. */
  pending: boolean;
  /** Reopened on the Pane's running tail without locating again: check it after. */
  cached?: boolean;
}

export interface SlashCommand {
  name: string;
  description: string;
  source: "builtin" | "user" | "project" | "skill" | "plugin";
  trigger?: "$";
}

export type QuotaProvider = "claude" | "codex" | "opencodeGo" | "grok";
export interface QuotaWindow {
  label: string;
  usedPercent: number;
  resetsAt: number | null;
  durationSecs: number | null;
}
export type QuotaOutcome =
  | { kind: "ok"; windows: QuotaWindow[]; fetchedAt: number }
  | { kind: "notSignedIn" }
  | { kind: "signInExpired" }
  | { kind: "noSubscription" }
  | { kind: "rateLimited"; until: number }
  | { kind: "failed"; reason: string };

export interface CtaAccount {
  provider: string;
  account: string;
  windows: QuotaWindow[];
  polledAt: number | null;
  status: string;
  detail: string;
}
export type CtaQuota =
  | { kind: "missing" }
  | { kind: "ok"; accounts: CtaAccount[]; readAt: number }
  | { kind: "failed"; reason: string };

export interface GitChange {
  code: string;
  path: string;
}

export interface FileEntry {
  name: string;
  /** `dirlink` is a symlink to a folder: it expands like a folder. */
  kind: "file" | "dir" | "symlink" | "dirlink";
}
export interface FileContent {
  kind: "text" | "binary" | "image";
  text: string | null;
  truncated: boolean;
  size: number;
  mtime: number;
}
export interface FileList {
  paths: string[];
  capped: boolean;
  refused: boolean;
}

/** Git changes under a Files root, paths relative to it; `total` counts past the listed ones. */
export interface Changed {
  /** False when the root is not inside a git repository. */
  repo: boolean;
  total: number;
  changes: GitChange[];
}

export interface FileChange {
  path: string;
  isDir: boolean;
  removed: boolean;
}

export type WatchEvent = { type: "resync" } | { type: "changes"; changes: FileChange[] } | { type: "error"; message: string };
