import "../styles.css";
import { beforeEach, expect, it } from "vitest";

beforeEach(() => {
  document.body.innerHTML = "";
  document.body.style.margin = "0";
});

// A pasted terminal rule ("────…") or a long path has no break point; it must wrap inside the bubble, not widen the chat.
it("wraps an unbreakable line inside the user bubble, so the chat never scrolls sideways", () => {
  const lens = document.createElement("div");
  lens.className = "chat-lens";
  lens.style.width = "900px";
  lens.innerHTML = '<div class="chat-main"><div class="chat-scroll"><div class="chat-row chat-user"><div class="chat-user-line"><div class="chat-bubble"></div></div></div></div></div>';
  document.body.appendChild(lens);
  const bubble = lens.querySelector<HTMLElement>(".chat-bubble")!;
  bubble.textContent = `tf] $ terraform plan\n${"─".repeat(184)}\n/Users/connor/.claude/projects/-Users-connor-Dev-PCT-14-Infra-ct-infra/2208be13-fa64-4feb-9edd-ecc4ed729a6a.jsonl`;
  const scroll = lens.querySelector<HTMLElement>(".chat-scroll")!;
  expect(scroll.scrollWidth).toBe(scroll.clientWidth);
  expect(bubble.scrollWidth).toBe(bubble.clientWidth);
});
