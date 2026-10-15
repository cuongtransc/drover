import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenu, type MenuEntry } from "./ContextMenu";
import { CopyIcon } from "../ui/icons";

const item = (label: string) => ({ label, icon: CopyIcon, onSelect: () => {} });

describe("ContextMenu", () => {
  it("draws a line between groups, never at either end or twice in a row", () => {
    const items: MenuEntry[] = ["sep", item("A"), "sep", "sep", item("B"), "sep"];
    render(<ContextMenu x={0} y={0} items={items} onClose={() => {}} />);
    const menu = screen.getByRole("menu");
    const kinds = [...menu.children].map((li) => (li.getAttribute("role") === "separator" ? "sep" : li.textContent));
    expect(kinds).toEqual(["A", "sep", "B"]);
  });

  it("shows an item's keys at its end, and none for an item without", () => {
    render(<ContextMenu x={0} y={0} items={[{ ...item("A"), keys: "⌥⌘R" }, item("B")]} onClose={() => {}} />);
    const [a, b] = screen.getAllByRole("menuitem");
    expect(a.querySelector(".ctx-keys")?.textContent).toBe("⌥⌘R");
    expect(b.querySelector(".ctx-keys")).toBeNull();
    expect(a).toHaveProperty("textContent", "A⌥⌘R");
  });

  describe("near the window's edges", () => {
    // jsdom lays nothing out: the menu is 200×150 in an 800×600 window.
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(150);
      vi.stubGlobal("innerWidth", 800);
      vi.stubGlobal("innerHeight", 600);
    });
    afterEach(() => {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });
    const place = (x: number, y: number) => {
      render(<ContextMenu x={x} y={y} items={[item("A")]} onClose={() => {}} />);
      const { left, top, transformOrigin } = screen.getByRole("menu").style;
      return { left, top, transformOrigin };
    };

    it("opens at the pointer where it fits", () => {
      expect(place(100, 100)).toEqual({ left: "100px", top: "100px", transformOrigin: "left top" });
    });

    it("opens to the left of and above the pointer where it would cross the right and bottom edges", () => {
      expect(place(750, 580)).toEqual({ left: "550px", top: "430px", transformOrigin: "right bottom" });
    });

    it("stays inside a window too small to open either way", () => {
      vi.stubGlobal("innerWidth", 300);
      vi.stubGlobal("innerHeight", 200);
      expect(place(150, 100)).toEqual({ left: "8px", top: "8px", transformOrigin: "right bottom" });
    });
  });
});
