import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  useBtw.setState({ asides: {}, history: {} });
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
});
