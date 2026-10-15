/**
 * herdr's `terminal attach` client never learns its host terminal's default colours
 * (herdrdev/herdr#5220), so the server resolves reverse video on default colours to literal black
 * on white. A zsh menu cursor, a less prompt or a vim status line then arrives as
 * `ESC[0;38;2;0;0;0;48;2;255;255;255m`: a white box, invisible on Drover's light background. This
 * turns that one pair back into SGR 7, so xterm inverts the current theme's own colours.
 *
 * Only the exact pair is touched, so a program that really asks for black on white is drawn
 * inverted instead; a readable box either way. Remove once herdr's attach client reports its host
 * theme.
 */

const ESC = 0x1b;
const CSI_OPEN = 0x5b; // [
const SGR_FINAL = 0x6d; // m
/** Bytes a CSI parameter string is made of: 0-9, ;, and the private markers up to ?. */
const isParam = (b: number) => b >= 0x30 && b <= 0x3f;

/** The fg/bg pair herdr emits for inverse on default colours, as SGR parameters. */
export const HERDR_INVERSE_PAIR = "38;2;0;0;0;48;2;255;255;255";
/** An unfinished CSI longer than this is not an SGR of interest; it is passed through. */
const MAX_HELD = 64;

const ascii = (buf: Uint8Array, from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));

function concat(parts: Uint8Array[], total: number): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/**
 * A stateful rewriter for one attach stream. Each call returns the bytes to write now; a CSI cut
 * off at the end of a chunk (at most MAX_HELD bytes) is held and prepended to the next chunk, so
 * a split sequence is still recognised.
 */
export function createInverseRewriter(): (chunk: Uint8Array) => Uint8Array {
  let held = new Uint8Array(0);
  return (chunk) => {
    const buf = held.byteLength ? concat([held, chunk], held.byteLength + chunk.byteLength) : chunk;
    held = new Uint8Array(0);
    const parts: Uint8Array[] = [];
    let total = 0;
    const push = (p: Uint8Array) => {
      parts.push(p);
      total += p.byteLength;
    };
    let start = 0; // first byte not yet pushed
    let i = 0;
    const len = buf.byteLength;
    while (i < len) {
      if (buf[i] !== ESC) {
        i++;
        continue;
      }
      if (i + 1 >= len) {
        // A lone trailing ESC: hold it.
        push(buf.subarray(start, i));
        held = buf.slice(i);
        return concat(parts, total);
      }
      if (buf[i + 1] !== CSI_OPEN) {
        i += 2;
        continue;
      }
      let j = i + 2;
      while (j < len && isParam(buf[j])) j++;
      if (j >= len) {
        if (j - i <= MAX_HELD) {
          push(buf.subarray(start, i));
          held = buf.slice(i);
          return concat(parts, total);
        }
        break;
      }
      if (buf[j] === SGR_FINAL) {
        const params = ascii(buf, i + 2, j);
        const at = params.indexOf(HERDR_INVERSE_PAIR);
        if (at >= 0) {
          const next = params[at + HERDR_INVERSE_PAIR.length];
          const prev = at === 0 ? ";" : params[at - 1];
          if (prev === ";" && (next === undefined || next === ";")) {
            push(buf.subarray(start, i));
            const rewritten = `\x1b[${params.slice(0, at)}7${params.slice(at + HERDR_INVERSE_PAIR.length)}m`;
            push(Uint8Array.from(rewritten, (c) => c.charCodeAt(0)));
            start = j + 1;
          }
        }
      }
      i = j + 1;
    }
    push(buf.subarray(start));
    return concat(parts, total);
  };
}
