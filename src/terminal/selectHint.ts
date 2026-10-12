const SETTINGS_KEY = "drover:settings";

/** A drag this far, in pixels, is a selection attempt rather than a shaky click. */
export const DRAG_HINT_PX = 8;

/** App runs that may show the hint; by then the Option drag is known. */
export const DRAG_HINT_RUNS = 3;

function readRuns(): number {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const n = raw ? (JSON.parse(raw) as { dragHintRuns?: unknown }).dragHintRuns : 0;
    return typeof n === "number" ? n : 0;
  } catch {
    return 0;
  }
}

function writeRuns(n: number): void {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    let prev: Record<string, unknown> = {};
    try {
      prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      /* ignore corrupt */
    }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...prev, dragHintRuns: n }));
  } catch {
    /* storage unavailable */
  }
}

/** Allows the hint once per run, for the first DRAG_HINT_RUNS runs. */
export function createHintBudget(): () => boolean {
  let used = false;
  return () => {
    if (used) return false;
    const runs = readRuns();
    if (runs >= DRAG_HINT_RUNS) return false;
    used = true;
    writeRuns(runs + 1);
    return true;
  };
}

/** Shared by every terminal, so a run shows the hint once however many panes are open. */
export const takeDragHint = createHintBudget();

/**
 * Calls `show` when a plain drag goes to the program because it turned on mouse reporting, the
 * moment someone expects a selection and gets none. Capture phase, ahead of xterm's handlers.
 * Returns a disposer.
 */
export function applyDragHint(
  host: HTMLElement,
  tracking: () => boolean,
  show: () => void,
  take: () => boolean = takeDragHint,
): () => void {
  let start: { x: number; y: number } | null = null;
  const onDown = (e: MouseEvent) => {
    start = e.button === 0 && !e.altKey && tracking() ? { x: e.clientX, y: e.clientY } : null;
  };
  const onMove = (e: MouseEvent) => {
    if (!start) return;
    if (!(e.buttons & 1) || e.altKey) {
      start = null;
      return;
    }
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= DRAG_HINT_PX) return;
    start = null;
    if (take()) show();
  };
  const onUp = () => {
    start = null;
  };
  host.addEventListener("mousedown", onDown, true);
  host.addEventListener("mousemove", onMove, true);
  window.addEventListener("mouseup", onUp, true);
  return () => {
    host.removeEventListener("mousedown", onDown, true);
    host.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
  };
}

/** Marks `host` with `term-select` while Option is held, so the cursor shows that a drag selects. */
export function applyOptionCursor(host: HTMLElement): () => void {
  const set = (on: boolean) => host.classList.toggle("term-select", on);
  const onKey = (e: KeyboardEvent) => set(e.altKey);
  const onBlur = () => set(false);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keyup", onKey, true);
  window.addEventListener("blur", onBlur);
  return () => {
    set(false);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKey, true);
    window.removeEventListener("blur", onBlur);
  };
}
