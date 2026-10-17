import { beforeEach, describe, expect, it, vi } from "vitest";

const fresh = async () => {
  vi.resetModules();
  return (await import("./wrapStore")).useWrap;
};

describe("Files word wrap setting", () => {
  beforeEach(() => localStorage.clear());

  it("is off the first time", async () => {
    expect((await fresh()).getState().on).toBe(false);
  });

  it("remembers the toggle across launches, beside the other settings", async () => {
    localStorage.setItem("drover:settings", JSON.stringify({ filesOutline: false }));
    (await fresh()).getState().toggle();
    expect((await fresh()).getState().on).toBe(true);
    expect(JSON.parse(localStorage.getItem("drover:settings")!)).toEqual({ filesOutline: false, filesWrap: true });
    (await fresh()).getState().toggle();
    expect((await fresh()).getState().on).toBe(false);
  });
});
