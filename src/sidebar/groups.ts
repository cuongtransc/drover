// Pure layout model for sidebar Groups and Bookmarks.
// Must not import from src/store/ (the store imports this file).

import { create } from "zustand";
import type { MachineView, SessionView } from "../lib/types";

export type SessionKey = string;

export const sessionKey = (machineId: string, session: string): SessionKey =>
  `${encodeURIComponent(machineId)}/${encodeURIComponent(session)}`;

/** A bookmarked project: its Session's key and its Workspace's label (not herdr's id), so a
 *  Workspace opened again under the same name finds its bookmark (ADR 0006). */
export type ProjectKey = string;

export const projectKey = (machineId: string, session: string, workspace: string): ProjectKey =>
  `${sessionKey(machineId, session)}/${encodeURIComponent(workspace)}`;

/** The Session a bookmarked project belongs to. */
const sessionOf = (k: ProjectKey): SessionKey => k.slice(0, k.lastIndexOf("/"));
/** A key from before Bookmarks held projects: a Session's, `machine/session`. */
const isProjectKey = (k: unknown): k is ProjectKey => typeof k === "string" && k.split("/").length === 3;

export type GroupNode = { kind: "group"; id: string; label: string; children: LayoutNode[] };
export type SessionNode = { kind: "session"; key: SessionKey };
export type LayoutNode = GroupNode | SessionNode;

/** A Workspace the user keeps: the folder it was opened in, null when it had none. */
export interface KeptEntry {
  folder: string | null;
}

export interface Layout {
  tree: LayoutNode[];
  bookmarks: ProjectKey[];
  /** Workspaces to remember once they close, by ProjectKey. A build that does not know a field here
   *  still saves it back (ADR 0008). */
  kept?: Record<ProjectKey, KeptEntry>;
  /** What the file held under `kept` that this build cannot read: the entries of an unknown shape (an
   *  object by key), or the whole value when it is not an object. No reader looks at it; `fileLayout`
   *  writes it back (ADR 0008). */
  keptUnread?: unknown;
}

export const EMPTY_LAYOUT: Layout = { tree: [], bookmarks: [] };

export type NodeRef = { kind: "group"; id: string } | { kind: "session"; key: SessionKey };
export type Target =
  | { kind: "before" | "after"; ref: NodeRef }
  | { kind: "into"; groupId: string | null; first?: boolean };

const matches = (n: LayoutNode, ref: NodeRef): boolean =>
  sameRef(n.kind === "group" ? { kind: "group", id: n.id } : { kind: "session", key: n.key }, ref);

const sameRef = (a: NodeRef, b: NodeRef): boolean =>
  a.kind === "group" ? b.kind === "group" && a.id === b.id : b.kind === "session" && a.key === b.key;

function find(nodes: LayoutNode[], ref: NodeRef): LayoutNode | null {
  for (const n of nodes) {
    if (matches(n, ref)) return n;
    if (n.kind === "group") {
      const f = find(n.children, ref);
      if (f) return f;
    }
  }
  return null;
}

function findGroup(nodes: LayoutNode[], id: string): GroupNode | null {
  const n = find(nodes, { kind: "group", id });
  return n && n.kind === "group" ? n : null;
}

/** Remove the node everywhere it appears; returns a new array (unchanged branches are shared). */
function detach(nodes: LayoutNode[], ref: NodeRef): LayoutNode[] {
  let changed = false;
  const out: LayoutNode[] = [];
  for (const n of nodes) {
    if (matches(n, ref)) {
      changed = true;
      continue;
    }
    if (n.kind === "group") {
      const children = detach(n.children, ref);
      if (children !== n.children) {
        changed = true;
        out.push({ ...n, children });
        continue;
      }
    }
    out.push(n);
  }
  return changed ? out : nodes;
}

