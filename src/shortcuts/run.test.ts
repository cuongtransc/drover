import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
import { useLayout } from "../settings/layout";
import { runAction } from "./run";

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
});
