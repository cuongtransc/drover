/** A file path written in a chat message, with the line it points at (`path:line`). */
export interface PathRef {
  path: string;
  line: number | null;
}

/** Where a click on a path goes: a file tab (inside the workspace folder), this Mac, or a file tab
 *  read from another machine outside the folder (`remote`). */
export type PathTarget =
  | { kind: "files"; abs: string; line: number | null }
  | { kind: "file"; abs: string }
  | { kind: "remote"; abs: string; line: number | null };

const MAX_LEN = 512;
/** A relative path must end in a file name with an extension, so `and/or` or `src/files` stay code. */
const RELATIVE = /^(?:\.{1,2}\/)?[\w@+~-][\w.@+~-]*(?:\/[\w.@+~-]+)*\/[\w@+~-][\w.@+~-]*\.[A-Za-z0-9]{1,10}$/;
/** An absolute or home path may hold spaces (macOS folders do), not quotes, backticks or brackets. */
const ABSOLUTE = /^~?\/[^\s/`"'<>|][^`"'<>|\n\t]*$/;
/** A shell glob (`*`, `?`, `{a,b}`) names many files or none, so it is not one file to open. */
const GLOB = /[*?]|\{[^}]*,[^}]*\}/;

/** The path in an inline-code span such as `src/a.ts:12` or `~/shot.png`, or null for other code. */
export function parsePathRef(text: string): PathRef | null {
  const t = text.trim();
  if (!t || t.length > MAX_LEN || t.includes("://")) return null;
  const m = /^(.*?)(?::(\d+))?(?::\d+)?$/.exec(t);
  const path = m?.[1] ?? "";
  const line = m?.[2] ? Number(m[2]) : null;
  if (path.startsWith("/") || path.startsWith("~/")) return ABSOLUTE.test(path) && !GLOB.test(path) ? { path, line } : null;
  return RELATIVE.test(path) ? { path, line } : null;
}

/** `path` with `.` and `..` segments resolved; it must already be absolute. */
function normalize(path: string): string {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return "/" + out.join("/");
}

/**
 * Where `ref` leads for a pane whose workspace folder is `root` on a machine whose home is `home`.
 * Files opens anything inside the folder, on any machine; a path outside it opens on this Mac
 * (`local`), or is read from the other machine into a file tab.
 */
export function pathTarget(ref: PathRef, ctx: { root: string | null; home: string | null; local: boolean }): PathTarget | null {
  let abs: string;
  if (ref.path.startsWith("~/")) {
    if (!ctx.home) return null;
    abs = normalize(`${ctx.home}/${ref.path.slice(2)}`);
  } else if (ref.path.startsWith("/")) {
    abs = normalize(ref.path);
  } else {
    if (!ctx.root) return null;
    abs = normalize(`${ctx.root}/${ref.path}`);
  }
  const root = ctx.root ? normalize(ctx.root) : null;
  if (root && (root === "/" || abs === root || abs.startsWith(root + "/"))) return { kind: "files", abs, line: ref.line };
  if (ctx.local) return { kind: "file", abs };
  return abs === "/" ? null : { kind: "remote", abs, line: ref.line };
}