/** Insert next to `ref` (offset 0 = before, 1 = after). Returns null when `ref` is absent. */
function insertBeside(nodes: LayoutNode[], ref: NodeRef, offset: 0 | 1, node: LayoutNode): LayoutNode[] | null {
  const i = nodes.findIndex((n) => matches(n, ref));
  if (i >= 0) return [...nodes.slice(0, i + offset), node, ...nodes.slice(i + offset)];
  for (let j = 0; j < nodes.length; j++) {
    const n = nodes[j];
    if (n.kind !== "group") continue;
    const children = insertBeside(n.children, ref, offset, node);
    if (children) return [...nodes.slice(0, j), { ...n, children }, ...nodes.slice(j + 1)];
  }
  return null;
}

function insertInto(nodes: LayoutNode[], groupId: string, first: boolean, node: LayoutNode): LayoutNode[] | null {
  for (let j = 0; j < nodes.length; j++) {
    const n = nodes[j];
    if (n.kind !== "group") continue;
    let children: LayoutNode[] | null;
    if (n.id === groupId) children = first ? [node, ...n.children] : [...n.children, node];
    else children = insertInto(n.children, groupId, first, node);
    if (children) return [...nodes.slice(0, j), { ...n, children }, ...nodes.slice(j + 1)];
  }
  return null;
}

function sameTree(a: LayoutNode[], b: LayoutNode[]): boolean {
  return (
    a.length === b.length &&
    a.every((n, i) => {
      const m = b[i];
      if (n === m) return true;
      if (n.kind === "session") return m.kind === "session" && n.key === m.key;
      return m.kind === "group" && n.id === m.id && n.label === m.label && sameTree(n.children, m.children);
    })
  );
}

const refOfTarget = (t: Target): NodeRef | null =>
  t.kind === "into" ? (t.groupId === null ? null : { kind: "group", id: t.groupId }) : t.ref;

export function canMove(layout: Layout, node: NodeRef, target: Target): boolean {
  const ref = refOfTarget(target);
  // A node dropped on its own row would not move.
  if (ref && sameRef(node, ref)) return false;
  if (node.kind !== "group") return true;
  const self = findGroup(layout.tree, node.id);
  if (!self) return true;
  if (!ref) return true;
  if (matches(self, ref)) return false;
  return find(self.children, ref) === null;
}

export function moveNode(layout: Layout, node: NodeRef, target: Target, unplaced: SessionKey[] = []): Layout {
  if (!canMove(layout, node, target)) return layout;

  const known = new Set<SessionKey>();
  const collect = (nodes: LayoutNode[]) => {
    for (const n of nodes) {
      if (n.kind === "session") known.add(n.key);
      else collect(n.children);
    }
  };
  collect(layout.tree);
  const extra: SessionNode[] = [];
  for (const key of unplaced) {
    if (known.has(key)) continue;
    known.add(key);
    extra.push({ kind: "session", key });
  }
  const base = extra.length ? [...layout.tree, ...extra] : layout.tree;

  const moving = find(base, node);
  if (!moving) return layout;
  const rest = detach(base, node);

  let tree: LayoutNode[] | null;
  if (target.kind === "into") {
    tree =
      target.groupId === null
        ? target.first ? [moving, ...rest] : [...rest, moving]
        : insertInto(rest, target.groupId, !!target.first, moving);
  } else {
    tree = insertBeside(rest, target.ref, target.kind === "before" ? 0 : 1, moving);
  }
  if (!tree || (!extra.length && sameTree(tree, layout.tree))) return layout;
  return { ...layout, tree };
}

export function addGroup(layout: Layout, parentId: string | null, label: string): { layout: Layout; id: string | null } {
  const text = label.trim();
  if (!text) return { layout, id: null };
  const id = crypto.randomUUID();
  const group: GroupNode = { kind: "group", id, label: text, children: [] };
  const tree = parentId === null ? [...layout.tree, group] : insertInto(layout.tree, parentId, false, group);
  if (!tree) return { layout, id: null };
  return { layout: { ...layout, tree }, id };
}

