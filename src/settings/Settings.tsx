import { type CSSProperties, memo, type PointerEvent, useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { notificationsEnabled, setNotificationsEnabled } from "../notify";
import { CloseIcon, GearIcon, GripIcon, SearchIcon } from "../ui/icons";
import { FontPicker } from "./FontPicker";
import { ShortcutsSettings } from "./ShortcutsSettings";
import { DEFAULT_HIDDEN_FOLDERS, folderNameError, useHiddenFolders } from "./hiddenFolders";
import { CHAT_WIDTHS, NEW_AGENT_LENSES, useLensSettings } from "./lens";
import { useNewTab } from "./newTab";
import { AGENTS } from "../agents/openAgentTab";
import { ACTIVE_MINUTES, idleLabel, useActiveWindow } from "../agents/paneFilter";
import { useShowDefault } from "../sidebar/activeFilter";
import { DEFAULT_QUICK_REPLIES, moveReply, moveReplyTo, QUICK_REPLIES_MAX, QUICK_REPLY_MAX_CHARS, slotAt, useQuickReplies } from "./quickReplies";
import { CHAT_SIZE, DEFAULTS, TERM_SIZE, useSettings } from "./store";
import { THEME_PREFS, useTheme } from "./theme";
import { useShortcutLabel } from "../shortcuts/store";

/** How far one press of − or + moves a font size, in px. */
const SIZE_STEP = 0.5;

function Stepper({
  label,
  value,
  range,
  onChange,
}: {
  label: string;
  value: number;
  range: { min: number; max: number };
  onChange: (v: number) => void;
}) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <div className="stepper">
        <button aria-label={`Decrease ${label.toLowerCase()}`} disabled={value <= range.min} onClick={() => onChange(value - SIZE_STEP)}>
          −
        </button>
        <output>{value}px</output>
        <button aria-label={`Increase ${label.toLowerCase()}`} disabled={value >= range.max} onClick={() => onChange(value + SIZE_STEP)}>
          +
        </button>
      </div>
    </div>
  );
}

function GeneralSettings() {
  const [notify, setNotify] = useState(notificationsEnabled);
  const newTab = useNewTab();
  const tabKey = useShortcutLabel("tabs.new");
  const active = useActiveWindow();
  const showDefault = useShowDefault();
  return (
    <>
      <div className="setting-row">
        <span id="new-tab-label">{tabKey ? `New tab (${tabKey}) opens` : "New tab opens"}</span>
        <div
          className="seg seg-n"
          role="group"
          aria-labelledby="new-tab-label"
          style={{ "--n": AGENTS.length, "--i": AGENTS.indexOf(newTab.agent) } as CSSProperties}
        >
          <span className="seg-thumb" />
          {AGENTS.map((a) => (
            <button key={a} aria-pressed={a === newTab.agent} onClick={() => newTab.setAgent(a)}>
              {a}
            </button>
          ))}
        </div>
      </div>
      <p className="note">{tabKey ? `${tabKey} opens a tab` : "A new tab opens"} next to the selected pane, in its workspace's folder.</p>
      <div className="setting-row">
        <span id="active-window-label">Active window</span>
        <div
          className="seg seg-n"
          role="group"
          aria-labelledby="active-window-label"
          style={{ "--n": ACTIVE_MINUTES.length, "--i": ACTIVE_MINUTES.indexOf(active.minutes as (typeof ACTIVE_MINUTES)[number]) } as CSSProperties}
        >
          <span className="seg-thumb" />
          {ACTIVE_MINUTES.map((m) => (
            <button key={m} aria-pressed={m === active.minutes} onClick={() => active.setMinutes(m)}>
              {idleLabel(m * 60_000)}
            </button>
          ))}
        </div>
      </div>
      <p className="note">How long an idle agent stays in Active, in Sessions and Panes. Blocked, working and unread Done agents always stay.</p>
      <label className="switch">
        <span>Show herdr's default session</span>
        <input type="checkbox" role="switch" checked={showDefault.show} onChange={(e) => showDefault.setShow(e.target.checked)} />
      </label>
      <p className="note">The session herdr starts when run without a name, on each machine. Off, Sessions lists it only while an agent runs in it.</p>
      <label className="switch">
        <span>Notifications</span>
        <input
          type="checkbox"
          role="switch"
          checked={notify}
          onChange={(e) => {
            setNotify(e.target.checked);
            setNotificationsEnabled(e.target.checked);
          }}
        />
      </label>
      <p className="note">
        For exact chat binding, run <code>herdr integration install claude</code> / <code>pi</code> on each machine.
      </p>
    </>
  );
}

