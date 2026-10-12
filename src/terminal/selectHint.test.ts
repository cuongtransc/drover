import { afterEach, describe, expect, it, vi } from "vitest";
import { applyDragHint, applyOptionCursor, createHintBudget, DRAG_HINT_PX, DRAG_HINT_RUNS } from "./selectHint";

const KEY = "drover:settings";

afterEach(() => localStorage.clear());

function mouse(target: EventTarget, type: string, init: MouseEventInit) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));
}

describe("createHintBudget", () => {
  it("allows one hint per run", () => {
    const take = createHintBudget();
    expect(take()).toBe(true);
    expect(take()).toBe(false);
  });

  it("stops after the first few runs", () => {
    for (let i = 0; i < DRAG_HINT_RUNS; i++) expect(createHintBudget()()).toBe(true);
    expect(createHintBudget()()).toBe(false);
  });

  it("keeps other settings", () => {
    localStorage.setItem(KEY, JSON.stringify({ notifications: false }));
    createHintBudget()();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ notifications: false, dragHintRuns: 1 });
  });

  it("treats corrupt storage as zero runs", () => {
    localStorage.setItem(KEY, "{");
    expect(createHintBudget()()).toBe(true);
  });
});

describe("applyDragHint", () => {
  function setup(tracking = true) {
    const host = document.createElement("div");
    const inner = document.createElement("div");
    host.appendChild(inner);
    document.body.appendChild(host);
    const show = vi.fn();
    const dispose = applyDragHint(host, () => tracking, show, () => true);
    return { host, inner, show, dispose };
  }

  it("hints when a plain drag goes to the program", () => {
    const { inner, show } = setup();
    mouse(inner, "mousedown", { button: 0, clientX: 10, clientY: 10 });
    mouse(inner, "mousemove", { buttons: 1, clientX: 10 + DRAG_HINT_PX - 1, clientY: 10 });
    expect(show).not.toHaveBeenCalled();
    mouse(inner, "mousemove", { buttons: 1, clientX: 10 + DRAG_HINT_PX + 1, clientY: 10 });
    expect(show).toHaveBeenCalledOnce();
    mouse(inner, "mousemove", { buttons: 1, clientX: 50, clientY: 50 });
    expect(show).toHaveBeenCalledOnce();
  });

  it("does not hint a click, an Option drag or a drag without mouse reporting", () => {
    const a = setup();
    mouse(a.inner, "mousedown", { button: 0, clientX: 0, clientY: 0 });
    mouse(window, "mouseup", { button: 0 });
    mouse(a.inner, "mousemove", { clientX: 40, clientY: 0 });
    mouse(a.inner, "mousedown", { button: 0, altKey: true, clientX: 0, clientY: 0 });
    mouse(a.inner, "mousemove", { buttons: 1, altKey: true, clientX: 40, clientY: 0 });
    expect(a.show).not.toHaveBeenCalled();
    const b = setup(false);
    mouse(b.inner, "mousedown", { button: 0, clientX: 0, clientY: 0 });
    mouse(b.inner, "mousemove", { buttons: 1, clientX: 40, clientY: 0 });
    expect(b.show).not.toHaveBeenCalled();
  });

  it("asks the budget before showing", () => {
    const host = document.createElement("div");
    const show = vi.fn();
    applyDragHint(host, () => true, show, () => false);
    mouse(host, "mousedown", { button: 0, clientX: 0, clientY: 0 });
    mouse(host, "mousemove", { buttons: 1, clientX: 40, clientY: 0 });
    expect(show).not.toHaveBeenCalled();
  });

  it("stops once disposed", () => {
    const { inner, show, dispose } = setup();
    dispose();
    mouse(inner, "mousedown", { button: 0, clientX: 0, clientY: 0 });
    mouse(inner, "mousemove", { buttons: 1, clientX: 40, clientY: 0 });
    expect(show).not.toHaveBeenCalled();
  });
});

describe("applyOptionCursor", () => {
  const key = (type: string, init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent(type, init));

  it("marks the host while Option is held", () => {
    const host = document.createElement("div");
    const dispose = applyOptionCursor(host);
    key("keydown", { key: "Alt", altKey: true });
    expect(host.classList.contains("term-select")).toBe(true);
    key("keyup", { key: "Alt", altKey: false });
    expect(host.classList.contains("term-select")).toBe(false);
    key("keydown", { key: "Alt", altKey: true });
    window.dispatchEvent(new Event("blur"));
    expect(host.classList.contains("term-select")).toBe(false);
    dispose();
    key("keydown", { key: "Alt", altKey: true });
    expect(host.classList.contains("term-select")).toBe(false);
  });
});