function mapGroup(nodes: LayoutNode[], id: string, fn: (g: GroupNode) => LayoutNode[]): LayoutNode[] {
  let changed = false;
  const out: LayoutNode[] = [];
  for (const n of nodes) {
    if (n.kind !== "group") {
      out.push(n);
      continue;
    }
    if (n.id === id) {
      changed = true;
      out.push(...fn(n));
      continue;
    }
    const children = mapGroup(n.children, id, fn);
    if (children !== n.children) {
      changed = true;
      out.push({ ...n, children });
    } else out.push(n);
  }
  return changed ? out : nodes;
}

export function renameGroup(layout: Layout, id: string, label: string): Layout {
  const text = label.trim();
  if (!text) return layout;
  const current = findGroup(layout.tree, id);
  if (!current || current.label === text) return layout;
  const tree = mapGroup(layout.tree, id, (g) => [g.label === text ? g : { ...g, label: text }]);
  return tree === layout.tree ? layout : { ...layout, tree };
}

/** Delete a group; its children take its place. */
export function deleteGroup(layout: Layout, id: string): Layout {
  const tree = mapGroup(layout.tree, id, (g) => g.children);
  return tree === layout.tree ? layout : { ...layout, tree };
}

export function setBookmarked(layout: Layout, key: SessionKey, on: boolean, folder: string | null = null): Layout {
  const has = layout.bookmarks.includes(key);
  if (on === has) return layout;
  if (!on) return { ...layout, bookmarks: layout.bookmarks.filter((k) => k !== key) };
  const kept = layout.kept ?? {};
  // Bookmarking a Workspace keeps it too, with the folder it was opened in.
  return { ...layout, bookmarks: [...layout.bookmarks, key], kept: key in kept ? kept : { ...kept, [key]: { folder } } };
}

/** Keep a Workspace under its ProjectKey, with the folder it was opened in. */
export function setKept(layout: Layout, key: ProjectKey, folder: string | null): Layout {
  const kept = layout.kept ?? {};
  const current = kept[key];
  if (current && current.folder === folder) return layout;
  // Changing the folder merges into the entry, so fields this build does not know survive (ADR 0008).
  return { ...layout, kept: { ...kept, [key]: { ...(current as object | undefined), folder } as KeptEntry } };
}

/** Stop keeping a Workspace; its Bookmark goes with it. */
export function forgetKept(layout: Layout, key: ProjectKey): Layout {
  const current = layout.kept;
  const marked = layout.bookmarks.includes(key);
  if (!(current && key in current) && !marked) return layout;
  const bookmarks = marked ? layout.bookmarks.filter((k) => k !== key) : layout.bookmarks;
  if (!current || !(key in current)) return { ...layout, bookmarks };
  const kept: Record<ProjectKey, KeptEntry> = {};
  for (const [k, v] of Object.entries(current)) if (k !== key) kept[k] = v;
  return { ...layout, bookmarks, kept };
}

/** Move a kept Workspace and its Bookmark when its label changes, keeping the Bookmark's place. */
export function renameProjectKey(layout: Layout, from: ProjectKey, to: ProjectKey): Layout {
  if (from === to) return layout;
  const seen = new Set<ProjectKey>();
  const bookmarks: ProjectKey[] = [];
  for (const k of layout.bookmarks) {
    const mapped = k === from ? to : k;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    bookmarks.push(mapped);
  }
  const bookmarksUnchanged =
    bookmarks.length === layout.bookmarks.length && bookmarks.every((k, i) => k === layout.bookmarks[i]);
  const current = layout.kept;
  let kept = current;
  if (current && from in current) {
    const next: Record<ProjectKey, KeptEntry> = {};
    for (const [k, v] of Object.entries(current)) {
      if (k === from) {
        if (to in current) continue;
        next[to] = v;
      } else next[k] = v;
    }
    kept = next;
  }
  return bookmarksUnchanged && kept === layout.kept
    ? layout
    : { ...layout, bookmarks: bookmarksUnchanged ? layout.bookmarks : bookmarks, ...(kept ? { kept } : {}) };
}

