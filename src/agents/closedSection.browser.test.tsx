import "../styles.css";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ClosedSection } from "./ClosedSection";
import { EMPTY_LAYOUT, projectKey, setKept, useLayout } from "../sidebar/groups";
import { useApp } from "../store/app";
import type { MachineView } from "../lib/types";

it("fits a long closed workspace's label and folder beside its Reopen button at the default column width, light and dark", async () => {
  const session = { name: "ct", running: true, status: "idle" as const, error: null, workspaces: [] };
  const machine: MachineView = { id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "idle", sessions: [session] };
  useApp.setState({ machines: { local: machine }, order: ["local"], expanded: { "closed:local/ct": true } });
  const label = "ct-smarthomes-and-a-very-long-name";
  useLayout.setState({ layout: setKept(EMPTY_LAYOUT, projectKey("local", "ct", label), "/Users/me/Dev/" + label) });
  document.body.innerHTML = "";
  const col = document.createElement("aside");
  col.className = "agents";
  col.style.width = "288px";
  const list = document.createElement("div");
  list.className = "agents-list";
  col.appendChild(list);
  document.body.appendChild(col);
  await act(async () => createRoot(list).render(<ClosedSection machineId="local" session={session} />));
  for (const theme of ["light", "dark"]) {
    document.documentElement.dataset.theme = theme;
    const row = col.querySelector(".closed-row")!.getBoundingClientRect();
    const name = col.querySelector(".closed-label")!.getBoundingClientRect();
    const folder = col.querySelector(".closed-row .ws-folder")!.getBoundingClientRect();
    const btn = col.querySelector(".closed-row .ws-add")!.getBoundingClientRect();
    expect(name.right).toBeLessThanOrEqual(folder.left + 0.5);
    expect(folder.right).toBeLessThanOrEqual(btn.left + 0.5);
    expect(btn.right).toBeLessThanOrEqual(row.right + 0.5);
    expect(list.scrollWidth).toBe(list.clientWidth);
  }
});
