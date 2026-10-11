import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../store/app";
import { useRewind, type Edit } from "./rewind";
import { EditPanel } from "./EditPanel";

const pane = { machine_id: "devtuf", session: "default", pane_id: "w1:p1" };
const KEY = "devtuf/default/w1:p1";
const put = (e: Edit) => useRewind.setState({ edits: { [KEY]: e } });
afterEach(() => useRewind.setState({ edits: {} }));

describe("EditPanel", () => {
  it("shows nothing without an edit", () => {
    const { container } = render(<EditPanel pane={pane} />);
    expect(container.innerHTML).toBe("");
  });

  it("says it is going back while it drives Claude", () => {
    put({ phase: "running" });
    render(<EditPanel pane={pane} />);
    expect(screen.getByRole("status").textContent).toMatch(/Going back to before your last message/);
  });

  it("asks what to restore when the message changed files, in Claude's own words", () => {
    const answer = vi.fn();
    put({ phase: "choose", code: "The code will be restored -1 in note.txt.", answer });
    render(<EditPanel pane={pane} />);
    expect(screen.getByRole("region", { name: "Edit last message" }).textContent).toContain("The code will be restored -1 in note.txt.");
    fireEvent.click(screen.getByRole("button", { name: "Conversation only" }));
    expect(answer).toHaveBeenLastCalledWith("conversation");
    fireEvent.click(screen.getByRole("button", { name: "Restore code and conversation" }));
    expect(answer).toHaveBeenLastCalledWith("both");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(answer).toHaveBeenLastCalledWith(null);
  });

  it("on failure says why and offers the terminal", () => {
    put({ phase: "failed", error: "Claude's Rewind did not open" });
    render(<EditPanel pane={pane} />);
    expect(screen.getByRole("alert").textContent).toContain("Claude's Rewind did not open");
    fireEvent.click(screen.getByRole("button", { name: "Open terminal" }));
    expect(useApp.getState().lens[KEY]).toBe("terminal");
    expect(useRewind.getState().edits[KEY]).toBeUndefined();
  });
});