/** Move a bookmark before `beforeKey`, or to the end when null. */
export function moveBookmark(layout: Layout, key: SessionKey, beforeKey: SessionKey | null): Layout {
  if (!layout.bookmarks.includes(key) || key === beforeKey) return layout;
  const rest = layout.bookmarks.filter((k) => k !== key);
  let at = rest.length;
  if (beforeKey !== null) {
    at = rest.indexOf(beforeKey);
    if (at < 0) return layout;
  }
  const bookmarks = [...rest.slice(0, at), key, ...rest.slice(at)];
  return bookmarks.every((k, i) => k === layout.bookmarks[i]) ? layout : { ...layout, bookmarks };
}

function forgetWhere(layout: Layout, drop: (key: SessionKey) => boolean): Layout {
  const prune = (nodes: LayoutNode[]): LayoutNode[] => {
    let changed = false;
    const out: LayoutNode[] = [];
    for (const n of nodes) {
      if (n.kind === "session") {
        if (drop(n.key)) changed = true;
        else out.push(n);
      } else {
        const children = prune(n.children);
        if (children !== n.children) {
          changed = true;
          out.push({ ...n, children });
        } else out.push(n);
      }
    }
    return changed ? out : nodes;
  };
  const tree = prune(layout.tree);
  const keptBookmarks = layout.bookmarks.filter((k) => !drop(sessionOf(k)));
  const bookmarks = keptBookmarks.length === layout.bookmarks.length ? layout.bookmarks : keptBookmarks;
  const current = layout.kept;
  let kept = current;
  if (current && Object.keys(current).some((k) => drop(sessionOf(k)))) {
    const next: Record<ProjectKey, KeptEntry> = {};
    for (const [k, v] of Object.entries(current)) if (!drop(sessionOf(k))) next[k] = v;
    kept = next;
  }
  return tree === layout.tree && bookmarks === layout.bookmarks && kept === layout.kept
    ? layout
    : { ...layout, tree, bookmarks, ...(kept ? { kept } : {}) };
}

export function forgetSessions(layout: Layout, keys: SessionKey[]): Layout {
  if (!keys.length) return layout;
  const set = new Set(keys);
  return forgetWhere(layout, (k) => set.has(k));
}

/** The renamed Session keeps its place in the tree and its bookmark. */
export function renameSessionKey(layout: Layout, from: SessionKey, to: SessionKey): Layout {
  if (from === to) return layout;
  const walk = (nodes: LayoutNode[]): LayoutNode[] => {
    let changed = false;
    const out = nodes.map((n): LayoutNode => {
      if (n.kind === "session") {
        if (n.key !== from) return n;
        changed = true;
        return { ...n, key: to };
      }
      const children = walk(n.children);
      if (children === n.children) return n;
      changed = true;
      return { ...n, children };
    });
    return changed ? out : nodes;
  };
  const tree = walk(layout.tree);
  const bookmarks = layout.bookmarks.some((k) => sessionOf(k) === from)
    ? layout.bookmarks.map((k) => (sessionOf(k) === from ? to + k.slice(from.length) : k))
    : layout.bookmarks;
  const current = layout.kept;
  let kept = current;
  if (current && Object.keys(current).some((k) => sessionOf(k) === from)) {
    const next: Record<ProjectKey, KeptEntry> = {};
    for (const [k, v] of Object.entries(current)) next[sessionOf(k) === from ? to + k.slice(from.length) : k] = v;
    kept = next;
  }
  return tree === layout.tree && bookmarks === layout.bookmarks && kept === layout.kept
    ? layout
    : { ...layout, tree, bookmarks, ...(kept ? { kept } : {}) };
}

export function forgetMachine(layout: Layout, machineId: string): Layout {
  const prefix = `${encodeURIComponent(machineId)}/`;
  return forgetWhere(layout, (k) => k.startsWith(prefix));
}

