import "../styles.css";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftKey, useDrafts } from "./drafts";
import { FileEditor } from "./FileEditor";
import { createEditorState } from "./editorSetup";

const key = draftKey("fk", "a.ts");
const text = "const a = 1;\nlet b = 2;\n";

// getComputedStyle gives rgb()/rgba() or color(srgb r g b / a); both are read as 0..255 channels.
function channels(css: string): [number, number, number, number] {
  const m = css.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const [r, g, b, a = "1"] = m[1].split(/[,/\s]+/).filter(Boolean);
    return [+r, +g, +b, +a];
  }
  const c = css.match(/^color\(srgb ([^)]+)\)$/);
  if (c) {
    const [r, g, b, a = "1"] = c[1].split(/[\s/]+/).filter(Boolean);
    return [+r * 255, +g * 255, +b * 255, +a];
  }
  throw new Error("unparsed colour: " + css);
}
const luminance = ([r, g, b]: number[]) => {
  const [R, G, B] = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};
const contrast = (fg: string, bg: string) => {
  const [l1, l2] = [luminance(channels(fg)), luminance(channels(bg))].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
};

describe.each(["light", "dark"])("FileEditor colours in the %s theme", (theme) => {
  beforeEach(() => {
    document.documentElement.dataset.theme = theme;
    useDrafts.setState(useDrafts.getInitialState(), true);
    useDrafts.getState().open({ fk: "fk", machineId: "m", root: "/r", rel: "a.ts" }, { text, size: text.length, mtime: 1, cksum: 1 }, createEditorState(text));
  });

  it("keeps every text colour at 4.5:1 or more against the editor background", async () => {
    const { container } = render(
      <div style={{ height: 300, display: "flex" }}>
        <FileEditor draftKey={key} />
      </div>,
    );
    const q = (sel: string) => container.querySelector(sel) as HTMLElement;
    const keyword = await vi.waitFor(() => {
      const el = [...container.querySelectorAll<HTMLElement>(".cm-content span")].find((s) => s.textContent === "const" && s.className);
      expect(el, "highlighted keyword span").toBeTruthy();
      return el!;
    });
    const bg = getComputedStyle(q(".cm-editor")).backgroundColor;
    expect(channels(bg)[3]).toBe(1);
    const colours: Record<string, string> = {
      content: getComputedStyle(q(".cm-content")).color,
      lineNumbers: getComputedStyle(q(".cm-lineNumbers")).color,
      keyword: getComputedStyle(keyword).color,
    };
    for (const [name, fg] of Object.entries(colours)) {
      expect(contrast(fg, bg), `${name} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
