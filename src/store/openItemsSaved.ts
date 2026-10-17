import { itemKey, NO_ITEMS, type OpenItem, type OpenItems } from "./openItems";

/** The Open items as last shown; written on every change, read once at launch. */
const KEY = "drover:open-items";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown, keys: string[]) => isObj(v) && keys.every((k) => typeof v[k] === "string");

function toItem(v: unknown): OpenItem | null {
  if (!isObj(v)) return null;
  if (v.kind === "agent" && strings(v.ref, ["machine_id", "session", "pane_id"])) {
    const r = v.ref as Record<string, string>;
    return { kind: "agent", ref: { machine_id: r.machine_id, session: r.session, pane_id: r.pane_id } };
  }
  if (v.kind === "file" && strings(v.ws, ["machine_id", "session", "workspace_id"]) && strings(v, ["root", "rel"])) {
    const w = v.ws as Record<string, string>;
    return { kind: "file", ws: { machine_id: w.machine_id, session: w.session, workspace_id: w.workspace_id }, root: v.root as string, rel: v.rel as string };
  }
  return null;
}

/** What was saved, keeping only well-formed items; nothing saved or unreadable → no items. */
export function loadOpenItems(): OpenItems {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    if (!isObj(p) || !Array.isArray(p.items)) return NO_ITEMS;
    const items = p.items.map(toItem).filter((i): i is OpenItem => i !== null);
    const keys = new Set(items.map(itemKey));
    const keep = (k: unknown) => (typeof k === "string" && keys.has(k) ? k : null);
    return { items, preview: keep(p.preview), active: keep(p.active) };
  } catch {
    return NO_ITEMS;
  }
}

export function saveOpenItems(s: OpenItems): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
