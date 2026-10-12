import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_QUICK_REPLIES,
  loadQuickReplies,
  moveReply,
  moveReplyTo,
  normalizeReplies,
  QUICK_REPLIES_MAX,
  QUICK_REPLY_MAX_CHARS,
  quickReplyButtons,
  slotAt,
  useQuickReplies,
} from "./quickReplies";

const KEY = "drover:settings";

beforeEach(() => {
  localStorage.clear();
  useQuickReplies.setState(loadQuickReplies());
});

describe("quick replies", () => {
  it("defaults to shown, with the canned list", () => {
    expect(loadQuickReplies()).toEqual({ show: true, replies: DEFAULT_QUICK_REPLIES });
    expect(DEFAULT_QUICK_REPLIES).toEqual(["ok", "continue", "merged", "what's next?", "commit and push"]);
  });

  it("keeps strings only, capped in count and length; anything else falls back to the defaults", () => {
    expect(normalizeReplies(["ok", 3, null, "x".repeat(QUICK_REPLY_MAX_CHARS + 5)])).toEqual(["ok", "x".repeat(QUICK_REPLY_MAX_CHARS)]);
    expect(normalizeReplies(Array.from({ length: 20 }, (_, i) => `r${i}`))).toHaveLength(QUICK_REPLIES_MAX);
    expect(normalizeReplies("continue")).toEqual(DEFAULT_QUICK_REPLIES);
    expect(normalizeReplies([])).toEqual([]);
  });

  it("moves a reply one place up or down, and leaves the list alone past either end", () => {
    const l = ["a", "b", "c"];
    expect(moveReply(l, 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveReply(l, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveReply(l, 0, -1)).toBe(l);
    expect(moveReply(l, 2, 1)).toBe(l);
    expect(l).toEqual(["a", "b", "c"]);
  });

  it("moves a reply to any place, the others closing up", () => {
    const l = ["a", "b", "c", "d"];
    expect(moveReplyTo(l, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveReplyTo(l, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveReplyTo(l, 1, 1)).toBe(l);
    expect(moveReplyTo(l, 1, 9)).toBe(l);
    expect(l).toEqual(["a", "b", "c", "d"]);
  });

  it("puts a dragged row in the slot whose middle its own middle is nearest", () => {
    const mids = [10, 40, 70];
    expect(slotAt(-50, mids)).toBe(0);
    expect(slotAt(24, mids)).toBe(0);
    expect(slotAt(26, mids)).toBe(1);
    expect(slotAt(68, mids)).toBe(2);
    expect(slotAt(500, mids)).toBe(2);
  });

  it("offers a button only for the replies with text", () => {
    expect(quickReplyButtons(["run the ", "", "  ", "ship it"])).toEqual(["run the ", "ship it"]);
  });

  it("saves into the shared settings object without dropping other keys", () => {
    localStorage.setItem(KEY, JSON.stringify({ theme: "light" }));
    useQuickReplies.getState().setReplies(["go on", ""]);
    useQuickReplies.getState().setShow(false);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ theme: "light", quickReplies: ["go on", ""], showQuickReplies: false });
    expect(loadQuickReplies()).toEqual({ show: false, replies: ["go on", ""] });
  });

  it("resets the list to the defaults", () => {
    useQuickReplies.getState().setReplies(["only"]);
    useQuickReplies.getState().reset();
    expect(useQuickReplies.getState().replies).toEqual(DEFAULT_QUICK_REPLIES);
    expect(loadQuickReplies().replies).toEqual(DEFAULT_QUICK_REPLIES);
  });
});
