import "../styles.css";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({
  herdrCall: vi.fn(async () => ({})),
  imageSaveTemp: vi.fn(),
  completeCommands: vi.fn(async () => []),
  completeFiles: vi.fn(async () => []),
  completeEntries: vi.fn(async () => []),
  claudePromptHistory: vi.fn(async () => []),
  chatGitStatus: vi.fn(async () => null),
}));
import { useBtw } from "./btw";
import { BtwPanel } from "./BtwPanel";

// The /btw column's box grows with its question, as the Composer does, up to 8 lines, then scrolls.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pane = { machine_id: "m1", session: "s", pane_id: "p1" };

async function mount() {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  host.style.cssText = "width: 360px; height: 600px; display: flex;";
  document.body.appendChild(host);
  useBtw.setState({ open: { "m1/s/p1": true } });
  await act(async () => createRoot(host).render(<BtwPanel pane={pane} />));
  return host.querySelector<HTMLTextAreaElement>(".btw-compose textarea")!;
}

async function type(box: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => useBtw.setState({ asides: {}, history: {}, open: {} }));

it("grows with a question of several lines, without scrolling inside", async () => {
  const box = await mount();
  const line = parseFloat(getComputedStyle(box).lineHeight);
  await type(box, "Khoá max_applications_in_flight ở 1 (4659)?\nVì sao không để 2?\nCó ảnh hưởng gì đến throughput?");
  expect(box.clientHeight).toBeGreaterThanOrEqual(line * 3);
  expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight + 1);
});

it("stops at 8 lines and scrolls past them", async () => {
  const box = await mount();
  await type(box, Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n"));
  const line = parseFloat(getComputedStyle(box).lineHeight);
  expect(box.clientHeight).toBeLessThanOrEqual(line * 8 + 8 + 1);
  expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);
});
