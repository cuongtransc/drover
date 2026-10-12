/** Shared with settings/*.ts: one JSON object, each writer merges its own keys. */
const SETTINGS_KEY = "drover:settings";

export const OUTLINE_MIN = 200;
export const OUTLINE_MAX = 420;
export const OUTLINE_DEFAULT = 260;

export function clampOutlineWidth(px: number): number {
  return Math.round(Math.min(OUTLINE_MAX, Math.max(OUTLINE_MIN, px)));
}

function readRaw(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The outline rail's width, the same in every pane. */
export function loadOutlineWidth(): number {
  const w = readRaw().outlineWidth;
  return typeof w === "number" && Number.isFinite(w) ? clampOutlineWidth(w) : OUTLINE_DEFAULT;
}

export function saveOutlineWidth(px: number): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readRaw(), outlineWidth: clampOutlineWidth(px) }));
  } catch {
    /* ignore */
  }
}

/** Whether the outline rail is collapsed to a strip, the same in every pane. */
export function loadOutlineCollapsed(): boolean {
  return readRaw().outlineCollapsed === true;
}

export function saveOutlineCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readRaw(), outlineCollapsed: collapsed }));
  } catch {
    /* ignore */
  }
}

export const BTW_MIN = 280;
export const BTW_MAX = 640;
export const BTW_DEFAULT = 360;

export function clampBtwWidth(px: number): number {
  return Math.round(Math.min(BTW_MAX, Math.max(BTW_MIN, px)));
}

/** The /btw column's width, the same in every pane. */
export function loadBtwWidth(): number {
  const w = readRaw().btwWidth;
  return typeof w === "number" && Number.isFinite(w) ? clampBtwWidth(w) : BTW_DEFAULT;
}

export function saveBtwWidth(px: number): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readRaw(), btwWidth: clampBtwWidth(px) }));
  } catch {
    /* ignore */
  }
}
