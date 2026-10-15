import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ComponentType, SVGProps } from "react";
import { PathInput } from "../ui/PathInput";
import { CheckIcon, LockIcon } from "../ui/icons";
import type { ProtectedPane } from "../agents/protect";
import type { BusyPane } from "../agents/paneFilter";

export interface MenuItem {
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  onSelect: () => void;
  /** A toggle: shown with a check while on. */
  checked?: boolean;
  disabled?: boolean;
  /** Says why the item is disabled, under it. */
  note?: string;
  /** Keys that do the same, in macOS symbols (`⌥⌘R`, `↩`): given as `aria-keyshortcuts`, never
   *  drawn. Apple's HIG puts keys in the main menus; a context menu is already the shortcut. */
  keys?: string;
}

const KEY_NAMES: Record<string, string> = { "⌃": "Control", "⌥": "Alt", "⇧": "Shift", "⌘": "Meta", "↩": "Enter" };

/** `⌥⌘R` as `aria-keyshortcuts` wants it: `Alt+Meta+R`. */
export function ariaKeys(keys: string): string {
  return [...keys].map((k) => KEY_NAMES[k] ?? k).join("+");
}

/** A menu row, or "sep": a line between groups. */
export type MenuEntry = MenuItem | "sep";

/** Lines only between items: none at either end, none twice in a row (a group may be empty). */
function grouped(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const it of items) {
    if (it === "sep" && (out.length === 0 || out[out.length - 1] === "sep")) continue;
    out.push(it);
  }
  if (out[out.length - 1] === "sep") out.pop();
  return out;
}

/** The gap kept between a menu and the window's edges. */
const EDGE = 8;

/**
 * Where a menu of `size` opens for a pointer at `at` in a window `room` long: at the pointer, or
 * ending at it when it would cross the far edge; inside the window either way.
 */
function fit(at: number, size: number, room: number): { pos: number; flipped: boolean } {
  const flipped = at + size > room - EDGE;
  const pos = flipped ? at - size : at;
  return { pos: Math.min(Math.max(pos, EDGE), room - EDGE - size), flipped };
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLUListElement>(null);
  const [place, setPlace] = useState({ left: x, top: y, transformOrigin: "left top" });
  // Measured before the first paint, so a menu near an edge never shows cut off.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = fit(x, el.offsetWidth, window.innerWidth);
    const v = fit(y, el.offsetHeight, window.innerHeight);
    setPlace({ left: h.pos, top: v.pos, transformOrigin: `${h.flipped ? "right" : "left"} ${v.flipped ? "bottom" : "top"}` });
  }, [x, y]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="overlay clear" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <ul ref={ref} className="ctx-menu" role="menu" style={place} onMouseDown={(e) => e.stopPropagation()}>
        {grouped(items).map((it, i) =>
          it === "sep" ? (
            <li key={`sep-${i}`} role="separator" className="ctx-sep" />
          ) : (
          <li key={it.label} role="none">
            <button
              role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={it.checked}
              aria-keyshortcuts={it.keys ? ariaKeys(it.keys) : undefined}
              disabled={it.disabled}
              onClick={() => {
                onClose();
                it.onSelect();
              }}
            >
              <it.icon />
              {it.label}
              {it.checked && <CheckIcon className="icon ctx-check" />}
            </button>
            {it.note && <div className="ctx-note">{it.note}</div>}
          </li>
          ),
        )}
      </ul>
    </div>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
  protectedPanes = [],
  cancelFirst = false,
  busyPanes = [],
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  /** Protected panes the action would close: listed, and Cancel takes the focus. */
  protectedPanes?: ProtectedPane[];
  /** Work would be lost (an agent working, a command running): Cancel takes the focus. */
  cancelFirst?: boolean;
  /** Panes with work running the action would end: listed, and Cancel takes the focus. */
  busyPanes?: BusyPane[];
}) {
  const guarded = protectedPanes.length > 0;
  const safe = guarded || cancelFirst || busyPanes.length > 0;
  return (
    <Modal title={title} onClose={onClose}>
      <p>{message}</p>
      {guarded && (
        <>
          <p>{protectedPanes.length === 1 ? "It holds a protected pane, which closes too:" : `It holds ${protectedPanes.length} protected panes, which close too:`}</p>
          <ul className="protected-list">
            {protectedPanes.map((p) => (
              <li key={p.key}>
                <LockIcon className="icon" />
                {p.title}
              </li>
            ))}
          </ul>
        </>
      )}
      {busyPanes.length > 0 && (
        <>
          <p>It has work running, which ends too:</p>
          <ul className="busy-list">
            {busyPanes.map((p) => (
              <li key={p.key}>
                {p.title}
                <span className="busy-note"> · {p.note}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="actions">
        {/* Safe: Cancel is the default (filled, focused); closing stays a plain button in red text. */}
        <button className={safe ? "btn btn-primary" : "btn"} autoFocus={safe} onClick={onClose}>Cancel</button>
        <button
          className={safe ? "btn btn-danger-text" : "btn btn-danger"}
          autoFocus={!safe}
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          {guarded ? "Unprotect and close" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function TextDialog({
  title,
  initial,
  submitLabel,
  folderOn,
  onSubmit,
  onClose,
}: {
  title: string;
  initial: string;
  submitLabel: string;
  /** Machine whose folders the field suggests, for a folder path. */
  folderOn?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.select(), []);
  const submit = () => {
    onClose();
    onSubmit(value);
  };
  return (
    <Modal title={title} onClose={onClose}>
      {folderOn ? (
        <PathInput
          machineId={folderOn}
          inputRef={ref}
          autoFocus
          value={value}
          aria-label={title}
          onChange={setValue}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      ) : (
        <input
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          ref={ref}
          autoFocus
          value={value}
          aria-label={title}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      )}
      <div className="actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={submit}>{submitLabel}</button>
      </div>
    </Modal>
  );
}
