import { describe, expect, it } from "vitest";
import type { Chord } from "./chord";
import { actionFor } from "./dispatch";
import { DEFAULT_BINDINGS } from "./store";

const ev = (key: string, code: string, m: Partial<Record<"metaKey" | "shiftKey" | "altKey" | "ctrlKey", boolean>> = {}) =>
  ({ key, code, metaKey: true, shiftKey: false, altKey: false, ctrlKey: false, ...m }) as KeyboardEvent;
const c = (code: string, m: Partial<Chord> = {}): Chord => ({ code, shift: false, alt: false, ctrl: false, ...m });

describe("actionFor", () => {
  it("maps the default keys", () => {
    expect(actionFor(ev("k", "KeyK"), DEFAULT_BINDINGS)).toBe("jump");
    expect(actionFor(ev("J", "KeyJ", { shiftKey: true }), DEFAULT_BINDINGS)).toBe("triage.prev");
    expect(actionFor(ev("e", "KeyE"), DEFAULT_BINDINGS)).toBe("files.toggle");
    expect(actionFor(ev("ê", "KeyE"), DEFAULT_BINDINGS)).toBe("files.toggle");
    expect(actionFor(ev("}", "BracketRight", { shiftKey: true }), DEFAULT_BINDINGS)).toBe("item.next");
    expect(actionFor(ev("0", "Digit0"), DEFAULT_BINDINGS)).toBe("font.reset");
  });
  it("takes ⌘+ as Bigger font only while it is on ⌘=", () => {
    expect(actionFor(ev("+", "Equal", { shiftKey: true }), DEFAULT_BINDINGS)).toBe("font.bigger");
    const moved = { ...DEFAULT_BINDINGS, "font.bigger": c("KeyU") };
    expect(actionFor(ev("+", "Equal", { shiftKey: true }), moved)).toBeNull();
    expect(actionFor(ev("u", "KeyU"), moved)).toBe("font.bigger");
  });
  it("follows a rebinding and a None", () => {
    const b = { ...DEFAULT_BINDINGS, "files.toggle": c("KeyY"), jump: null };
    expect(actionFor(ev("e", "KeyE"), b)).toBeNull();
    expect(actionFor(ev("y", "KeyY"), b)).toBe("files.toggle");
    expect(actionFor(ev("k", "KeyK"), b)).toBeNull();
  });
  it("falls back to the character when the physical key means nothing: numpad, German ⌘+", () => {
    expect(actionFor(ev("+", "NumpadAdd"), DEFAULT_BINDINGS)).toBe("font.bigger");
    expect(actionFor(ev("-", "NumpadSubtract"), DEFAULT_BINDINGS)).toBe("font.smaller");
    expect(actionFor(ev("0", "Numpad0"), DEFAULT_BINDINGS)).toBe("font.reset");
    expect(actionFor(ev("+", "BracketRight"), DEFAULT_BINDINGS)).toBe("font.bigger");
    // The physical key wins when it is bound: no second action from the character.
    expect(actionFor(ev("ê", "KeyE"), DEFAULT_BINDINGS)).toBe("files.toggle");
  });

  it("ignores keys without ⌘ and unbound chords", () => {
    expect(actionFor(ev("e", "KeyE", { metaKey: false }), DEFAULT_BINDINGS)).toBeNull();
    expect(actionFor(ev("e", "KeyE", { altKey: true }), DEFAULT_BINDINGS)).toBeNull();
  });
});
