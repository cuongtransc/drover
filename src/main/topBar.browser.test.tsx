import "../styles.css";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it } from "vitest";
import { useApp } from "../store/app";
import { itemKey, NO_ITEMS } from "../store/openItems";
import { TopBar } from "./TopBar";
import type { MachineView, PaneView } from "../lib/types";

// The main area's one bar, at the widths the window allows: 46px tall like the other columns'
// heads, the Lens switch whole, and room left for the tabs even at the smallest window.
const pane = (id: string, title: string): PaneView => ({ pane_id: id, terminal_id: "t" + id, title, cwd: "/x", agent: "claude", status: "working" });
const m: MachineView = {
  id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "working",
  sessions: [{ name: "ct", running: true, status: "working", error: null, workspaces: [
    { workspace_id: "w1", label: "herdr-app", number: 1, status: "working", tabs: [
      { tab_id: "w1:t1", label: "1", number: 1, status: "working", panes: [pane("p1", "Compact tab bar"), pane("p2", "UI map doc")] } ] } ] }],
};

function mount(width: number) {
  document.body.innerHTML = "";
  document.body.style.margin = "0";
  const main = document.createElement("main");
  main.className = "main";
  main.style.cssText = `width:${width}px;height:400px;display:flex;flex-direction:column`;
  document.body.appendChild(main);
  return main;
}

beforeEach(() => {
  useApp.setState({ machines: { local: m }, order: ["local"], selected: null, openItems: NO_ITEMS, lens: {} });
  for (const id of ["p2", "p1"]) {
    useApp.getState().select({ machine_id: "local", session: "ct", pane_id: id });
    useApp.getState().pinItem(itemKey({ kind: "agent", ref: { machine_id: "local", session: "ct", pane_id: id } }));
  }
});

it.each([902, 262])("is one 46px bar with the tabs and a whole Lens switch in a %ipx main area", async (width) => {
  const main = mount(width);
  await act(async () => createRoot(main).render(<TopBar lens />));
  const bar = main.querySelector(".topbar")!.getBoundingClientRect();
  expect(bar.height).toBe(46);
  const tabs = main.querySelector(".files-tabs")!.getBoundingClientRect();
  expect(tabs.width).toBeGreaterThan(120);
  const seg = main.querySelector(".seg")!.getBoundingClientRect();
  expect(seg.right).toBeLessThanOrEqual(bar.right);
  expect(seg.width).toBeLessThan(80);
});

it("draws each tab as a 28px pill with an edge, the open one filled and semibold", async () => {
  const main = mount(902);
  await act(async () => createRoot(main).render(<TopBar lens />));
  const [open, other] = [".files-tab-item.active", ".files-tab-item:not(.active)"].map((sel) => main.querySelector<HTMLElement>(sel)!);
  for (const tab of [open, other]) {
    expect(tab.getBoundingClientRect().height).toBe(28);
    expect(getComputedStyle(tab).borderTopWidth).toBe("1px");
    expect(getComputedStyle(tab).borderTopLeftRadius).toBe("6px");
  }
  expect(getComputedStyle(open).fontWeight).toBe("600");
  expect(getComputedStyle(other).fontWeight).toBe("400");
  expect(getComputedStyle(open).backgroundColor).not.toBe(getComputedStyle(other).backgroundColor);
  // a tab dragged over the open one still shows the side it would land on
  open.classList.add("drop-before");
  expect(getComputedStyle(open).boxShadow).toContain("inset");
});

it("keeps its height with no tab open, for the window to be dragged by", async () => {
  useApp.setState({ openItems: NO_ITEMS, selected: null });
  const main = mount(600);
  await act(async () => createRoot(main).render(<TopBar />));
  expect(main.querySelector(".topbar")!.getBoundingClientRect().height).toBe(46);
  expect(main.querySelector(".topbar")!.hasAttribute("data-tauri-drag-region")).toBe(true);
});

// Many tabs overflow the strip: no scrollbar may take room under them (it pushed them up, off the
// Lens switch's centre), the open tab stays in view, and a mouse wheel scrolls the strip.
function openMany(n: number) {
  const panes = Array.from({ length: n }, (_, i) => pane(`q${i}`, `A long agent tab title ${i}`));
  const many: MachineView = { ...m, sessions: [{ ...m.sessions[0], workspaces: [{ ...m.sessions[0].workspaces[0], tabs: [
    { tab_id: "w1:t1", label: "1", number: 1, status: "working", panes } ] }] }] };
  useApp.setState({ machines: { local: many }, openItems: NO_ITEMS, selected: null });
  for (const p of panes) {
    const ref = { machine_id: "local", session: "ct", pane_id: p.pane_id };
    useApp.getState().select(ref);
    useApp.getState().pinItem(itemKey({ kind: "agent", ref }));
  }
}

it("centres overflowing tabs on the Lens switch, with no scrollbar under them", async () => {
  openMany(8);
  const main = mount(700);
  await act(async () => createRoot(main).render(<TopBar lens />));
  const strip = main.querySelector<HTMLElement>(".files-tabs")!;
  expect(strip.scrollWidth).toBeGreaterThan(strip.clientWidth);
  expect(strip.clientHeight).toBe(strip.offsetHeight);
  const centre = (r: DOMRect) => r.top + r.height / 2;
  const tab = main.querySelector(".files-tab-item")!.getBoundingClientRect();
  const seg = main.querySelector(".seg")!.getBoundingClientRect();
  expect(Math.abs(centre(tab) - centre(seg))).toBeLessThanOrEqual(1);
});

it("keeps the open tab in view and scrolls the strip with a mouse wheel", async () => {
  openMany(8);
  const main = mount(700);
  await act(async () => createRoot(main).render(<TopBar lens />));
  const strip = main.querySelector<HTMLElement>(".files-tabs")!;
  const inView = () => {
    const s = strip.getBoundingClientRect();
    const t = strip.querySelector(".files-tab-item.active")!.getBoundingClientRect();
    return t.left >= s.left - 1 && t.right <= s.right + 1;
  };
  expect(inView()).toBe(true);
  await act(async () => useApp.getState().activateItem(itemKey({ kind: "agent", ref: { machine_id: "local", session: "ct", pane_id: "q0" } })));
  expect(strip.scrollLeft).toBe(0);
  expect(inView()).toBe(true);
  strip.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }));
  expect(strip.scrollLeft).toBeGreaterThan(0);
});
