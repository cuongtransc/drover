import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "drover:files-panel";
const fresh = async () => {
  vi.resetModules();
  return (await import("./panelStore")).useFilesPanel;
};

describe("Files panel layout", () => {
  beforeEach(() => localStorage.clear());

  it("starts collapsed at half the column the first time", async () => {
    const store = await fresh();
    expect(store.getState().collapsed).toBe(true);
    expect(store.getState().height).toBeNull();
  });

  it("remembers open or collapsed and the dragged height across launches", async () => {
    const first = await fresh();
    first.getState().setCollapsed(false);
    first.getState().setHeight(340);
    const next = await fresh();
    expect(next.getState().collapsed).toBe(false);
    expect(next.getState().height).toBe(340);
  });

  it("remembers that focusing the tree or Go to file opened it", async () => {
    (await fresh()).getState().focusGoto();
    expect((await fresh()).getState().collapsed).toBe(false);
  });

  it("falls back to the defaults on corrupt storage", async () => {
    localStorage.setItem(KEY, "{nope");
    expect((await fresh()).getState().collapsed).toBe(true);
    localStorage.setItem(KEY, JSON.stringify({ collapsed: "yes", height: -5 }));
    const store = await fresh();
    expect(store.getState().collapsed).toBe(true);
    expect(store.getState().height).toBeNull();
  });
});
