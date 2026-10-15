import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
import { useLayout } from "../settings/layout";
import { runAction, runMenuAction } from "./run";

describe("runAction", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("runs the action a menu item names", () => {
    useLayout.setState({ layout: "normal" });
    expect(runAction("layout.sidebar", { setPaletteOpen: () => {} })).not.toBe(false);
    expect(useLayout.getState().layout).toBe("sidebar-hidden");
  });

  it("leaves a dialog its keys: KEPT_BY_DIALOGS actions do nothing under an overlay", () => {
    document.body.innerHTML = '<div class="overlay"></div>';
    expect(runAction("files.goto", { setPaletteOpen: () => {} })).toBe(false);
  });

  it("opens the palette for jump", () => {
    const open = vi.fn();
    runAction("jump", { setPaletteOpen: open });
    expect(open).toHaveBeenCalled();
  });

  // macOS repeats a menu key while it is held: only the actions a held key may repeat run again.
  it("drops a held key's repeat, except for the actions that repeat", () => {
    useLayout.setState({ layout: "normal" });
    expect(runMenuAction("layout.sidebar", true, { setPaletteOpen: () => {} })).toBe(false);
    expect(useLayout.getState().layout).toBe("normal");
    const open = vi.fn();
    expect(runMenuAction("jump", false, { setPaletteOpen: open })).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(runMenuAction("jump", true, { setPaletteOpen: open })).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});
