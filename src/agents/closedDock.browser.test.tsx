import "../styles.css";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { EMPTY_LAYOUT, projectKey, setKept, useLayout } from "../sidebar/groups";
import { useApp } from "../store/app";
import type { MachineView } from "../lib/types";

vi.mock("@tauri-apps/api/core", async (orig) => ({ ...(await orig<object>()), invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", async (orig) => ({ ...(await orig<object>()), listen: vi.fn(async () => () => {}) }));
const { AgentList } = await import("./AgentList");

const session = {
  name: "ct", running: true, loaded: true, status: "working" as const, error: null,
  workspaces: [{ workspace_id: "w1", label: "ct-cli", number: 1, status: "working" as const, tabs: [
    { tab_id: "w1:t1", label: "1", number: 1, status: "working" as const, panes: [
      { pane_id: "p1", terminal_id: "t1", title: "CPU load cao", cwd: "/Users/me/ct-cli", agent: "claude", status: "working" as const } ] } ] }],
};
const machine: MachineView = { id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "working", sessions: [session] };

// The Agents column as App lays it out: the list, then the Files panel's 32px head.
async function column(closed: number, open: boolean) {
  useApp.setState({ machines: { local: machine }, order: ["local"], viewed: { machine_id: "local", session: "ct" }, expanded: { "closed:local/ct": open } });
  let layout = EMPTY_LAYOUT;
  for (let i = 0; i < closed; i++) layout = setKept(layout, projectKey("local", "ct", `old-${i}`), `/Users/me/old-${i}`);
  useLayout.setState({ layout });
  document.body.innerHTML = "";
  const col = document.createElement("aside");
  col.className = "agents";
  col.style.height = "620px";
  const host = document.createElement("div");
  host.style.display = "contents";
  const files = document.createElement("section");
  files.className = "files-panel collapsed";
  files.innerHTML = '<div class="files-panel-head"></div>';
  col.append(host, files);
  document.body.appendChild(col);
  await act(async () => createRoot(host).render(<AgentList />));
  return { col, files, closed: col.querySelector<HTMLElement>(".closed-ws")! };
}

afterEach(() => { document.body.innerHTML = ""; });

it("docks Closed workspaces above the Files panel, apart from the Pane rows", async () => {
  const { col, files, closed } = await column(3, false);
  expect(closed.closest(".agents-list")).toBeNull();
  expect(closed.querySelector(".closed-toggle")!.textContent).toBe("Closed workspaces3");
  const list = col.querySelector(".agents-list")!.getBoundingClientRect();
  const box = closed.getBoundingClientRect();
  expect(box.top).toBeCloseTo(list.bottom, 0);
  expect(box.bottom).toBeCloseTo(files.getBoundingClientRect().top, 0);
});

it("keeps a long open Closed list to its own scroll, the Pane rows still on screen", async () => {
  const { col, closed } = await column(20, true);
  const height = col.getBoundingClientRect().height;
  expect(closed.getBoundingClientRect().height).toBeLessThanOrEqual(height * 0.4 + 0.5);
  const rows = closed.querySelector<HTMLElement>(".closed-rows")!;
  expect(rows.scrollHeight).toBeGreaterThan(rows.clientHeight);
  const toggle = closed.querySelector(".closed-toggle")!.getBoundingClientRect();
  expect(toggle.top).toBeGreaterThanOrEqual(closed.getBoundingClientRect().top);
  expect(col.querySelector(".agents-list")!.getBoundingClientRect().height).toBeGreaterThan(100);
});
