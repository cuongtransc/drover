import { act, createEvent, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({ sessionStart: vi.fn().mockResolvedValue(undefined) }));
import { useApp } from "../store/app";
import { projectKey, sessionKey, useLayout } from "./groups";
import { useSessionFilter, useShowDefault } from "./activeFilter";
import type { GroupNode } from "./groups";
import { Sidebar } from "./Sidebar";
import type { MachineView } from "../lib/types";

const sess = (name: string) => ({ name, running: true, status: "idle" as const, error: null, workspaces: [] });
const local: MachineView = { id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "idle", sessions: [sess("x"), sess("y")] };
const kx = sessionKey("local", "x"), ky = sessionKey("local", "y");
const dt = () => {
  const data: Record<string, string> = {};
  return { data, types: [] as string[], effectAllowed: "", dropEffect: "",
    setData(t: string, v: string) { data[t] = v; this.types.push(t); }, getData: (t: string) => data[t] ?? "", setDragImage() {} };
};
const rowOf = (text: string) => screen.getAllByText(text)[0].closest("button")!;
const drag = (from: HTMLElement, to: HTMLElement) => {
  const dataTransfer = dt();
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragEnter(to, { dataTransfer });
  fireEvent.dragOver(to, { dataTransfer });
  fireEvent.drop(to, { dataTransfer });
  fireEvent.dragEnd(from, { dataTransfer });
};

describe("Sidebar drag and drop", () => {
  beforeEach(() => {
    useSessionFilter.setState({ filter: "all" });
    // Its fixtures name sessions "default" with no agent, which the sidebar hides unless shown.
    useShowDefault.setState({ show: true });
    useApp.setState({ machines: { local }, order: ["local"], selected: null, viewed: null, expanded: {} });
    useLayout.setState({ layout: { tree: [{ kind: "group", id: "a", label: "A", children: [] }], bookmarks: [] } });
  });
  afterEach(() => vi.useRealTimers());

  it("drops an unplaced session into a group", () => {
    render(<Sidebar />);
    drag(rowOf("y"), rowOf("A"));
    const tree = useLayout.getState().layout.tree;
    expect((tree[0] as GroupNode).children).toEqual([{ kind: "session", key: ky }]);
    expect(tree[1]).toEqual({ kind: "session", key: kx });
    expect(document.querySelector(".drop-into, .drop-before, .drop-after")).toBeNull();
    // The dragged row was remounted under the group, so its dragend never reached React.
    expect(screen.queryByRole("region", { name: "Bookmarks" })).toBeNull();
  });
  it("shows an into indicator and inserts first when dropping below an open group with children", () => {
    useLayout.setState({ layout: { tree: [{ kind: "group", id: "a", label: "A", children: [{ kind: "session", key: ky }] }], bookmarks: [] } });
    render(<Sidebar />);
    const dataTransfer = dt();
    const g = rowOf("A");
    g.getBoundingClientRect = () => ({ top: 0, height: 100, bottom: 100, left: 0, right: 100, width: 100, x: 0, y: 0, toJSON() {} });
    fireEvent.dragStart(rowOf("x"), { dataTransfer });
    // jsdom has no DragEvent, so clientY must be set by hand.
    const over = createEvent.dragOver(g, { dataTransfer });
    Object.defineProperty(over, "clientY", { value: 90 });
    fireEvent(g, over);
    expect(g.className).toContain("drop-into");
    const drop = createEvent.drop(g, { dataTransfer });
    Object.defineProperty(drop, "clientY", { value: 90 });
    fireEvent(g, drop);
    const tree = useLayout.getState().layout.tree;
    expect((tree[0] as GroupNode).children).toEqual([{ kind: "session", key: kx }, { kind: "session", key: ky }]);
  });
  it("refuses to drop a group into its own child", () => {
    useLayout.setState({ layout: { tree: [{ kind: "group", id: "a", label: "A", children: [{ kind: "group", id: "b", label: "B", children: [] }] }], bookmarks: [] } });
    const before = useLayout.getState().layout;
    render(<Sidebar />);
    const dataTransfer = dt();
    fireEvent.dragStart(rowOf("A"), { dataTransfer });
    fireEvent.dragEnter(rowOf("B"), { dataTransfer });
    fireEvent.dragOver(rowOf("B"), { dataTransfer });
    expect(document.querySelector(".drop-into, .drop-before, .drop-after")).toBeNull();
    fireEvent.drop(rowOf("B"), { dataTransfer });
    fireEvent.dragEnd(rowOf("A"), { dataTransfer });
    expect(useLayout.getState().layout).toBe(before);
  });
  it("shows no indicator for a session dragged over its own row", () => {
    useLayout.setState({ layout: { tree: [{ kind: "session", key: kx }, { kind: "session", key: ky }], bookmarks: [] } });
    render(<Sidebar />);
    const dataTransfer = dt();
    fireEvent.dragStart(rowOf("x"), { dataTransfer });
    fireEvent.dragOver(rowOf("x"), { dataTransfer });
    expect(document.querySelector(".drop-into, .drop-before, .drop-after")).toBeNull();
    expect(dataTransfer.dropEffect).toBe("none");
    fireEvent.dragEnd(rowOf("x"), { dataTransfer });
  });
  it("reorders bookmarks by drag; a bookmark drag over the tree changes nothing", () => {
    const [px, py] = [projectKey("local", "x", "app"), projectKey("local", "y", "api")];
    act(() => useLayout.getState().update((l) => ({ ...l, bookmarks: [px, py] })));
    render(<Sidebar />);
    const bm = screen.getByRole("region", { name: "Bookmarks" });
    // jsdom rows have no height, so a row resolves to "after": app moves after api.
    drag(within(bm).getByText("app").closest("button")!, within(bm).getByText("api").closest("button")!);
    expect(useLayout.getState().layout.bookmarks).toEqual([py, px]);
    const before = useLayout.getState().layout;
    drag(within(bm).getByText("app").closest("button")!, rowOf("A"));
    expect(useLayout.getState().layout).toBe(before);
  });
  it("opens a closed group after hovering 600 ms during a drag", () => {
    vi.useFakeTimers();
    useApp.setState({ expanded: { "group:a": false } });
    render(<Sidebar />);
    const dataTransfer = dt();
    fireEvent.dragStart(rowOf("x"), { dataTransfer });
    fireEvent.dragEnter(rowOf("A"), { dataTransfer });
    fireEvent.dragOver(rowOf("A"), { dataTransfer });
    act(() => vi.advanceTimersByTime(599));
    expect(useApp.getState().expanded["group:a"]).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(useApp.getState().expanded["group:a"]).toBe(true);
  });
  it("moves a session to the end of the root when dropped after the tree", () => {
    render(<Sidebar />);
    drag(rowOf("x"), document.querySelector(".tree-end") as HTMLElement);
    const tree = useLayout.getState().layout.tree;
    expect(tree.map((n) => (n.kind === "group" ? n.id : n.key))).toEqual(["a", ky, kx]);
  });
  it("bookmarks nothing a Session or a Group drag drops on Bookmarks: they hold projects", () => {
    act(() => useLayout.getState().update((l) => ({ ...l, bookmarks: [projectKey("local", "y", "api")] })));
    render(<Sidebar />);
    const header = within(screen.getByRole("region", { name: "Bookmarks" })).getByText("Bookmarks");
    drag(rowOf("x"), header);
    drag(rowOf("A"), header);
    expect(useLayout.getState().layout.bookmarks).toEqual([projectKey("local", "y", "api")]);
  });
});
