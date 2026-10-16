import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLayout } from "../settings/layout";
import { loadBindings, useShortcuts } from "../shortcuts/store";
import { LayoutControls } from "./LayoutControls";

afterEach(() => vi.unstubAllGlobals());

describe("LayoutControls", () => {
  beforeEach(() => {
    localStorage.clear();
    useShortcuts.setState({ bindings: loadBindings(), recording: false });
  });
  it("tells its container how far the first column's content must start, from its measured width", () => {
    let report: ((entries: { contentRect: { width: number } }[]) => void) | undefined;
    vi.stubGlobal("ResizeObserver", class {
      constructor(cb: typeof report) {
        report = cb;
      }
      observe() {}
      disconnect() {}
    });
    const { container } = render(<LayoutControls />);
    report?.([{ contentRect: { width: 120 } }]);
    // 78 px of traffic lights, the controls, then a 10 px gap.
    expect(container.style.getPropertyValue("--lead")).toBe("208px");
    report?.([{ contentRect: { width: 28 } }]);
    expect(container.style.getPropertyValue("--lead")).toBe("116px");
  });

  it("names the sidebar keys from the bindings, and none when unbound", () => {
    useLayout.setState({ layout: "normal" });
    act(() => useShortcuts.getState().set("layout.sidebar", { code: "KeyY", shift: false, alt: false, ctrl: false }));
    render(<LayoutControls />);
    expect(screen.getByRole("button", { name: "Hide sidebar" }).getAttribute("title")).toBe("Hide sidebar (⌘Y) · Focus (⇧⌘B)");
    act(() => {
      useShortcuts.getState().set("layout.sidebar", null);
      useShortcuts.getState().set("layout.focus", null);
    });
    expect(screen.getByRole("button", { name: "Hide sidebar" }).getAttribute("title")).toBe("Hide sidebar · Focus");
  });
});
