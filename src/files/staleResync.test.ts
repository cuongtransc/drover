import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MachineView, PaneStatusEvent } from "../lib/types";

let emit: ((e: PaneStatusEvent) => void) | null = null;
vi.mock("../lib/ipc", () => ({
  onPaneStatus: vi.fn(async (cb: (e: PaneStatusEvent) => void) => {
    emit = cb;
    return () => {
      emit = null;
    };
  }),
}));
import { useApp } from "../store/app";
import { shouldResync, useStaleResync } from "./staleResync";

const pane = (pane_id: string) => ({ pane_id, terminal_id: "t", title: "", cwd: null, agent: "claude", status: "idle" as const });
const machine = (id: string, kind: string): MachineView => ({
  id,
  label: id,
  kind,
  state: "connected" as MachineView["state"],
  error: null,
  version: null,
  status: "idle",
  sessions: [
    {
      name: "s",
      running: true,
      loaded: true,
      status: "idle",
      error: null,
      workspaces: [
        { workspace_id: "w1", label: "a", number: 1, status: "idle", tabs: [{ tab_id: "t1", label: "", number: 1, status: "idle", panes: [pane("p1")] }] },
        { workspace_id: "w2", label: "b", number: 2, status: "idle", tabs: [{ tab_id: "t2", label: "", number: 1, status: "idle", panes: [pane("p2")] }] },
      ],
    },
  ],
});
const machines = { local: machine("local", "local"), box: machine("box", "ssh") };
const ws = { machine_id: "local", session: "s", workspace_id: "w1" };
const ev = (pane_id: string, previous: PaneStatusEvent["status"], status: PaneStatusEvent["status"], machine_id = "local"): PaneStatusEvent => ({
  pane: { machine_id, session: "s", pane_id },
  previous,
  status,
  title: "",
});

describe("shouldResync", () => {
  it("is true when an Agent of the same Workspace stops working", () => {
    expect(shouldResync(ev("p1", "working", "idle"), ws, machines)).toBe(true);
    expect(shouldResync(ev("p1", "working", "done"), ws, machines)).toBe(true);
    expect(shouldResync(ev("p1", "working", "blocked"), ws, machines)).toBe(true);
  });

  it("is false for another Workspace, a start of work, or no change of working", () => {
    expect(shouldResync(ev("p2", "working", "idle"), ws, machines)).toBe(false);
    expect(shouldResync(ev("p1", "idle", "working"), ws, machines)).toBe(false);
    expect(shouldResync(ev("p1", "idle", "done"), ws, machines)).toBe(false);
    expect(shouldResync(ev("gone", "working", "idle"), ws, machines)).toBe(false);
  });

  it("is false on an ssh Machine, whose watch does not use FSEvents", () => {
    const remote = { ...ws, machine_id: "box" };
    expect(shouldResync(ev("p1", "working", "idle", "box"), remote, machines)).toBe(false);
  });
});

describe("useStaleResync", () => {
  beforeEach(() => {
    emit = null;
    useApp.setState({ machines });
  });

  it("reloads a local root when the window gets the focus back or its Agent stops working", async () => {
    const reload = vi.fn();
    renderHook(() => useStaleResync(ws, reload));
    await act(async () => {});
    window.dispatchEvent(new Event("focus"));
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => emit?.(ev("p1", "working", "idle")));
    expect(reload).toHaveBeenCalledTimes(2);
    act(() => emit?.(ev("p2", "working", "idle")));
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does nothing for an ssh root", async () => {
    const reload = vi.fn();
    renderHook(() => useStaleResync({ ...ws, machine_id: "box" }, reload));
    await act(async () => {});
    window.dispatchEvent(new Event("focus"));
    act(() => emit?.(ev("p1", "working", "idle", "box")));
    expect(reload).not.toHaveBeenCalled();
  });

  it("stops listening when unmounted", async () => {
    const reload = vi.fn();
    const { unmount } = renderHook(() => useStaleResync(ws, reload));
    await act(async () => {});
    unmount();
    window.dispatchEvent(new Event("focus"));
    expect(reload).not.toHaveBeenCalled();
    expect(emit).toBeNull();
  });
});
