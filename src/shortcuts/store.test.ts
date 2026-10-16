import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ACTIONS } from "./actions";
import type { Chord } from "./chord";
import { checkChord, DEFAULT_BINDINGS, loadBindings, useShortcutLabel, useShortcuts } from "./store";

const KEY = "drover:settings";
const c = (code: string, m: Partial<Chord> = {}): Chord => ({ code, shift: false, alt: false, ctrl: false, ...m });
const s = () => useShortcuts.getState();

beforeEach(() => {
  localStorage.clear();
  useShortcuts.setState({ bindings: loadBindings(), recording: false });
});

describe("shortcuts store", () => {
  it("defaults to the spec's keys", () => {
    expect(ACTIONS.map((a) => a.id)).toEqual([
      "jump", "triage.next", "triage.prev", "board", "tabs.new", "layout.sidebar", "layout.focus", "lens.toggle",
      "files.toggle", "files.goto", "item.prev", "item.next", "item.remove", "font.bigger", "font.smaller", "font.reset",
    ]);
    expect(DEFAULT_BINDINGS["files.toggle"]).toEqual(c("KeyE"));
    expect(DEFAULT_BINDINGS["item.prev"]).toEqual(c("BracketLeft", { shift: true }));
    expect(DEFAULT_BINDINGS["font.smaller"]).toEqual(c("Minus"));
    expect(ACTIONS.find((a) => a.id === "item.remove")!.label).toBe("Remove Open item");
  });

  it("saves only what differs from the defaults, next to the other settings", () => {
    localStorage.setItem(KEY, JSON.stringify({ hiddenFolders: ["out"] }));
    s().set("files.toggle", c("KeyY"));
    s().set("board", null);
    const saved = JSON.parse(localStorage.getItem(KEY)!);
    expect(saved.hiddenFolders).toEqual(["out"]);
    expect(saved.shortcuts).toEqual({ "files.toggle": c("KeyY"), board: null });
    s().set("files.toggle", c("KeyE"));
    expect(JSON.parse(localStorage.getItem(KEY)!).shortcuts).toEqual({ board: null });
    expect(loadBindings().board).toBeNull();
  });

  it("drops unknown ids, broken and reserved chords, and later duplicates on load", () => {
    localStorage.setItem(KEY, JSON.stringify({ shortcuts: {
      nope: c("KeyY"),
      board: { code: 7 },
      "tabs.new": c("KeyQ"),
      "files.goto": c("KeyY"),
      "files.toggle": c("KeyY"),
      "layout.sidebar": c("KeyE"),
    } }));
    const b = loadBindings();
    expect(b.board).toEqual(DEFAULT_BINDINGS.board);
    expect(b["tabs.new"]).toEqual(DEFAULT_BINDINGS["tabs.new"]);
    // files.toggle comes before files.goto in the table: it keeps ⌘Y, files.goto keeps its default.
    expect(b["files.toggle"]).toEqual(c("KeyY"));
    expect(b["files.goto"]).toEqual(DEFAULT_BINDINGS["files.goto"]);
    expect(b["layout.sidebar"]).toEqual(c("KeyE"));
    expect(Object.values(b).filter((x) => x?.code === "KeyE")).toHaveLength(1);
  });

  it("survives settings that are not JSON", () => {
    localStorage.setItem(KEY, "{");
    expect(loadBindings()).toEqual(DEFAULT_BINDINGS);
  });

  it("checks a chord: reserved, used by another action, or fine", () => {
    const b = DEFAULT_BINDINGS;
    expect(checkChord(c("KeyQ"), b, "files.toggle")).toEqual({ refused: "Reserved by macOS" });
    expect(checkChord(c("KeyK"), b, "files.toggle")).toEqual({ usedBy: "jump" });
    expect(checkChord(c("KeyE"), b, "files.toggle")).toEqual({ ok: true });
    expect(checkChord(c("KeyY"), b, "files.toggle")).toEqual({ ok: true });
  });

  it("replace moves the chord and leaves the other action on None", () => {
    s().replace("files.toggle", c("KeyK"));
    expect(s().bindings["files.toggle"]).toEqual(c("KeyK"));
    expect(s().bindings.jump).toBeNull();
    s().reset("jump");
    expect(s().bindings.jump).toEqual(c("KeyK"));
    expect(s().bindings["files.toggle"]).toBeNull();
    s().resetAll();
    expect(s().bindings).toEqual(DEFAULT_BINDINGS);
    expect(JSON.parse(localStorage.getItem(KEY)!).shortcuts).toEqual({});
  });

  it("labels an action by its binding, null for None", () => {
    const { result } = renderHook(() => useShortcutLabel("layout.sidebar"));
    expect(result.current).toBe("⌘B");
    act(() => s().set("layout.sidebar", c("KeyB", { alt: true })));
    expect(result.current).toBe("⌥⌘B");
    act(() => s().set("layout.sidebar", null));
    expect(result.current).toBeNull();
  });
});
