import "../styles.css";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { page } from "vitest/browser";
import { beforeEach, expect, it } from "vitest";
import type { BackgroundTask } from "../lib/types";
import { BackgroundTasks } from "./BackgroundTasks";
import { WorkingIndicator } from "./WorkingIndicator";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tasks: BackgroundTask[] = [
  { call_id: "a", kind: "bash", description: "pnpm dev --host", started: "2026-10-11T00:00:00Z" },
  { call_id: "b", kind: "agent", description: "Review the chat lens", started: "2026-10-11T00:00:00Z" },
];

async function render(theme: "light" | "dark") {
  document.documentElement.dataset.theme = theme;
  document.body.innerHTML = "";
  document.body.style.margin = "0";
  const host = document.createElement("div");
  host.style.cssText = "width:900px;background:var(--surface-0)";
  document.body.appendChild(host);
  await act(async () =>
    createRoot(host).render(
      <div className="chat-main">
        <BackgroundTasks tasks={tasks} onJump={() => {}} />
        <WorkingIndicator status="working" start="2026-10-11T00:00:00Z" />
      </div>,
    ),
  );
  return host;
}

const left = (el: Element) => el.getBoundingClientRect().left;
const right = (el: Element) => el.getBoundingClientRect().right;

beforeEach(() => {
  document.body.innerHTML = "";
});

it.each(["light", "dark"] as const)("lines the folded strip up with the Working line (%s)", async (theme) => {
  const host = await render(theme);
  const summary = host.querySelector(".chat-background-summary")!;
  expect(host.querySelectorAll(".chat-background-row")).toHaveLength(0);
  expect(Math.abs(left(summary.querySelector(".spin")!) - left(host.querySelector(".chat-working .spin")!))).toBeLessThanOrEqual(1);
  expect(Math.abs(right(summary.querySelector(".chat-background-time")!) - (900 - 28))).toBeLessThanOrEqual(1);
  expect(getComputedStyle(summary).fontSize).toBe(getComputedStyle(host.querySelector(".chat-working")!).fontSize);
  await page.screenshot({ path: `../../.vitest/herdr-bg-strip-folded-${theme}.png`, element: host });
});

it.each(["light", "dark"] as const)("opens into rows on the same columns (%s)", async (theme) => {
  const host = await render(theme);
  const summary = host.querySelector<HTMLButtonElement>(".chat-background-summary")!;
  await act(async () => summary.click());
  const descs = [...host.querySelectorAll(".chat-background-desc")];
  const times = [...host.querySelectorAll(".chat-background-time")];
  expect(descs).toHaveLength(2);
  expect(times).toHaveLength(3);
  // The summary is one row high: the larger chevron must not grow the line.
  expect(summary.getBoundingClientRect().height).toBeCloseTo(host.querySelector(".chat-background-row")!.getBoundingClientRect().height, 0);
  expect(left(host.querySelector(".chat-background-kind")!)).toBeCloseTo(left(summary.querySelector(".chat-background-count")!), 0);
  expect(Math.abs(left(descs[0]) - left(descs[1]))).toBeLessThanOrEqual(0.5);
  for (const t of times) expect(Math.abs(right(t) - (900 - 28))).toBeLessThanOrEqual(1);
  expect(getComputedStyle(host.querySelector(".chat-background-row")!).fontSize).toBe(getComputedStyle(host.querySelector(".chat-working")!).fontSize);
  await page.screenshot({ path: `../../.vitest/herdr-bg-strip-open-${theme}.png`, element: host });
});
