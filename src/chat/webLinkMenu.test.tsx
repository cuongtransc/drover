import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const openUrl = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }));
vi.mock("../ui/Toast", () => ({ showToast: vi.fn() }));
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { ChatItemView } from "./ChatItemView";

const show = (markdown: string) => render(<ChatItemView item={{ kind: "assistant_text", markdown }} />);
const items = () => screen.getAllByRole("menuitem").map((b) => b.textContent);

describe("a web link's menu", () => {
  beforeEach(() => {
    openUrl.mockClear();
    vi.mocked(writeText).mockClear();
    getSelection()!.removeAllRanges();
  });

  it("is Drover's: open in the browser or copy the link, never load it into the app", () => {
    show("See [the PR](https://github.com/x/y/pull/1).");
    fireEvent.contextMenu(screen.getByRole("link", { name: "the PR" }));
    expect(items()).toEqual(["Open in Browser", "Copy Link"]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in Browser" }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/x/y/pull/1");
    fireEvent.contextMenu(screen.getByRole("link", { name: "the PR" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy Link" }));
    expect(writeText).toHaveBeenCalledWith("https://github.com/x/y/pull/1");
  });

  it("keeps the selection made before the right-click, and copies it", () => {
    show("See [the PR](https://github.com/x/y/pull/1) now.");
    const link = screen.getByRole("link", { name: "the PR" });
    const range = document.createRange();
    range.selectNodeContents(link.parentElement!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    fireEvent.mouseDown(link, { button: 2 });
    // WebKit selects the link here.
    const r2 = document.createRange();
    r2.selectNodeContents(link);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r2);
    fireEvent.contextMenu(link);
    expect(getSelection()!.toString()).toBe("See the PR now.");
    expect(items()).toEqual(["Open in Browser", "Copy Link", "Copy"]);
  });

  it("offers only Copy Link for a link that is not a web page", () => {
    show("Mail [me](mailto:a@b.c).");
    fireEvent.contextMenu(screen.getByRole("link", { name: "me" }));
    expect(items()).toEqual(["Copy Link"]);
  });
});
