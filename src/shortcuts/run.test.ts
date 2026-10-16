import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), Channel: class {} }));
import { useLayout } from "../settings/layout";
import { paneKey } from "../lib/types";
import type { MachineView } from "../lib/types";
import { chosenLens, useApp } from "../store/app";
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

describe("lens.toggle", () => {
  const panes = [
    { pane_id: "w1:p1", terminal_id: "term_a", title: "claude", cwd: "/x", agent: "claude", status: "working" },
    { pane_id: "w1:p2", terminal_id: "term_b", title: "zsh", cwd: "/x", agent: null, status: "idle" },
  ];
  const machine = {
    id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "working",
    sessions: [{ name: "default", running: true, loaded: true, status: "working", error: null, workspaces: [
      { workspace_id: "w1", label: "drover", number: 1, status: "working", tabs: [
        { tab_id: "w1:t1", label: "1", number: 1, status: "working", panes },
      ] },
    ] }],
  } as MachineView;
  const agentPane = { machine_id: "local", session: "default", pane_id: "w1:p1" };
  const shellPane = { machine_id: "local", session: "default", pane_id: "w1:p2" };
  const toggle = () => runAction("lens.toggle", { setPaletteOpen: () => {} });

  beforeEach(() => {
    document.body.innerHTML = "";
    useApp.setState({ machines: { local: machine }, order: ["local"], selected: agentPane, lens: {}, lensOverride: {} });
  });

  it("turns an agent pane on Chat to Terminal, then back to Chat", () => {
    useApp.getState().setLens(paneKey(agentPane), "chat");
    expect(toggle()).toBe(true);
    expect(chosenLens(useApp.getState(), paneKey(agentPane))).toBe("terminal");
    expect(toggle()).toBe(true);
    expect(chosenLens(useApp.getState(), paneKey(agentPane))).toBe("chat");
  });

  it("toggles from the lens shown when none was picked (Claude opens on Chat)", () => {
    expect(toggle()).toBe(true);
    expect(chosenLens(useApp.getState(), paneKey(agentPane))).toBe("terminal");
  });

  it("does nothing on a pane with no agent, or with no pane selected", () => {
    useApp.setState({ selected: shellPane });
    expect(toggle()).toBe(false);
    expect(chosenLens(useApp.getState(), paneKey(shellPane))).toBeUndefined();
    useApp.setState({ selected: null });
    expect(toggle()).toBe(false);
  });
});
