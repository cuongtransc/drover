/** A Shortcut's keys: ⌘ (always held) with these modifiers and one physical key (`KeyboardEvent.code`). */
export interface Chord {
  code: string;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "shiftKey" | "altKey" | "ctrlKey">;

const MODIFIER_KEYS = new Set(["Meta", "Shift", "Alt", "Control", "CapsLock", "Fn", "OS"]);

const CODE_OF_KEY: Record<string, string> = {
  "[": "BracketLeft",
  "{": "BracketLeft",
  "]": "BracketRight",
  "}": "BracketRight",
  "=": "Equal",
  "+": "Equal",
  "-": "Minus",
  _: "Minus",
  ",": "Comma",
  "`": "Backquote",
  " ": "Space",
  Tab: "Tab",
};

/** The US-layout code of a key's character: for events without a code (tests), and for `actionFor`'s
 *  fallback when the physical key is bound to nothing. "" when there is none. */
export function codeFromKey(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return CODE_OF_KEY[key] ?? "";
}

/**
 * The chord an event makes. By `code`, so input methods (EVKey, Unikey) and keyboard layouts that
 * change `key` still match. Null while only modifiers are down; "no-meta" when ⌘ is not held.
 */
export function chordOf(e: KeyEventLike): Chord | "no-meta" | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const code = e.code || codeFromKey(e.key);
  if (!code) return null;
  if (!e.metaKey) return "no-meta";
  return { code, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey };
}

export function sameChord(a: Chord | null, b: Chord | null): boolean {
  if (!a || !b) return false;
  return a.code === b.code && a.shift === b.shift && a.alt === b.alt && a.ctrl === b.ctrl;
}

export function isChord(v: unknown): v is Chord {
  if (!v || typeof v !== "object") return false;
  const c = v as Record<string, unknown>;
  return typeof c.code === "string" && c.code !== "" && typeof c.shift === "boolean" && typeof c.alt === "boolean" && typeof c.ctrl === "boolean";
}

const KEY_LABELS: Record<string, string> = {
  BracketLeft: "[",
  BracketRight: "]",
  Equal: "=",
  Minus: "−",
  Comma: ",",
  Backquote: "`",
  Space: "Space",
  Tab: "Tab",
};

/** macOS order, ⌃⌥⇧⌘, then the key: `⇧⌘[`, `⌘E`. */
export function formatChord(c: Chord): string {
  const key = c.code.startsWith("Key") ? c.code.slice(3) : c.code.startsWith("Digit") ? c.code.slice(5) : (KEY_LABELS[c.code] ?? c.code);
  return `${c.ctrl ? "⌃" : ""}${c.alt ? "⌥" : ""}${c.shift ? "⇧" : ""}⌘${key}`;
}

const chord = (code: string, m: Partial<Chord> = {}): Chord => ({ code, shift: false, alt: false, ctrl: false, ...m });

/** Chords macOS or Drover's fixed keys own, with why they cannot be a Shortcut. */
const RESERVED: [Chord, string][] = [
  ...[chord("KeyQ"), chord("KeyQ", { shift: true }), chord("KeyF", { ctrl: true }), chord("Space", { ctrl: true }), chord("KeyH"), chord("KeyH", { alt: true }), chord("KeyM"), chord("Tab"), chord("Space"), chord("Backquote")].map(
    (c): [Chord, string] => [c, "Reserved by macOS"],
  ),
  ...[chord("KeyC"), chord("KeyV"), chord("KeyX"), chord("KeyA"), chord("KeyZ"), chord("KeyZ", { shift: true })].map(
    (c): [Chord, string] => [c, "Reserved by macOS"],
  ),
  [chord("Comma"), "Reserved by Drover: Settings"],
  [chord("KeyF"), "Reserved by Drover: Find"],
  [chord("KeyG"), "Reserved by Drover: Find next"],
  [chord("KeyG", { shift: true }), "Reserved by Drover: Find previous"],
  [chord("KeyR"), "Reserved by Drover: Reload"],
];

export function reservedReason(c: Chord): string | null {
  return RESERVED.find(([r]) => sameChord(r, c))?.[1] ?? null;
}
