import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useApp } from "../store/app";
import { LensSwitch } from "./LensSwitch";
import type { MachineView } from "../lib/types";

const m: MachineView = {
  id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "blocked",
  sessions: [{ name: "default", running: true, status: "blocked", error: null, workspaces: [
    { workspace_id: "w1", label: "drover", number: 1, status: "blocked", tabs: [
      { tab_id: "w1:t1", label: "1", number: 1, status: "blocked", panes: [
        { pane_id: "w1:p1", terminal_id: "a", title: "Rewrite", cwd: "/x", agent: "claude", status: "blocked" } ] } ] } ] }],
};

describe("LensSwitch", () => {
  beforeEach(() => useApp.setState({
    machines: { local: m }, order: ["local"], lens: {},
    selected: { machine_id: "local", session: "default", pane_id: "w1:p1" },
  }));
  it("switches the selected pane's lens with two icon buttons named by their lens", () => {
    const { container } = render(<LensSwitch />);
    // icons only: the names are for the tooltip and the screen reader
    expect(container.textContent).toBe("");
    expect(screen.getByRole("button", { name: "Terminal" }).getAttribute("title")).toBe("Terminal");
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(useApp.getState().lens["local/default/w1:p1"]).toBe("chat");
    expect(screen.getByRole("button", { name: "Chat" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("disables Chat when the pane has no agent", () => {
    const pane = m.sessions[0].workspaces[0].tabs[0].panes[0];
    useApp.setState({ machines: { local: { ...m, sessions: [{ ...m.sessions[0], workspaces: [{ ...m.sessions[0].workspaces[0],
      tabs: [{ ...m.sessions[0].workspaces[0].tabs[0], panes: [{ ...pane, agent: null }] }] }] }] } } });
    render(<LensSwitch />);
    const chat = screen.getByRole("button", { name: "Chat" }) as HTMLButtonElement;
    expect(chat.disabled).toBe(true);
    expect(chat.getAttribute("title")).toBe("No agent in this pane");
    expect(screen.getByRole("button", { name: "Terminal" }).getAttribute("aria-pressed")).toBe("true");
  });
});