export function groupPaths(layout: Layout): { id: string; path: string }[] {
  const out: { id: string; path: string }[] = [];
  const walk = (nodes: LayoutNode[], prefix: string[]) => {
    for (const n of nodes) {
      if (n.kind !== "group") continue;
      const path = [...prefix, n.label];
      out.push({ id: n.id, path: path.join(" › ") });
      walk(n.children, path);
    }
  };
  walk(layout.tree, []);
  return out;
}

/** Where the layout lived before it moved to a file; read once to migrate, removed once the file holds it. */
export const LAYOUT_KEY = "drover:sidebar-layout";

// Session bookmarks from before ADR 0006 are dropped on read; the next change saves the layout without them.
// Kept entries naming something that is not a project, or with no folder, are dropped the same way.
function parseKept(v: unknown): { kept?: Record<ProjectKey, KeptEntry>; unread?: unknown } {
  if (v === undefined) return {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return { unread: v };
  const out: Record<ProjectKey, KeptEntry> = {};
  const unread: Record<string, unknown> = {};
  for (const [k, entry] of Object.entries(v as Record<string, unknown>)) {
    if (!isProjectKey(k)) continue;
    const parts = k.split("/");
    try {
      decodeURIComponent(parts[1]);
      decodeURIComponent(parts[2]);
    } catch {
      continue;
    }
    const folder = entry && typeof entry === "object" && !Array.isArray(entry) ? (entry as { folder?: unknown }).folder : undefined;
    if (typeof folder !== "string" && folder !== null) {
      // A shape this build does not understand is kept aside, not read, and written back as it was.
      unread[k] = entry;
      continue;
    }
    // Copy the entry, so fields this build does not know are written back unchanged (ADR 0008).
    out[k] = { ...(entry as Record<string, unknown>), folder } as KeptEntry;
  }
  return { kept: out, ...(Object.keys(unread).length ? { unread } : {}) };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * The layout as the file holds it: `keptUnread` goes back under `kept`. An entry this build now keeps
 * replaces an unreadable one at the same key, and a `kept` value that is not an object is replaced once
 * this build keeps a Workspace (it must write an object then); until then it is written back as it was.
 */
function fileLayout(l: Layout): Layout {
  const { keptUnread, ...rest } = l;
  if (keptUnread === undefined) return l;
  const kept = l.kept ?? {};
  if (isPlainObject(keptUnread)) return { ...rest, kept: { ...keptUnread, ...kept } as Record<ProjectKey, KeptEntry> };
  return Object.keys(kept).length === 0 ? ({ ...rest, kept: keptUnread } as unknown as Layout) : { ...rest, kept };
}

function parseLayout(v: unknown): Layout | null {
  const p = v as Partial<Layout> | null;
  if (!p || !Array.isArray(p.tree) || !Array.isArray(p.bookmarks)) return null;
  // `rest` keeps fields this build does not know, so the next save writes them back.
  const { kept: raw, keptUnread: _ignored, ...rest } = p;
  const { kept, unread } = parseKept(raw);
  return {
    ...rest,
    tree: p.tree,
    bookmarks: p.bookmarks.filter(isProjectKey),
    // A missing or malformed field reads as `{}` (the spec's rule), never as absent.
    kept: kept ?? {},
    ...(unread !== undefined ? { keptUnread: unread } : {}),
  };
}

/** The legacy localStorage layout; empty when missing, corrupt or unreadable. */
export function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return parseLayout(JSON.parse(raw)) ?? EMPTY_LAYOUT;
  } catch {
    /* storage unavailable or corrupt */
  }
  return EMPTY_LAYOUT;
}

const forgetLegacyLayout = () => {
  try {
    localStorage.removeItem(LAYOUT_KEY);
  } catch {
    /* storage unavailable */
  }
};

export interface LayoutIO {
  load: () => Promise<unknown>;
  save: (l: Layout) => Promise<void>;
}

// Null until `initLayout` read the file, so nothing can overwrite it with an unloaded layout.
let persist: ((l: Layout) => void) | null = null;