function AppearanceSettings() {
  const pref = useTheme((s) => s.pref);
  const setPref = useTheme((s) => s.setPref);
  const i = THEME_PREFS.findIndex((t) => t.id === pref);
  return (
    <>
      <div className="setting-row">
        <span id="theme-label">Theme</span>
        <div
          className="seg seg-n"
          role="group"
          aria-labelledby="theme-label"
          style={{ "--n": THEME_PREFS.length, "--i": i } as CSSProperties}
        >
          <span className="seg-thumb" />
          {THEME_PREFS.map((t) => (
            <button key={t.id} aria-pressed={t.id === pref} onClick={() => setPref(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <p className="note">System follows the macOS appearance.</p>
    </>
  );
}

function FontSettings() {
  const s = useSettings();
  const zoomKeys = [useShortcutLabel("font.bigger"), useShortcutLabel("font.smaller"), useShortcutLabel("font.reset")].filter(Boolean);
  const isDefault =
    s.terminalFontFamily === DEFAULTS.terminalFontFamily &&
    s.terminalFontSize === DEFAULTS.terminalFontSize &&
    s.chatFontSize === DEFAULTS.chatFontSize &&
    s.chatFontFamily === DEFAULTS.chatFontFamily &&
    s.chatMonoFamily === DEFAULTS.chatMonoFamily;
  return (
    <>
      <FontPicker label="Terminal font" value={s.terminalFontFamily} onChange={(f) => s.set({ terminalFontFamily: f })} />
      <Stepper label="Terminal size" value={s.terminalFontSize} range={TERM_SIZE} onChange={(v) => s.set({ terminalFontSize: v })} />
      <FontPicker label="Chat font" monospace={false} value={s.chatFontFamily} onChange={(f) => s.set({ chatFontFamily: f })} />
      <FontPicker label="Chat code font" value={s.chatMonoFamily} onChange={(f) => s.set({ chatMonoFamily: f })} />
      <Stepper label="Chat size" value={s.chatFontSize} range={CHAT_SIZE} onChange={(v) => s.set({ chatFontSize: v })} />
      {zoomKeys.length > 0 && <p className="note">{zoomKeys.join(" / ")} size the font of the Terminal or Chat on screen.</p>}
      <p className="note">Lists the fonts installed on this Mac; the code pickers only monospace ones. JetBrains Mono is bundled, covers Vietnamese, and stands in for a code font that is missing.</p>
      <div className="settings-foot">
        <button className="btn btn-xs" aria-label="Reset fonts" disabled={isDefault} onClick={s.reset}>
          Reset to defaults
        </button>
      </div>
    </>
  );
}

function ChatSettings() {
  const q = useQuickReplies();
  const lens = useLensSettings();
  const list = useRef<HTMLDivElement>(null);
  const added = useRef(false);
  // Focus the row just added, so typing goes straight into it.
  useEffect(() => {
    if (!added.current) return;
    added.current = false;
    list.current?.querySelector<HTMLInputElement>(".quick-reply-row:last-child input")?.focus();
  }, [q.replies.length]);
  // A row moved from the keyboard keeps focus where it was (the field or the grip): rows are keyed by
  // position, so focus that control at the row's new place.
  const moved = useRef<{ at: number; selector: string } | null>(null);
  useEffect(() => {
    if (!moved.current) return;
    list.current?.querySelectorAll<HTMLElement>(`.quick-reply-row ${moved.current.selector}`)[moved.current.at]?.focus();
    moved.current = null;
  }, [q.replies]);
  const move = (i: number, by: -1 | 1, selector: string) => {
    const next = moveReply(q.replies, i, by);
    if (next === q.replies) return;
    moved.current = { at: i + by, selector };
    q.setReplies(next);
  };

  // Dragging by the grip: the row follows the pointer and the list reorders as its middle passes a
  // neighbour's. Slots are measured once at the press; rows share one height.
  const [drag, setDrag] = useState<{ at: number; dy: number } | null>(null);
  const dragging = useRef<{ at: number; grab: number; tops: number[]; mids: number[]; height: number } | null>(null);
  const startDrag = (i: number, e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const rects = [...(list.current?.querySelectorAll<HTMLElement>(".quick-reply-row") ?? [])].map((r) => r.getBoundingClientRect());
    if (!rects[i]) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragging.current = {
      at: i,
      grab: e.clientY - rects[i].top,
      tops: rects.map((r) => r.top),
      mids: rects.map((r) => r.top + r.height / 2),
      height: rects[i].height,
    };
    setDrag({ at: i, dy: 0 });
  };
  const moveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    const d = dragging.current;
    if (!d) return;
    const top = e.clientY - d.grab;
    const to = slotAt(top + d.height / 2, d.mids);
    if (to !== d.at) {
      q.setReplies(moveReplyTo(useQuickReplies.getState().replies, d.at, to));
      d.at = to;
    }
    setDrag({ at: d.at, dy: top - d.tops[d.at] });
  };
  const endDrag = () => {
    dragging.current = null;
    setDrag(null);
  };
  const isDefault = q.replies.length === DEFAULT_QUICK_REPLIES.length && q.replies.every((r, i) => r === DEFAULT_QUICK_REPLIES[i]);
  return (
    <>
      <div className="setting-row">
        <span id="new-agent-lens-label">New agent opens in</span>
        <div
          className="seg seg-n"
          role="group"
          aria-labelledby="new-agent-lens-label"
          style={{ "--n": NEW_AGENT_LENSES.length, "--i": NEW_AGENT_LENSES.indexOf(lens.newAgentLens) } as CSSProperties}
        >
          <span className="seg-thumb" />
          {NEW_AGENT_LENSES.map((l) => (
            <button key={l} aria-pressed={l === lens.newAgentLens} onClick={() => lens.setNewAgentLens(l)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <p className="note">Terminal keeps a new agent on the Terminal until you switch. Chat opens it on Chat once it has started, where you can type its first prompt.</p>
      <div className="setting-row">
        <span id="chat-width-label">Chat width</span>
        <div
          className="seg seg-n"
          role="group"
          aria-labelledby="chat-width-label"
          style={{ "--n": CHAT_WIDTHS.length, "--i": CHAT_WIDTHS.indexOf(lens.chatWidth) } as CSSProperties}
        >
          <span className="seg-thumb" />
          {CHAT_WIDTHS.map((w) => (
            <button key={w} aria-pressed={w === lens.chatWidth} onClick={() => lens.setChatWidth(w)}>
              {w}
            </button>
          ))}
        </div>
      </div>
      <p className="note">Comfortable keeps a reading column; Wide gives tables and code more room; Full fills the pane.</p>
      <label className="switch">
        <span>Quick replies</span>
        <input type="checkbox" role="switch" checked={q.show} onChange={(e) => q.setShow(e.target.checked)} />
      </label>
      <p className="note">Buttons above the message box that send a short reply in one click. Drag to reorder, or ⌥↑ / ⌥↓.</p>
      <div className="quick-reply-list" ref={list}>
        {q.replies.map((r, i) => (
          <div
            key={i}
            className={drag?.at === i ? "quick-reply-row dragging" : "quick-reply-row"}
            style={drag?.at === i ? { transform: `translateY(${drag.dy}px)` } : undefined}
          >
            <button
              className="quick-reply-grip"
              aria-label={`Reorder quick reply ${i + 1}`}
              title="Drag to reorder (↑ / ↓ when focused)"
              onPointerDown={(e) => startDrag(i, e)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(e) => {
                if (e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
                if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                e.preventDefault();
                move(i, e.key === "ArrowUp" ? -1 : 1, ".quick-reply-grip");
              }}
            >
              <GripIcon />
            </button>
            <input
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              aria-label={`Quick reply ${i + 1}`}
              value={r}
              maxLength={QUICK_REPLY_MAX_CHARS}
              placeholder="Reply text"
              onChange={(e) => q.setReplies(q.replies.map((x, j) => (j === i ? e.target.value : x)))}
              onKeyDown={(e) => {
                if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
                if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                e.preventDefault();
                move(i, e.key === "ArrowUp" ? -1 : 1, "input");
              }}
            />
            <button className="icon-btn" aria-label={`Remove quick reply ${i + 1}`} onClick={() => q.setReplies(q.replies.filter((_, j) => j !== i))}>
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
      <div className="settings-foot">
        <button
          className="btn btn-xs"
          aria-label="Add quick reply"
          disabled={q.replies.length >= QUICK_REPLIES_MAX}
          onClick={() => {
            added.current = true;
            q.setReplies([...q.replies, ""]);
          }}
        >
          Add reply
        </button>
        <button className="btn btn-xs" aria-label="Reset quick replies" disabled={isDefault} onClick={q.reset}>
          Reset to defaults
        </button>
      </div>
    </>
  );
}

function FilesSettings() {
  const h = useHiddenFolders();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isDefault = h.folders.length === DEFAULT_HIDDEN_FOLDERS.length && h.folders.every((f, i) => f === DEFAULT_HIDDEN_FOLDERS[i]);
  const add = () => {
    const why = folderNameError(draft, h.folders);
    setError(why);
    if (why === null && h.add(draft)) setDraft("");
  };
  return (
    <>
      <div className="setting-row">
        <span id="hidden-folders-label">Hidden folders</span>
      </div>
      <p className="note">
        Left out of the Files tree, Go to file, <code>@</code> completion and auto-refresh, on every Machine. The eye button in the Files panel shows them in the tree for a while.
      </p>
      <ul className="hidden-folder-list" aria-label="Hidden folders">
        {h.folders.map((f) => (
          <li key={f} className="hidden-folder">
            <span>{f}</span>
            <button className="icon-btn" aria-label={`Remove ${f}`} onClick={() => h.remove(f)}>
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
      <div className="hidden-folder-add">
        <input
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="Folder name"
          placeholder="Folder name, e.g. coverage"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn btn-xs" aria-label="Add folder" onClick={add}>
          Add
        </button>
      </div>
      {error && (
        <p className="note hidden-folder-error" role="alert">
          {error}
        </p>
      )}
      <p className="note">A name matches a folder of exactly that name at any depth; files with the name stay listed.</p>
      <div className="settings-foot">
        <button className="btn btn-xs" aria-label="Reset hidden folders" disabled={isDefault} onClick={h.reset}>
          Reset to defaults
        </button>
      </div>
    </>
  );
}

/** Add a section here for each new group of settings. */
const SECTIONS = [
  { id: "general", label: "General", Body: GeneralSettings },
  { id: "appearance", label: "Appearance", Body: AppearanceSettings },
  { id: "fonts", label: "Fonts", Body: FontSettings },
  { id: "chat", label: "Chat", Body: ChatSettings },
  { id: "files", label: "Files", Body: FilesSettings },
  { id: "shortcuts", label: "Shortcuts", Body: ShortcutsSettings },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<SectionId>("general");
  const section = SECTIONS.find((x) => x.id === active) ?? SECTIONS[0];
  const ref = useRef<HTMLDivElement>(null);
  // Focus the dialog so Escape reaches it (autoFocus only applies to form controls).
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        ref={ref}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <nav className="settings-nav" role="tablist" aria-orientation="vertical">
          <div className="settings-nav-title">Settings</div>
          {SECTIONS.map((x) => (
            <button
              key={x.id}
              role="tab"
              aria-selected={x.id === active}
              className={x.id === active ? "active" : undefined}
              onClick={() => setActive(x.id)}
            >
              {x.label}
            </button>
          ))}
        </nav>
        <section className="settings-body" role="tabpanel" aria-label={section.label}>
          <header className="settings-head">
            <h3>{section.label}</h3>
            <button className="icon-btn" aria-label="Close settings" onClick={onClose}>
              ×
            </button>
          </header>
          <section.Body />
        </section>
      </div>
    </div>
  );
}

/** Whether the Settings dialog is open: the gear button and the app menu's Settings… ⌘, both open it. */
export const useSettingsOpen = create<{ open: boolean; show: () => void; hide: () => void }>((setState) => ({
  open: false,
  show: () => setState({ open: true }),
  hide: () => setState({ open: false }),
}));

// Takes no props: memo keeps it out of App's re-renders; it reads the store itself.
export const Settings = memo(function Settings() {
  const { open, show, hide } = useSettingsOpen();
  const jumpKey = useShortcutLabel("jump");
  return (
    <div className="settings">
      {open && <SettingsDialog onClose={hide} />}
      <button className="icon-btn" aria-label="Settings" aria-expanded={open} onClick={show}>
        <GearIcon />
      </button>
      {jumpKey && (
        <span className="settings-hint">
          <SearchIcon /> Jump <kbd>{jumpKey}</kbd>
        </span>
      )}
    </div>
  );
});
