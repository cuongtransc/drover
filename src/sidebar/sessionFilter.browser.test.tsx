import "../styles.css";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { MachineView, PaneView } from "../lib/types";

// The Sessions filter with real keys in Chrome: what jsdom's synthetic events cannot show (focus
// leaving the field on a trusted Esc) and a folded Group opening for what the words found.
vi.mock("../lib/ipc", async (orig) => ({ ...(await orig<typeof import("../lib/ipc")>()), herdrCall: vi.fn(async () => undefined) }));
const { useApp } = await import("../store/app");
const { useLayout, sessionKey } = await import("./groups");
const { Sidebar } = await import("./Sidebar");
const { useSessionFilter, useSessionQuery } = await import("./activeFilter");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ws = (id: string, label: string) => ({ workspace_id: id, label, number: 1, status: "idle" as const, tabs: [{ tab_id: id + ":t", label: "1", number: 1, status: "idle" as const, panes: [{ pane_id: id + ":p", terminal_id: "t" + id, title: label, cwd: "/x", agent: "claude", status: "idle" } as PaneView] }] });
const local: MachineView = { id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "idle",
  sessions: [{ name: "ca", running: true, loaded: true, status: "idle", error: null, workspaces: [ws("c1", "ca-trader")] }, { name: "w-xb", running: true, loaded: true, status: "idle", error: null, workspaces: [ws("x1", "notes")] }] };

beforeEach(async () => {
  document.body.innerHTML = "";
  useApp.setState({ machines: { local }, order: ["local"], selected: null, viewed: null, expanded: { "group:g1": false } } as never);
  useLayout.setState({ layout: { bookmarks: [], tree: [{ kind: "group", id: "g1", label: "Work", children: [{ kind: "session", key: sessionKey("local", "ca") }] }] } } as never);
  useSessionFilter.setState({ filter: "all" });
  useSessionQuery.setState({ query: "", machine: null });
  const nav = document.createElement("nav");
  nav.className = "sidebar";
  nav.innerHTML = '<div class="sidebar-scroll" id="root"></div>';
  document.body.appendChild(nav);
  await act(async () => createRoot(document.getElementById("root")!).render(<Sidebar />));
});

const field = () => document.querySelector<HTMLInputElement>('input[aria-label="Filter sessions"]')!;
const shown = (name: string) => [...document.querySelectorAll(".session-name .label")].some((e) => e.textContent === name);

it("Esc clears the words, then leaves the field", async () => {
  await userEvent.click(field());
  await userEvent.keyboard("xb");
  expect(field().value).toBe("xb");
  await userEvent.keyboard("{Escape}");
  expect(field().value).toBe("");
  expect(document.activeElement).toBe(field());
  await userEvent.keyboard("{Escape}");
  expect(document.activeElement).not.toBe(field());
});

it("opens a folded Group while the words find a Session in it, and folds it again after", async () => {
  expect(shown("ca")).toBe(false);
  await userEvent.click(field());
  await userEvent.keyboard("ca");
  expect(shown("ca")).toBe(true);
  expect(shown("w-xb")).toBe(false);
  await userEvent.keyboard("{Escape}");
  expect(shown("ca")).toBe(false);
  expect(useApp.getState().expanded["group:g1"]).toBe(false);
});

it("rings the field once when focused: the input inside draws no ring of its own", async () => {
  await userEvent.click(field());
  expect(field().matches(":focus-visible")).toBe(true);
  expect(getComputedStyle(field()).boxShadow).toBe("none");
  expect(getComputedStyle(document.querySelector(".session-filter-field")!).boxShadow).not.toBe("none");
});
