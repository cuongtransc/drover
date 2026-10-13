// The Sessions filter: words typed above the tree, matched as substrings (not fuzzy, as ⌘K is),
// so a name half remembered narrows the tree without the scattered hits of a fuzzy match.
import type { MachineView, SessionView } from "../lib/types";
import type { RBookmark, RNode } from "./groups";

export const queryWords = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);

const has = (fields: string[], word: string) => fields.some((f) => f.toLowerCase().includes(word));

/**
 * What of a Session the words find. "all": each word is in its name, its machine's label or a group
 * holding it. Else the ids of the Workspaces whose label holds the words those leave, null for none.
 */
export function matchSession(machine: MachineView, session: SessionView, groups: string[], words: string[]): "all" | string[] | null {
  const own = [session.name, machine.label, ...groups];
  const rest = words.filter((w) => !has(own, w));
  if (rest.length === 0) return "all";
  const ids = session.workspaces.filter((w) => rest.every((x) => has([w.label], x))).map((w) => w.workspace_id);
  return ids.length ? ids : null;
}

/** The resolved sidebar with only what the words find: order kept, emptied groups dropped, a Session
 *  found only by some Workspaces marked with their ids. Bookmarks stay whole. */
export function queryResolved(r: { tree: RNode[]; bookmarks: RBookmark[] }, words: string[]): { tree: RNode[]; bookmarks: RBookmark[] } {
  const walk = (nodes: RNode[], groups: string[]): RNode[] =>
    nodes.flatMap((n): RNode[] => {
      if (n.kind === "group") {
        const children = walk(n.children, [...groups, n.label]);
        return children.length ? [{ ...n, children }] : [];
      }
      const m = matchSession(n.machine, n.session, groups, words);
      return m === null ? [] : m === "all" ? [n] : [{ ...n, match: m }];
    });
  return { tree: walk(r.tree, []), bookmarks: r.bookmarks };
}

/** herdr's own Session, `default` (bare `herdr`, or herdr connecting to a machine, starts it), with
 *  no agent in it: a line the user does not use, hidden unless Settings shows it. */
export const isIdleDefault = (s: SessionView): boolean =>
  s.name === "default" && !s.workspaces.some((w) => w.tabs.some((t) => t.panes.some((p) => p.agent)));