/** Load the layout file, migrating the localStorage layout when there is no file yet. */
export async function initLayout(io: LayoutIO): Promise<void> {
  persist = null;
  let stored: unknown;
  try {
    stored = await io.load();
  } catch (e) {
    // Keep the file as it is: show the old layout and save nothing this run.
    console.error("cannot read the sidebar layout file", e);
    useLayout.setState({ layout: loadLayout() });
    return;
  }
  let queue: Promise<boolean> = Promise.resolve(true);
  // Each write settles to whether it succeeded, so the queue never rejects.
  const write = (l: Layout) =>
    (queue = queue.then(() =>
      io.save(fileLayout(l)).then(
        () => true,
        (e) => {
          console.error("cannot save the sidebar layout", e);
          return false;
        },
      ),
    ));
  persist = (l) => void write(l);
  const saved = parseLayout(stored);
  if (saved) {
    useLayout.setState({ layout: saved });
    forgetLegacyLayout();
    return;
  }
  const legacy = loadLayout();
  useLayout.setState({ layout: legacy });
  if (legacy === EMPTY_LAYOUT) forgetLegacyLayout();
  // Drop the old key only once the file holds the layout.
  else void write(legacy).then((ok) => ok && forgetLegacyLayout());
}

interface LayoutState {
  layout: Layout;
  update: (fn: (l: Layout) => Layout) => void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  layout: EMPTY_LAYOUT,
  update: (fn) => {
    const prev = get().layout;
    const next = fn(prev);
    if (next === prev) return;
    set({ layout: next });
    persist?.(next);
  },
}));

export type RSession = { kind: "session"; key: SessionKey; machine: MachineView; session: SessionView };
/** A bookmarked project joined with its live Session, which is null while the Session is not known. */
export type RBookmark = { kind: "bookmark"; key: ProjectKey; label: string; sessionName: string; node: RSession | null };
export type RGroup = { kind: "group"; id: string; label: string; children: RNode[] };
export type RNode = RGroup | RSession;

/** Join the layout with live machines. Placed sessions that no longer exist are hidden (but stay
 *  in storage); sessions the layout has not placed are appended to the root in `order`. */
export function resolve(
  layout: Layout,
  machines: Record<string, MachineView>,
  order: string[],
): { tree: RNode[]; bookmarks: RBookmark[]; unplaced: SessionKey[] } {
  const live = new Map<SessionKey, RSession>();
  for (const id of order) {
    const machine = machines[id];
    if (!machine) continue;
    for (const session of machine.sessions) {
      const key = sessionKey(machine.id, session.name);
      live.set(key, { kind: "session", key, machine, session });
    }
  }

  const placed = new Set<SessionKey>();
  const build = (nodes: LayoutNode[]): RNode[] => {
    const out: RNode[] = [];
    for (const n of nodes) {
      if (n.kind === "group") {
        out.push({ kind: "group", id: n.id, label: n.label, children: build(n.children) });
      } else {
        placed.add(n.key);
        const r = live.get(n.key);
        if (r) out.push(r);
      }
    }
    return out;
  };
  const tree = build(layout.tree);

  // Sessions the layout has not placed come first: after the last Group they would read as its children.
  const unplaced: SessionKey[] = [];
  const loose: RNode[] = [];
  for (const [key, r] of live) {
    if (placed.has(key)) continue;
    unplaced.push(key);
    loose.push(r);
  }
  tree.unshift(...loose);

  // A bookmarked project stays when its Session or Workspace is gone: the row says it is closed.
  const bookmarks = layout.bookmarks.map((key): RBookmark => {
    const session = sessionOf(key);
    return {
      kind: "bookmark",
      key,
      label: decodeURIComponent(key.slice(session.length + 1)),
      sessionName: decodeURIComponent(session.slice(session.indexOf("/") + 1)),
      node: live.get(session) ?? null,
    };
  });
  return { tree, bookmarks, unplaced };
}
