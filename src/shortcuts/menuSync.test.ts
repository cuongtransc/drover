import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({ menuSetShortcuts: vi.fn(async () => {}) }));
import { menuSetShortcuts } from "../lib/ipc";
import { startMenuSync } from "./menuSync";
import { DEFAULT_BINDINGS, useShortcuts } from "./store";

describe("startMenuSync", () => {
  beforeEach(() => {
    vi.mocked(menuSetShortcuts).mockClear();
    useShortcuts.setState({ bindings: DEFAULT_BINDINGS, recording: false });
  });

  it("sends the bindings at start and on every change", () => {
    const stop = startMenuSync();
    expect(menuSetShortcuts).toHaveBeenLastCalledWith(DEFAULT_BINDINGS, true);
    const next = { ...DEFAULT_BINDINGS, jump: { code: "KeyL", shift: false, alt: false, ctrl: false } };
    useShortcuts.setState({ bindings: next });
    expect(menuSetShortcuts).toHaveBeenLastCalledWith(next, true);
    stop();
  });

  it("clears every key while Settings records one, and restores them after", () => {
    const stop = startMenuSync();
    useShortcuts.setState({ recording: true });
    const [cleared, fileKeys] = vi.mocked(menuSetShortcuts).mock.lastCall!;
    // File's own keys go too, or ⌥⌘C would copy a path instead of reaching the recorder.
    expect(fileKeys).toBe(false);
    expect(Object.keys(cleared)).toEqual(Object.keys(DEFAULT_BINDINGS));
    expect(Object.values(cleared).every((c) => c === null)).toBe(true);
    useShortcuts.setState({ recording: false });
    expect(menuSetShortcuts).toHaveBeenLastCalledWith(DEFAULT_BINDINGS, true);
    stop();
  });

  it("sends nothing for a change that touches neither", () => {
    const stop = startMenuSync();
    const n = vi.mocked(menuSetShortcuts).mock.calls.length;
    useShortcuts.setState({ bindings: useShortcuts.getState().bindings });
    expect(vi.mocked(menuSetShortcuts).mock.calls.length).toBe(n);
    stop();
  });
});
