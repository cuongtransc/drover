import { beforeEach, describe, expect, it } from "vitest";
import { loadLayout, nextLayout, useLayout } from "./layout";

const KEY = "drover:settings";

beforeEach(() => {
  localStorage.clear();
  useLayout.setState({ layout: "normal" });
});

describe("loadLayout", () => {
  it("is normal when nothing is stored", () => {
    expect(loadLayout()).toBe("normal");
  });

  it("is normal when storage is corrupt or the value is unknown", () => {
    localStorage.setItem(KEY, "{nope");
    expect(loadLayout()).toBe("normal");
    localStorage.setItem(KEY, JSON.stringify({ layout: "wide" }));
    expect(loadLayout()).toBe("normal");
  });

  it("reads a stored layout", () => {
    localStorage.setItem(KEY, JSON.stringify({ layout: "focus" }));
    expect(loadLayout()).toBe("focus");
  });
});

describe("nextLayout", () => {
  it("⌘B hides and shows the sidebar, and leaves focus for the full layout", () => {
    expect(nextLayout("normal", "sidebar")).toBe("sidebar-hidden");
    expect(nextLayout("sidebar-hidden", "sidebar")).toBe("normal");
    expect(nextLayout("focus", "sidebar")).toBe("normal");
  });

  it("⌘⇧B enters focus from any layout and leaves it for the full layout", () => {
    expect(nextLayout("normal", "focus")).toBe("focus");
    expect(nextLayout("sidebar-hidden", "focus")).toBe("focus");
    expect(nextLayout("focus", "focus")).toBe("normal");
  });
});

describe("useLayout", () => {
  it("toggles and persists, keeping the other settings keys", () => {
    localStorage.setItem(KEY, JSON.stringify({ chatFontSize: 14 }));
    useLayout.getState().toggle("sidebar");
    expect(useLayout.getState().layout).toBe("sidebar-hidden");
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ chatFontSize: 14, layout: "sidebar-hidden" });
    useLayout.getState().toggle("focus");
    expect(loadLayout()).toBe("focus");
  });
});
