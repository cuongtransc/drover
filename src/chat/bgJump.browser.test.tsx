import "../styles.css";
import { act, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]), Channel: class {} }));
const history = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ipc")>()),
  herdrCall: vi.fn().mockResolvedValue({}),
  claudePromptHistory: vi.fn().mockResolvedValue([]),
  // The real page: up to 100 items ending before `before`.
  chatPage: vi.fn(async (_p: unknown, before: number) => history.items.slice(Math.max(0, before - 100), before)),
  chatLocate: vi.fn(() => Promise.resolve({ agent: "claude", path: "/h/s.jsonl", ambiguous: false, candidates: ["/h/s.jsonl"], pending: false })),
  imageSaveTemp: vi.fn(),
  completeCommands: vi.fn().mockResolvedValue([]),
  completeFiles: vi.fn().mockResolvedValue([]),
  chatGitStatus: vi.fn().mockResolvedValue(null),
}));
const channels = vi.hoisted(() => [] as { onmessage: (ev: unknown) => void }[]);
vi.mock("./chatSession", () => ({
  openChat: (_p: unknown, _path: string | null, ch: { onmessage: (ev: unknown) => void }) => {
    channels.push(ch);
    return { opened: Promise.resolve({ agent: "claude", path: "/h/s.jsonl", ambiguous: false, candidates: ["/h/s.jsonl"], pending: false }), close: () => {} };
  },
  onOpenFailure: () => "error",
  watchMachine: () => ({ sawDown: false, reopen: false }),
}));
import type { PaneView } from "../lib/types";
import { ChatLens } from "./ChatLens";

const pane = { machine_id: "local", session: "default", pane_id: "w1:p1" };
const view = { status: "idle", agent: "claude", title: "claude" } as PaneView;

// 200 turns of 5 items: a prompt, a reply, a background Bash call and its result, a longer reply.
function transcript(): unknown[] {
  const out: unknown[] = [];
  for (let k = 0; k < 200; k++) {
    const ts = new Date(Date.UTC(2026, 9, 10, 0, k)).toISOString();
    out.push({ kind: "user", text: `turn ${k}`, ts });
    out.push({ kind: "assistant_text", markdown: `Starting task ${k}.`, ts });
    out.push({ kind: "tool_call", id: `t${k}`, name: "Bash", input_summary: `run task ${k}`, input: { command: "sleep 600", description: `task ${k}`, run_in_background: true }, ts });
    out.push({ kind: "tool_result", call_id: `t${k}`, output: `Command running in background with ID: b${k}.`, is_error: false, ts });
    out.push({ kind: "assistant_text", markdown: `Task ${k} runs.\n\nLine two.\n\nLine three.`, ts });
  }
  return out;
}

function mount() {
  const host = document.createElement("div");
  host.style.cssText = "width:1000px;height:600px;display:flex;";
  document.body.appendChild(host);
  render(<ChatLens pane={pane} view={view} />, { container: host });
  return host;
}

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

async function openWith(target: string, loadedFrom: number) {
  history.items = transcript();
  const host = mount();
  await settle(50);
  const ch = channels[channels.length - 1];
  act(() => ch.onmessage({ type: "reset", items: history.items.slice(loadedFrom), total: history.items.length }));
  act(() => ch.onmessage({ type: "meta", model: null, effort: null, context_tokens: null, queued: [],
    background: [{ call_id: target, kind: "bash", description: `task ${target.slice(1)}`, started: "2026-10-10T00:00:00.000Z" }] }));
  await settle();
  return host;
}

/** Where the view landed: the card's position in the scroll box, and the first turn in view. */
function landing(host: HTMLElement, target: string) {
  const box = host.querySelector<HTMLElement>(".chat-scroll")!;
  const r = box.getBoundingClientRect();
  const card = host.querySelector<HTMLElement>(`[data-call="${target}"]`);
  const c = card?.getBoundingClientRect();
  const firstTurn = [...host.querySelectorAll<HTMLElement>(".chat-bubble")]
    .find((b) => { const br = b.getBoundingClientRect(); return br.bottom > r.top && br.top < r.bottom; })?.textContent;
  return { scrollTop: Math.round(box.scrollTop), cardInView: !!c && c.bottom > r.top && c.top < r.bottom, firstTurnInView: firstTurn };
}

beforeEach(() => {
  document.body.innerHTML = "";
  channels.length = 0;
});

it("a loaded call far up: clicking the strip row brings its card into view", async () => {
  const host = await openWith("t120", 500); // loaded window: turns 100..199
  act(() => host.querySelector<HTMLButtonElement>(".chat-background-summary")!.click());
  const row = host.querySelector<HTMLButtonElement>('[aria-label="Background tasks"] button')!;
  act(() => row.click());
  await settle(1500);
  const where = landing(host, "t120");
  expect(where.cardInView, JSON.stringify(where)).toBe(true);
});

it("a call older than the loaded window: clicking pages in and brings its card into view", async () => {
  const host = await openWith("t30", 500);
  act(() => host.querySelector<HTMLButtonElement>(".chat-background-summary")!.click());
  const row = host.querySelector<HTMLButtonElement>('[aria-label="Background tasks"] button')!;
  act(() => row.click());
  await settle(3000);
  const where = landing(host, "t30");
  expect(where.cardInView, JSON.stringify(where)).toBe(true);
});
