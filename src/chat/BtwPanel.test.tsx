import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({ herdrCall: vi.fn().mockResolvedValue({}) }));
import { herdrCall } from "../lib/ipc";
import { useApp } from "../store/app";
import { useBtw, type Aside } from "./btw";
import { BtwPanel } from "./BtwPanel";

const pane = { machine_id: "devtuf", session: "default", pane_id: "w1:p1" };
const KEY = "devtuf/default/w1:p1";
const put = (a: Partial<Aside>) =>
  useBtw.setState({ asides: { [KEY]: { question: "why that file?", phase: "asking", signal: { cancelled: false }, ...a } } });

afterEach(() => {
  useBtw.setState({ asides: {}, history: {}, open: {}, drafts: {} });
  vi.mocked(herdrCall).mockClear();
});

describe("BtwPanel", () => {
  it("shows nothing without an aside", () => {
    const { container } = render(<BtwPanel pane={pane} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the question while Claude answers, and Cancel cancels it", async () => {
    put({ signal: { cancelled: false, opened: true } });
    render(<BtwPanel pane={pane} />);
    const panel = screen.getByRole("region", { name: "Side question" });
    expect(panel.textContent).toContain("why that file?");
    expect(screen.getByRole("status").textContent).toBe("Answering…");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(useBtw.getState().asides[KEY]).toBeUndefined());
    expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "pane.send_keys", { pane_id: "w1:p1", keys: ["esc"] });
  });

  it("shows the answer as Claude drew it, with Copy and Close", () => {
    put({ phase: "done", answer: "Because:\n  - it holds the parser" });
    render(<BtwPanel pane={pane} />);
    expect(screen.getByText(/it holds the parser/).tagName).toBe("PRE");
    screen.getByRole("button", { name: "Copy" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useBtw.getState().asides[KEY]).toBeUndefined();
    expect(herdrCall).not.toHaveBeenCalled();
  });

  it("keeps the earlier questions above the latest, folded, each with its answer", () => {
    put({ phase: "done", answer: "Because of the parser." });
    useBtw.setState({ history: { [KEY]: [
      { question: "what changed?", phase: "done", answer: "Two files.", signal: { cancelled: false } },
      { question: "which test?", phase: "failed", error: "No answer from /btw yet", signal: { cancelled: false } },
    ] } });
    render(<BtwPanel pane={pane} />);
    const earlier = screen.getAllByRole("group");
    expect(earlier.map((d) => d.querySelector("summary")?.textContent)).toEqual(["what changed?", "which test?"]);
    expect(earlier[0].hasAttribute("open")).toBe(false);
    expect(earlier[0].textContent).toContain("Two files.");
    expect(earlier[1].textContent).toContain("No answer from /btw yet");
    expect(screen.getByText("Because of the parser.").tagName).toBe("PRE");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(useBtw.getState().history[KEY]).toBeUndefined();
  });

  it("on a failed read, says so and offers the terminal, where the answer is", () => {
    put({ phase: "failed", error: "The /btw panel did not open" });
    render(<BtwPanel pane={pane} />);
    expect(screen.getByRole("alert").textContent).toContain("The /btw panel did not open");
    fireEvent.click(screen.getByRole("button", { name: "Open terminal" }));
    expect(useApp.getState().lens[KEY]).toBe("terminal");
    expect(useBtw.getState().asides[KEY]).toBeUndefined();
  });

  it("widens by dragging its left edge, remembers the width, and a double-click restores 360px", () => {
    localStorage.clear();
    act(() => useBtw.getState().openBtw(pane));
    const { unmount } = render(<BtwPanel pane={pane} />);
    const column = () => screen.getByRole("region", { name: "Side question" });
    const edge = screen.getByRole("separator", { name: "Resize side question" });
    expect(column().style.width).toBe("360px");
    fireEvent.pointerDown(edge, { clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(edge, { clientX: 900, pointerId: 1 });
    fireEvent.pointerUp(edge, { clientX: 900, pointerId: 1 });
    expect(column().style.width).toBe("460px");
    unmount();
    render(<BtwPanel pane={pane} />);
    expect(column().style.width).toBe("460px");
    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize side question" }));
    expect(column().style.width).toBe("360px");
  });

  describe("its own box", () => {
    const box = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Side question" });
    const send = () => screen.getByRole<HTMLButtonElement>("button", { name: "Ask" });

    it("opens empty from the /btw key, focused, Ask held until something is typed", () => {
      render(<BtwPanel pane={pane} />);
      act(() => useBtw.getState().openBtw(pane));
      screen.getByRole("region", { name: "Side question" });
      expect(document.activeElement).toBe(box());
      expect(send().disabled).toBe(true);
      fireEvent.change(box(), { target: { value: "why that file?" } });
      expect(send().disabled).toBe(false);
    });

    it("sends what is typed as /btw and follows it for the answer", async () => {
      const ask = vi.fn().mockResolvedValue(undefined);
      useBtw.setState({ ask });
      act(() => useBtw.getState().openBtw(pane));
      render(<BtwPanel pane={pane} />);
      fireEvent.change(box(), { target: { value: "  why that file?  " } });
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "agent.prompt", { target: "w1:p1", text: "/btw why that file?" });
      await waitFor(() => expect(ask).toHaveBeenCalledWith(pane, "why that file?", expect.any(Function)));
      expect(box().value).toBe("");
    });

    it("asks a question of several lines on one line, which Claude still takes as /btw", () => {
      act(() => useBtw.getState().openBtw(pane));
      render(<BtwPanel pane={pane} />);
      fireEvent.change(box(), { target: { value: "why that file?\n1. lock it?\n2. keep it?\n3. and the test?" } });
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "agent.prompt", { target: "w1:p1", text: "/btw why that file? 1. lock it? 2. keep it? 3. and the test?" });
    });

    it("holds Ask for a question too long for /btw, and says why", () => {
      act(() => useBtw.getState().openBtw(pane));
      render(<BtwPanel pane={pane} />);
      fireEvent.change(box(), { target: { value: "why ".repeat(300) } });
      expect(send().disabled).toBe(true);
      expect(screen.getByText(/Too long for \/btw/)).toBeTruthy();
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(herdrCall).not.toHaveBeenCalled();
    });

    it("keeps a newline on Shift+Enter", () => {
      act(() => useBtw.getState().openBtw(pane));
      render(<BtwPanel pane={pane} />);
      fireEvent.change(box(), { target: { value: "why" } });
      fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
      expect(herdrCall).not.toHaveBeenCalled();
    });

    it("holds Ask while Claude answers, since its panel takes the keys", () => {
      put({});
      render(<BtwPanel pane={pane} />);
      fireEvent.change(box(), { target: { value: "and the test?" } });
      expect(send().disabled).toBe(true);
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(herdrCall).not.toHaveBeenCalled();
      expect(box().value).toBe("and the test?");
    });

    it("closes the column on Esc", () => {
      put({ phase: "done", answer: "Because." });
      render(<BtwPanel pane={pane} />);
      fireEvent.keyDown(box(), { key: "Escape" });
      expect(useBtw.getState().asides[KEY]).toBeUndefined();
      expect(useBtw.getState().open[KEY]).toBeFalsy();
      expect(screen.queryByRole("region", { name: "Side question" })).toBeNull();
    });

    it("pastes through pane.send_input for an agent herdr does not track", () => {
      act(() => useBtw.getState().openBtw(pane));
      render(<BtwPanel pane={pane} untracked />);
      fireEvent.change(box(), { target: { value: "why" } });
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(herdrCall).toHaveBeenCalledWith("devtuf", "default", "pane.send_input", { pane_id: "w1:p1", text: "\x1b[200~/btw why\x1b[201~", keys: ["enter"] });
    });

    it("keeps the unsent question when the pane is left and come back to", () => {
      act(() => useBtw.getState().openBtw(pane));
      const { unmount } = render(<BtwPanel pane={pane} />);
      fireEvent.change(box(), { target: { value: "why 4659?" } });
      unmount();
      render(<BtwPanel pane={pane} />);
      expect(box().value).toBe("why 4659?");
    });

    it("keeps each pane's unsent question to that pane", () => {
      const other = { ...pane, pane_id: "w1:p2" };
      act(() => {
        useBtw.getState().openBtw(pane);
        useBtw.getState().openBtw(other);
      });
      const { rerender } = render(<BtwPanel pane={pane} />);
      fireEvent.change(box(), { target: { value: "why 4659?" } });
      rerender(<BtwPanel pane={other} />);
      expect(box().value).toBe("");
      rerender(<BtwPanel pane={pane} />);
      expect(box().value).toBe("why 4659?");
    });

    it("drops the unsent question when the column is closed", () => {
      act(() => useBtw.getState().openBtw(pane));
      render(<BtwPanel pane={pane} />);
      fireEvent.change(box(), { target: { value: "why 4659?" } });
      fireEvent.keyDown(box(), { key: "Escape" });
      act(() => useBtw.getState().openBtw(pane));
      expect(box().value).toBe("");
    });
  });
});
