import type { ChatItem } from "../lib/types";

/**
 * Where an agent worked, read from its tool calls: a folder it went into (`cd`, `pushd`, `git -C`
 * in a Bash command) or a file path a tool named. `at` is the item's index; a folder given relative
 * starts at the session's folder (`./…`), one under home keeps its `~`.
 */
export interface PathHint {
  at: number;
  kind: "dir" | "path";
  path: string;
}

/** A path with an extension in its last segment, absolute or under `~`. */
const FILE_TOKEN = /(?:^|[\s'"=(:,])(~?\/[^\s'"`<>|;&()]*\/[^\s'"`<>|;&()/]*\.[A-Za-z0-9]{1,10})(?=$|[\s'"`<>|;&():,])/g;
const WHOLE_PATH = /^~?\/[^\n]*$/;
/** `cd X`, `pushd X` or `git -C X` at the start of a command in a chain. */
const DIR_STEP = /(?:^|&&|\|\||;|\n)\s*(?:cd|pushd|git\s+-C)\s+('[^']*'|"[^"]*"|[^\s;&|]+)/g;

const unquote = (s: string) => (/^(['"]).*\1$/.test(s) ? s.slice(1, -1) : s);
const isRooted = (p: string) => p.startsWith("/") || p === "~" || p.startsWith("~/");

/** Folders a Bash command goes into, in order; each `cd` continues from the one before. */
function dirsOf(command: string): string[] {
  const out: string[] = [];
  let at = ".";
  for (const m of command.matchAll(DIR_STEP)) {
    const arg = unquote(m[1]);
    if (!arg || arg === "-" || arg.includes("$")) continue;
    at = isRooted(arg) ? arg : `${at}/${arg}`;
    out.push(at);
  }
  return out;
}

/** A tool argument that holds a path by its name: `file_path`, `path`, `paths`, `dir`, `cwd`… */
const PATH_KEY = /(?:^|_)(?:path|paths|dir|directory|cwd)$/i;

/** The strings under path-named keys anywhere in a tool's input. */
function pathArgs(v: unknown, named = false, out: string[] = []): string[] {
  if (typeof v === "string") {
    if (named) out.push(v);
  } else if (Array.isArray(v)) v.forEach((x) => pathArgs(x, named, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) pathArgs(x, PATH_KEY.test(k), out);
  return out;
}

export function pathHints(items: readonly ChatItem[]): PathHint[] {
  const hints: PathHint[] = [];
  items.forEach((it, at) => {
    if (it.kind !== "tool_call") return;
    const seen = new Set<string>();
    const add = (kind: PathHint["kind"], path: string) => {
      if (seen.has(`${kind}:${path}`)) return;
      seen.add(`${kind}:${path}`);
      hints.push({ at, kind, path });
    };
    if (it.name === "Bash") {
      const command = (it.input as { command?: unknown } | null)?.command;
      if (typeof command !== "string") return;
      for (const d of dirsOf(command)) add("dir", d);
      for (const m of command.matchAll(FILE_TOKEN)) add("path", m[1]);
      return;
    }
    // Another tool's path argument is one path, spaces and all. What it writes (content,
    // old_string) is text, whose paths may name anything.
    for (const s of pathArgs(it.input)) if (WHOLE_PATH.test(s)) add("path", s.trim());
  });
  return hints;
}

/** `path` with `.`/`..` resolved; `/` joined, absolute. */
function normalize(path: string): string {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return "/" + out.join("/");
}

/** A hint's path made absolute, or null when it needs a home or a folder this pane has not. */
function absolute(path: string, ctx: { root: string | null; home: string | null }): string | null {
  if (path === "~" || path.startsWith("~/")) return ctx.home ? normalize(ctx.home + path.slice(1)) : null;
  if (path.startsWith("/")) return normalize(path);
  return ctx.root ? normalize(`${ctx.root}/${path}`) : null;
}

/**
 * Where the relative path `rel`, written in the item at `before`, may be, most likely first: a
 * file path a tool named that ends in it, then each folder the agent went into, newest first; last
 * the session's folder, which `cap` never drops. Each place once; which one exists is for the
 * machine to say.
 */
export function pathCandidates(
  rel: string,
  hints: readonly PathHint[],
  before: number,
  ctx: { root: string | null; home: string | null },
  cap = Infinity,
): string[] {
  const tail = normalize(rel).slice(1);
  const earlier = hints.filter((h) => h.at < before).reverse();
  const out: string[] = [];
  const push = (p: string | null) => {
    if (p && !out.includes(p)) out.push(p);
  };
  for (const h of earlier) {
    if (h.kind !== "path") continue;
    const abs = absolute(h.path, ctx);
    if (abs && abs.endsWith(`/${tail}`)) push(abs);
  }
  for (const h of earlier) {
    if (h.kind !== "dir") continue;
    const dir = absolute(h.path, ctx);
    push(dir && normalize(`${dir}/${tail}`));
  }
  const own = ctx.root && normalize(`${ctx.root}/${tail}`);
  push(own);
  const kept = out.slice(0, cap);
  // Past the cap, the session's folder takes the last place: it never drops out.
  if (own && !kept.includes(own)) kept[kept.length - 1] = own;
  return kept;
}
