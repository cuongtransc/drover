import { describe, expect, it } from "vitest";
import { HERDR_INVERSE_PAIR, createInverseRewriter } from "./inverseRewrite";

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

// What herdr 0.9.1's `terminal attach` client emitted for
// `printf '\e[7mINVDEFAULT\e[0m  \e[1;36m\e[7mINVCYAN\e[0m  \e[1;36mCYAN\e[0m'` (captured 2026-10-13).
const CAPTURED =
  "\x1b[7;1H\x1b[0;38;2;0;0;0;48;2;255;255;255mINVDEFAULT\x1b[7;13H\x1b[0;1;38;2;0;0;0;48;5;6mINVCYAN" +
  "\x1b[7;22H\x1b[0;1;38;5;6;49mCYAN\x1b[0m";

describe("createInverseRewriter", () => {
  it("turns herdr's black-on-white pair back into SGR 7 and leaves every other SGR alone", () => {
    const out = text(createInverseRewriter()(bytes(CAPTURED)));
    expect(out).toBe(
      "\x1b[7;1H\x1b[0;7mINVDEFAULT\x1b[7;13H\x1b[0;1;38;2;0;0;0;48;5;6mINVCYAN\x1b[7;22H\x1b[0;1;38;5;6;49mCYAN\x1b[0m",
    );
    expect(out).not.toContain(HERDR_INVERSE_PAIR);
  });

  it("keeps the attributes around the pair", () => {
    const rw = createInverseRewriter();
    expect(text(rw(bytes("\x1b[0;1;4;38;2;0;0;0;48;2;255;255;255mx")))).toBe("\x1b[0;1;4;7mx");
    expect(text(rw(bytes("\x1b[38;2;0;0;0;48;2;255;255;255;4mx")))).toBe("\x1b[7;4mx");
    expect(text(rw(bytes("\x1b[38;2;0;0;0;48;2;255;255;255mx")))).toBe("\x1b[7mx");
  });

  it("does not touch a pair that is part of a longer parameter", () => {
    const rw = createInverseRewriter();
    const s = "\x1b[138;2;0;0;0;48;2;255;255;255mx\x1b[38;2;0;0;0;48;2;255;255;2550mx";
    expect(text(rw(bytes(s)))).toBe(s);
  });

  it("recognises a sequence split across chunks and holds nothing afterwards", () => {
    const rw = createInverseRewriter();
    const whole = "ab\x1b[0;38;2;0;0;0;48;2;255;255;255mINV\x1b[0m";
    for (const cut of [2, 3, 4, 10, 20, whole.length - 5]) {
      const r = createInverseRewriter();
      const first = r(bytes(whole.slice(0, cut)));
      const second = r(bytes(whole.slice(cut)));
      expect(text(first) + text(second)).toBe("ab\x1b[0;7mINV\x1b[0m");
    }
    expect(text(rw(bytes("plain")))).toBe("plain");
  });

  it("holds a trailing lone ESC and a short open CSI, flushes a long one", () => {
    const rw = createInverseRewriter();
    expect(text(rw(bytes("tail\x1b")))).toBe("tail");
    expect(text(rw(bytes("[0m")))).toBe("\x1b[0m");
    expect(text(rw(bytes("x\x1b[1;2")))).toBe("x");
    expect(text(rw(bytes(";3mz")))).toBe("\x1b[1;2;3mz");
    const long = "\x1b[" + "1;".repeat(40);
    expect(text(rw(bytes(long)))).toBe(long);
  });

  it("passes UTF-8 and non-SGR escapes through byte for byte", () => {
    const rw = createInverseRewriter();
    const s = "sửa lỗi ✓ \x1b]8;;\x1b\\\x1b[?25h\x1b[12;3H\x1bM\x1b[0;39;49m→";
    expect(rw(bytes(s))).toEqual(bytes(s));
  });
});
