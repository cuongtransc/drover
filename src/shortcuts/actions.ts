import type { Chord } from "./chord";

export type ActionId =
  | "jump"
  | "triage.next"
  | "triage.prev"
  | "board"
  | "layout.sidebar"
  | "layout.focus"
  | "lens.toggle"
  | "tabs.new"
  | "files.toggle"
  | "files.goto"
  | "item.remove"
  | "item.prev"
  | "item.next"
  | "font.bigger"
  | "font.smaller"
  | "font.reset";

const key = (code: string, shift = false): Chord => ({ code, shift, alt: false, ctrl: false });

export const ACTION_GROUPS = ["Agents", "Layout", "Files", "Open items", "Font size"] as const;
export type ActionGroup = (typeof ACTION_GROUPS)[number];

/** Every Shortcut, in Settings' order, grouped; an earlier action wins a clash in stored settings. */
export const ACTIONS: readonly { id: ActionId; label: string; group: ActionGroup; default: Chord }[] = [
  { id: "jump", label: "Jump to pane", group: "Agents", default: key("KeyK") },
  { id: "triage.next", label: "Next Blocked or Review", group: "Agents", default: key("KeyJ") },
  { id: "triage.prev", label: "Previous Blocked or Review", group: "Agents", default: key("KeyJ", true) },
  { id: "board", label: "Agent Board", group: "Agents", default: key("KeyD", true) },
  { id: "tabs.new", label: "New tab", group: "Agents", default: key("KeyT") },
  { id: "layout.sidebar", label: "Toggle sidebar", group: "Layout", default: key("KeyB") },
  { id: "layout.focus", label: "Focus layout", group: "Layout", default: key("KeyB", true) },
  { id: "lens.toggle", label: "Toggle Terminal/Chat", group: "Layout", default: key("KeyL") },
  { id: "files.toggle", label: "Toggle Files panel", group: "Files", default: key("KeyE") },
  { id: "files.goto", label: "Go to file", group: "Files", default: key("KeyP") },
  { id: "item.prev", label: "Previous Open item", group: "Open items", default: key("BracketLeft", true) },
  { id: "item.next", label: "Next Open item", group: "Open items", default: key("BracketRight", true) },
  { id: "item.remove", label: "Remove Open item", group: "Open items", default: key("KeyW") },
  { id: "font.bigger", label: "Bigger font", group: "Font size", default: key("Equal") },
  { id: "font.smaller", label: "Smaller font", group: "Font size", default: key("Minus") },
  { id: "font.reset", label: "Default font size", group: "Font size", default: key("Digit0") },
];
