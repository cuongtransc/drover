import "../styles.css";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../lib/ipc", () => ({
  herdrCall: vi.fn(async () => ({})),
  imageSaveTemp: vi.fn(),
  completeCommands: vi.fn(async () => []),
  completeFiles: vi.fn(async () => []),
  completeEntries: vi.fn(async () => []),
  claudePromptHistory: vi.fn(async () => []),
  chatGitStatus: vi.fn(async () => ({
    folder: "drover", path: "/Users/me/drover", branch: "feat/compact-top-bar", dirty: true, upstream: null, ahead: 0, behind: 0,
    staged: 0, modified: 2, untracked: 0, changed: 2, changes: [],
  })),
}));
import { Composer } from "./Composer";
import { useQuickReplies } from "../settings/quickReplies";

// The Composer in the Chat lens at the smallest window (262px) and at a usual one: narrow, every
// quick reply shows, the branch is whole and Send stays on the model's line; wide, nothing moves.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pane = { machine_id: "m1", session: "s", pane_id: "p1" };
const meta = { model: "claude-opus-5-5", effort: "high", context_tokens: 84_200 };
const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();

async function mount(width: number) {
  document.body.innerHTML = "";
  document.body.style.margin = "0";
  const lens = document.createElement("div");
  lens.className = "chat-lens";
  lens.style.width = `${width}px`;
  lens.innerHTML = '<div class="chat-main"></div>';
  document.body.appendChild(lens);
  await act(async () => createRoot(lens.firstElementChild!).render(<Composer pane={pane} agent="claude" status="working" meta={meta} />));
  await act(async () => {});
}

beforeEach(() => {
  localStorage.clear();
  useQuickReplies.setState({ show: true, replies: ["ok", "continue", "merged", "what's next?", "commit and push"] } as never);
});

it("shows every quick reply, the whole branch and Send beside the model in a 262px Chat lens", async () => {
  await mount(262);
  const quick = box(".composer-quick");
  const chips = [...document.querySelectorAll(".composer-quick-reply")].map((c) => c.getBoundingClientRect());
  expect(chips).toHaveLength(5);
  for (const c of chips) expect(c.right).toBeLessThanOrEqual(quick.right + 0.5);
  const branch = document.querySelector<HTMLElement>(".composer-git-branch")!;
  expect(branch.scrollWidth).toBeLessThanOrEqual(branch.clientWidth);
  expect(getComputedStyle(document.querySelector(".composer-git-folder")!).display).toBe("none");
  const send = box(".send"), model = box(".composer-model");
  expect(Math.abs(send.top + send.height / 2 - (model.top + model.height / 2))).toBeLessThan(4);
  expect(send.right).toBeLessThanOrEqual(box(".composer-box").right);
});

it("keeps one line of quick replies and the folder in a wide Chat lens", async () => {
  await mount(900);
  const chips = [...document.querySelectorAll(".composer-quick-reply")].map((c) => c.getBoundingClientRect());
  expect(new Set(chips.map((c) => Math.round(c.top))).size).toBe(1);
  expect(getComputedStyle(document.querySelector(".composer-git-folder")!).display).not.toBe("none");
  const mid = (r: DOMRect) => r.top + r.height / 2;
  expect(Math.abs(mid(box(".composer-git")) - mid(box(".composer-model")))).toBeLessThan(4);
});
