import { parsePathRef } from "./pathLinks";

/** A path is bare when it starts a word: after the start, a space or an opening bracket or quote,
 *  so a URL (`https://…`, `file:///…`) or `and/or` never matches. */
const BARE = /(^|[\s(["'“‘])((?:~\/|\/)[^\s`"'<>|()[\]{}]+)/g;
/** Closing punctuation that ends a sentence or a list item's `path: description`, not the path. */
const TRAILING = /[.,;:!?'"”’]+$/;
/** The last segment must be a file name with an extension, as in a relative path: a bare folder
 *  or extensionless name in prose is too likely to be something else. */
const FILE = /\/[^/]*[^/.][^/]*\.[A-Za-z0-9]{1,10}(?::\d+){0,2}$/;

export type BarePart = string | { path: string };

/** `text` split into prose and the absolute or `~/` file paths written in it without backticks. */
export function splitBarePaths(text: string): BarePart[] {
  const parts: BarePart[] = [];
  let last = 0;
  for (const m of text.matchAll(BARE)) {
    const path = m[2].replace(TRAILING, "");
    if (!FILE.test(path) || !parsePathRef(path)) continue;
    const start = m.index + m[1].length;
    if (start > last) parts.push(text.slice(last, start));
    parts.push({ path });
    last = start + path.length;
  }
  if (last < text.length || !parts.length) parts.push(text.slice(last));
  return parts;
}

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hChildren?: unknown[] };
}

/** Whose text is never a path link: a link already is one, and code is linked as `PathCode`. */
const SKIP = new Set(["link", "linkReference", "inlineCode", "code", "html", "definition"]);

function walk(node: MdNode): void {
  if (!node.children || SKIP.has(node.type)) return;
  node.children = node.children.flatMap((child) => {
    if (child.type !== "text" || !child.value) {
      walk(child);
      return [child];
    }
    const parts = splitBarePaths(child.value);
    if (parts.length === 1 && typeof parts[0] === "string") return [child];
    return parts.map((p): MdNode => (typeof p === "string" ? { type: "text", value: p } : { type: "barePath", data: { hName: "path-ref" }, children: [{ type: "text", value: p.path }] }));
  });
}

/** Remark plugin: a bare file path in prose becomes a `<path-ref>` element, rendered as `PathCode`. */
export function remarkBarePaths() {
  return (tree: MdNode) => walk(tree);
}
