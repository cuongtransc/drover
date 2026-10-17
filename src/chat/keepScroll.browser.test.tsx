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
import { forgetChatMemory } from "./scrollMemory";

const paneA = { machine_id: "local", session: "default", pane_id: "w1:p1" };
const paneB = { machine_id: "local", session: "default", pane_id: "w1:p2" };
const view = { status: "idle", agent: "claude", title: "claude" } as PaneView;

function transcript(n: number, from = 0): unknown[] {
  const out: unknown[] = [];
  for (let k = from; k < from + n; k++) {
    const ts = new Date(Date.UTC(2026, 9, 10, 0, k)).toISOString();
    out.push({ kind: "user", text: `turn ${k}`, ts });
    out.push({ kind: "assistant_text", markdown: `Reply ${k}.\n\nLine two.\n\nLine three.`, ts });
  }
  return out;
}

/** Turns whose work (a Bash call and its result) folds into a Work block above the reply. */
function withWork(n: number): unknown[] {
  const out: unknown[] = [];
  for (let k = 0; k < n; k++) {
    const ts = new Date(Date.UTC(2026, 9, 10, 0, k)).toISOString();
    out.push({ kind: "user", text: `turn ${k}`, ts });
    out.push({ kind: "tool_call", id: `t${k}`, name: "Bash", input_summary: `run ${k}`, input: { command: `echo ${k}` }, ts });
    out.push({ kind: "tool_result", call_id: `t${k}`, output: Array.from({ length: 12 }, (_, i) => `out ${k}.${i}`).join("\n"), is_error: false, ts });
    out.push({ kind: "assistant_text", markdown: `Reply ${k}.`, ts });
  }
  return out;
}

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const box = (host: HTMLElement) => host.querySelector<HTMLElement>(".chat-scroll")!;
const atEnd = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
/** The first user bubble on screen and how far its top is below the box's top. */
function firstBubble(host: HTMLElement) {
  const r = box(host).getBoundingClientRect();
  const b = [...host.querySelectorAll<HTMLElement>(".chat-bubble")].find((x) => x.getBoundingClientRect().bottom > r.top)!;
  return { text: b.textContent, top: Math.round(b.getBoundingClientRect().top - r.top) };
}

let host: HTMLElement;
let rerender: (ui: React.ReactElement) => void;
/** Shows `pane` the way App does: one ChatLens per pane (`key`), its open answered with `items`. */
async function show(pane: typeof paneA, items: unknown[], total = items.length) {
  const ui = <ChatLens key={pane.pane_id} pane={pane} view={view} />;
  if (rerender) rerender(ui);
  else {
    host = document.createElement("div");
    host.style.cssText = "width:1000px;height:600px;display:flex;";
    document.body.appendChild(host);
    rerender = render(ui, { container: host }).rerender;
  }
  await settle(50);
  const ch = channels[channels.length - 1];
  act(() => ch.onmessage({ type: "reset", items, total }));
  await settle();
}

beforeEach(() => {
  document.body.innerHTML = "";
  channels.length = 0;
  rerender = undefined as never;
  // Places live for the app's run, so one test's would carry into the next.
  forgetChatMemory();
});

it("coming back to a pane keeps where its chat was scrolled", async () => {
  const a = transcript(100);
  await show(paneA, a);
  expect(atEnd(box(host))).toBe(true);
  box(host).scrollTop = 2000;
  await settle(100);
  const before = firstBubble(host);
  await show(paneB, transcript(50));
  expect(atEnd(box(host))).toBe(true);
  await show(paneA, a);
  expect(firstBubble(host)).toEqual(before);
  expect(atEnd(box(host))).toBe(false);
});

it("a chat left at its end comes back at its end, with what arrived meanwhile", async () => {
  await show(paneA, transcript(100));
  await show(paneB, transcript(50));
  await show(paneA, transcript(110));
  expect(atEnd(box(host))).toBe(true);
  expect(host.textContent).toContain("turn 109");
});

it("keeps the place when messages arrived meanwhile, and says there are new ones", async () => {
  await show(paneA, transcript(100));
  box(host).scrollTop = 2000;
  await settle(100);
  const before = firstBubble(host);
  await show(paneB, transcript(50));
  await show(paneA, transcript(110));
  expect(firstBubble(host)).toEqual(before);
  expect(host.querySelector(".chat-new")).not.toBeNull();
});

it("⌘L to the Terminal and back keeps the place, as another pane does", async () => {
  const a = transcript(100);
  await show(paneA, a);
  box(host).scrollTop = 2000;
  await settle(100);
  const before = firstBubble(host);
  // App renders the Terminal lens in ChatLens's place: the Chat unmounts.
  rerender(<div className="terminal-lens" />);
  await settle(50);
  await show(paneA, a);
  expect(firstBubble(host)).toEqual(before);
});

it("keeps the Work blocks opened by hand, and the place below one", async () => {
  const a = withWork(60);
  await show(paneA, a);
  const head = (k: number) =>
    [...host.querySelectorAll<HTMLButtonElement>(".chat-work-head")].find((b) => b.closest("[data-index]")?.nextElementSibling?.textContent?.includes(`Reply ${k}.`));
  // Open turn 40's block, then read a little below it.
  const bubble = () => [...host.querySelectorAll<HTMLElement>(".chat-bubble")].find((b) => b.textContent === "turn 40");
  // Up a screen at a time until the virtual list mounts it.
  for (let i = 0; i < 40 && !bubble(); i++) {
    box(host).scrollTop -= 500;
    await settle(50);
  }
  bubble()!.scrollIntoView({ block: "start" });
  await settle(100);
  act(() => head(40)!.click());
  await settle(100);
  box(host).scrollTop += 300;
  await settle(100);
  const before = firstBubble(host);
  await show(paneB, transcript(10));
  await show(paneA, a);
  expect(head(40)?.getAttribute("aria-expanded")).toBe("true");
  expect(firstBubble(host)).toEqual(before);
});

it("goes to the end when the row it was at is no longer loaded", async () => {
  await show(paneA, transcript(100));
  box(host).scrollTop = 2000;
  await settle(100);
  await show(paneB, transcript(50));
  // Turns 0..99 were trimmed off the front of the loaded window (row keys count from the file's start).
  await show(paneA, transcript(100, 500), 1200);
  expect(atEnd(box(host))).toBe(true);
});
