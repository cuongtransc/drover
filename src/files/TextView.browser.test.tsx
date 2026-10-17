import "../styles.css";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TextView } from "./TextView";

const long = "word ".repeat(200);
const text = ["short", long, "after"].join("\n");

function view(wrap: boolean) {
  const { container } = render(
    <div style={{ width: 400, height: 300, display: "flex", flexDirection: "column", ["--files-line-h" as string]: "20px" }}>
      <TextView text={text} path="a.txt" initialScroll={0} saveScroll={() => {}} find={null} wrap={wrap} />
    </div>,
  );
  const scroller = container.querySelector(".files-text") as HTMLElement;
  const rows = () => [...container.querySelectorAll<HTMLElement>(".files-line")];
  return { scroller, rows };
}

describe("TextView word wrap", () => {
  it("scrolls sideways when off", () => {
    const { scroller } = view(false);
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth);
  });

  it("wraps a long line within the width and keeps the next line below it", async () => {
    const { scroller, rows } = view(true);
    await expect.poll(() => rows()[1].getBoundingClientRect().height).toBeGreaterThan(100);
    expect(scroller.scrollWidth).toBe(scroller.clientWidth);
    const [, mid, after] = rows();
    expect(after.getBoundingClientRect().top).toBeCloseTo(mid.getBoundingClientRect().bottom, 0);
    // The line number sits on the first visual row of the wrapped line.
    const gutter = mid.querySelector(".files-gutter") as HTMLElement;
    expect(gutter.getBoundingClientRect().height).toBeLessThanOrEqual(21);
    expect(gutter.getBoundingClientRect().top).toBeCloseTo(mid.getBoundingClientRect().top, 0);
  });

  it("starts a search at the first match on screen when rows are wrapped", async () => {
    // Every other line wraps to several rows, so line index != scrollTop / line height.
    const lines = Array.from({ length: 60 }, (_, i) => (i % 2 ? long : i === 4 || i === 30 ? `foo ${i}` : `line ${i}`));
    const status = vi.fn();
    const props = { text: lines.join("\n"), path: "a.txt", initialScroll: 0, saveScroll: () => {}, onFindStatus: status, wrap: true };
    const box = { width: 400, height: 300, display: "flex", flexDirection: "column", ["--files-line-h" as string]: "20px" } as const;
    const { container, rerender } = render(<div style={box}><TextView {...props} find={null} /></div>);
    const scroller = container.querySelector(".files-text") as HTMLElement;
    const row = (i: number) => container.querySelector<HTMLElement>(`.files-line[data-index="${i}"]`);
    await expect.poll(() => row(1)?.getBoundingClientRect().height ?? 0).toBeGreaterThan(100);
    // Put line 10 at the top: line 4 is above the screen, so the search starts at line 30.
    scroller.scrollTop = row(10)!.offsetTop + Number(row(10)!.style.transform.match(/[\d.]+/)![0]);
    await expect.poll(() => row(10) !== null).toBe(true);
    rerender(<div style={box}><TextView {...props} find={{ query: "foo", index: 0, matchCase: false }} /></div>);
    expect(status).toHaveBeenLastCalledWith({ count: 2, index: 1 });
  });
});
