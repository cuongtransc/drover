import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BackgroundTasks } from "./BackgroundTasks";

const ci = { call_id: "t1", kind: "bash" as const, description: "Run full dotfiles CI", started: "2026-10-10T17:08:00.000Z" };
const lint = { call_id: "t2", kind: "bash" as const, description: "Lint", started: "2026-10-10T17:09:00.000Z" };
const review = { call_id: "a1", kind: "agent" as const, description: "Whole-branch review", started: "2026-10-10T17:10:30.000Z" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-10T17:11:12.000Z"));
});
afterEach(() => vi.useRealTimers());

const summary = () => screen.getByRole("button", { name: /in background/ });

it("folds the tasks into one line by default: counts by kind and the longest run", () => {
  render(<BackgroundTasks tasks={[ci, lint, review]} onJump={() => {}} />);
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(summary().getAttribute("aria-expanded")).toBe("false");
  expect(summary().textContent).toBe("2 shells · 1 agent in background›3m 12s");
  expect(screen.queryByRole("list", { name: "Background tasks" })).toBeNull();
});

it("names only the kinds running, in the singular for one", () => {
  render(<BackgroundTasks tasks={[review]} onJump={() => {}} />);
  expect(summary().textContent).toBe("1 agent in background›42s");
});

it("counts from the oldest known start when some starts are unknown", () => {
  render(<BackgroundTasks tasks={[{ ...ci, started: null }, review]} onJump={() => {}} />);
  expect(summary().textContent).toBe("1 shell · 1 agent in background›42s");
});

it("opens to list each task with its kind and time running, and folds again", () => {
  render(<BackgroundTasks tasks={[ci, review]} onJump={() => {}} />);
  fireEvent.click(summary());
  expect(summary().getAttribute("aria-expanded")).toBe("true");
  const list = screen.getByRole("list", { name: "Background tasks" });
  expect([...list.querySelectorAll("button")].map((r) => r.textContent)).toEqual([
    "ShellRun full dotfiles CI3m 12s",
    "AgentWhole-branch review42s",
  ]);
  fireEvent.click(summary());
  expect(screen.queryByRole("list", { name: "Background tasks" })).toBeNull();
});

it("counts a Monitor as a shell, as Claude Code does, and names it in the list", () => {
  const watch = { call_id: "m1", kind: "monitor" as const, description: "Wait for the parallel run", started: "2026-10-10T17:10:00.000Z" };
  render(<BackgroundTasks tasks={[ci, watch]} onJump={() => {}} />);
  expect(summary().textContent).toBe("2 shells in background›3m 12s");
  fireEvent.click(summary());
  const list = screen.getByRole("list", { name: "Background tasks" });
  expect([...list.querySelectorAll("button")].map((r) => r.textContent)).toEqual([
    "ShellRun full dotfiles CI3m 12s",
    "MonitorWait for the parallel run1m 12s",
  ]);
});

it("jumps to the task's tool card", () => {
  const onJump = vi.fn();
  render(<BackgroundTasks tasks={[ci]} onJump={onJump} />);
  fireEvent.click(summary());
  fireEvent.click(screen.getByRole("button", { name: /Run full dotfiles CI/ }));
  expect(onJump).toHaveBeenCalledWith("t1");
});

it("renders nothing without tasks", () => {
  const { container } = render(<BackgroundTasks tasks={[]} onJump={() => {}} />);
  expect(container.innerHTML).toBe("");
});
