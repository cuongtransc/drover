import { describe, expect, it } from "vitest";
import { chordOf, formatChord, isChord, reservedReason, sameChord, type Chord } from "./chord";

const ev = (key: string, code: string, mods: Partial<Record<"metaKey" | "shiftKey" | "altKey" | "ctrlKey", boolean>> = {}) => ({
  key, code, metaKey: true, shiftKey: false, altKey: false, ctrlKey: false, ...mods,
});
const c = (code: string, m: Partial<Chord> = {}): Chord => ({ code, shift: false, alt: false, ctrl: false, ...m });

describe("chordOf", () => {
  it("reads the physical key and the modifiers", () => {
    expect(chordOf(ev("e", "KeyE"))).toEqual(c("KeyE"));
    expect(chordOf(ev("{", "BracketLeft", { shiftKey: true }))).toEqual(c("BracketLeft", { shift: true }));
    expect(chordOf(ev("+", "Equal", { shiftKey: true }))).toEqual(c("Equal", { shift: true }));
    expect(chordOf(ev("e", "KeyE", { altKey: true, ctrlKey: true }))).toEqual(c("KeyE", { alt: true, ctrl: true }));
  });
  it("keeps the physical key when an input method changes the character", () => {
    expect(chordOf(ev("ê", "KeyE"))).toEqual(c("KeyE"));
  });
  it("derives the code from the key when the event has none", () => {
    expect(chordOf(ev("b", ""))).toEqual(c("KeyB"));
    expect(chordOf(ev("B", "", { shiftKey: true }))).toEqual(c("KeyB", { shift: true }));
    expect(chordOf(ev("0", ""))).toEqual(c("Digit0"));
    expect(chordOf(ev("]", ""))).toEqual(c("BracketRight"));
    expect(chordOf(ev("-", ""))).toEqual(c("Minus"));
  });
  it("waits for a key when only modifiers are down, and says when ⌘ is missing", () => {
    expect(chordOf(ev("Meta", "MetaLeft"))).toBeNull();
    expect(chordOf(ev("Shift", "ShiftLeft", { shiftKey: true }))).toBeNull();
    expect(chordOf(ev("b", "KeyB", { metaKey: false, ctrlKey: true }))).toBe("no-meta");
  });
});

describe("formatChord", () => {
  it("writes macOS order then the key", () => {
    expect(formatChord(c("KeyE"))).toBe("⌘E");
    expect(formatChord(c("BracketLeft", { shift: true }))).toBe("⇧⌘[");
    expect(formatChord(c("Minus"))).toBe("⌘−");
    expect(formatChord(c("Equal"))).toBe("⌘=");
    expect(formatChord(c("Digit0"))).toBe("⌘0");
    expect(formatChord(c("KeyK", { ctrl: true, alt: true, shift: true }))).toBe("⌃⌥⇧⌘K");
  });
});

describe("reservedReason", () => {
  it("refuses what macOS and Drover's fixed keys own", () => {
    expect(reservedReason(c("KeyQ"))).toBe("Reserved by macOS");
    expect(reservedReason(c("KeyH", { alt: true }))).toBe("Reserved by macOS");
    expect(reservedReason(c("KeyZ", { shift: true }))).toBe("Reserved by macOS");
    expect(reservedReason(c("Space"))).toBe("Reserved by macOS");
    expect(reservedReason(c("Comma"))).toBe("Reserved by Drover: Settings");
    expect(reservedReason(c("KeyF"))).toBe("Reserved by Drover: Find");
    expect(reservedReason(c("KeyG"))).toBe("Reserved by Drover: Find next");
    expect(reservedReason(c("KeyG", { shift: true }))).toBe("Reserved by Drover: Find previous");
    expect(reservedReason(c("KeyR"))).toBe("Reserved by Drover: Reload");
    expect(reservedReason(c("KeyF", { ctrl: true }))).toBe("Reserved by macOS");
    expect(reservedReason(c("Space", { ctrl: true }))).toBe("Reserved by macOS");
    expect(reservedReason(c("KeyQ", { shift: true }))).toBe("Reserved by macOS");
  });
  it("leaves the rest free, including other modifiers on a reserved key", () => {
    expect(reservedReason(c("KeyE"))).toBeNull();
    expect(reservedReason(c("KeyR", { shift: true }))).toBeNull();
    expect(reservedReason(c("KeyQ", { alt: true }))).toBeNull();
  });
});

describe("sameChord / isChord", () => {
  it("compares every field and checks stored shapes", () => {
    expect(sameChord(c("KeyE"), c("KeyE"))).toBe(true);
    expect(sameChord(c("KeyE"), c("KeyE", { shift: true }))).toBe(false);
    expect(sameChord(null, c("KeyE"))).toBe(false);
    expect(isChord(c("KeyE"))).toBe(true);
    expect(isChord({ code: 3, shift: false, alt: false, ctrl: false })).toBe(false);
    expect(isChord({ code: "KeyE" })).toBe(false);
    expect(isChord(null)).toBe(false);
  });
});
