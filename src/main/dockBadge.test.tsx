import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { MachineView, PaneView } from "../lib/types";

const setDockBadge = vi.fn(async (_n: number) => {});
vi.mock("../lib/ipc", () => ({ setDockBadge: (n: number) => setDockBadge(n) }));
const { useApp } = await import("../store/app");
const { useDockBadge } = await import("./dockBadge");

const pane = (id: string, status: PaneView["status"]): PaneView => ({ pane_id: id, terminal_id: "t" + id, title: id, cwd: "/x", agent: "claude", status });
const machine = (panes: PaneView[]): MachineView => ({
  id: "a", label: "a", kind: "local", state: "connected", error: null, version: "0.9.3", status: "idle",
  sessions: [{ name: "s", running: true, loaded: true, status: "idle", error: null, workspaces: [
    { workspace_id: "w1", label: "ws", number: 1, status: "idle", tabs: [{ tab_id: "t1", label: "1", number: 1, status: "idle", panes }] }] }],
});
function Host() {
  useDockBadge();
  return null;
}

beforeEach(() => {
  setDockBadge.mockClear();
  useApp.setState({ machines: { a: machine([pane("w", "working")]) }, order: ["a"], doneSeen: {}, statusSince: {} } as never);
});

it("badges the Dock icon with how many agents need the user, as ⌘J counts them, and clears it at zero", () => {
  render(<Host />);
  expect(setDockBadge).toHaveBeenLastCalledWith(0);
  act(() => useApp.setState({ machines: { a: machine([pane("b", "blocked"), pane("d", "done"), pane("w", "working")]) } } as never));
  expect(setDockBadge).toHaveBeenLastCalledWith(2);
  act(() => useApp.setState({ doneSeen: { "a/s/d": true } } as never));
  expect(setDockBadge).toHaveBeenLastCalledWith(1);
  act(() => useApp.setState({ machines: { a: machine([pane("b", "idle")]) } } as never));
  expect(setDockBadge).toHaveBeenLastCalledWith(0);
});

it("sets the badge only when the count changes", () => {
  render(<Host />);
  act(() => useApp.setState({ machines: { a: machine([pane("w", "working"), pane("x", "idle")]) } } as never));
  expect(setDockBadge).toHaveBeenCalledTimes(1);
});
