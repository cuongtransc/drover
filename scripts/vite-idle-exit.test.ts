import { describe, expect, it, vi } from "vitest";
import { idleMinutes, idleWatch } from "./vite-idle-exit.ts";

const MIN = 60_000;

function setup(idleMs = 30 * MIN) {
  let t = 0;
  const onIdle = vi.fn();
  const watch = idleWatch({ idleMs, now: () => t, onIdle });
  return { watch, onIdle, advance: (ms: number) => (t += ms) };
}

describe("idleWatch", () => {
  it("fires once nothing has touched the server for the idle time", () => {
    const { watch, onIdle, advance } = setup();
    advance(30 * MIN - 1);
    watch.check();
    expect(onIdle).not.toHaveBeenCalled();
    advance(1);
    watch.check();
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("fires only once", () => {
    const { watch, onIdle, advance } = setup();
    advance(31 * MIN);
    watch.check();
    watch.check();
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it("restarts the clock on every request", () => {
    const { watch, onIdle, advance } = setup();
    advance(20 * MIN);
    watch.touch();
    advance(20 * MIN);
    watch.check();
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("never fires while a client is connected (the Tauri webview holds HMR open)", () => {
    const { watch, onIdle, advance } = setup();
    watch.open();
    advance(10 * 60 * MIN);
    watch.check();
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("counts the idle time from the last client leaving", () => {
    const { watch, onIdle, advance } = setup();
    watch.open();
    watch.open();
    advance(60 * MIN);
    watch.close();
    advance(60 * MIN);
    watch.check();
    expect(onIdle).not.toHaveBeenCalled();
    watch.close();
    advance(30 * MIN - 1);
    watch.check();
    expect(onIdle).not.toHaveBeenCalled();
    advance(1);
    watch.check();
    expect(onIdle).toHaveBeenCalledOnce();
  });
});

describe("idleMinutes", () => {
  const m = (raw?: string) => idleMinutes({ DROVER_VITE_IDLE_MINUTES: raw });
  it("defaults to 30", () => expect(idleMinutes({})).toBe(30));
  it("reads DROVER_VITE_IDLE_MINUTES, fractions included", () => expect(m("0.5")).toBe(0.5));
  it("0 turns it off", () => expect(m("0")).toBe(0));
  it("falls back to 30 on garbage or a negative", () => {
    expect(m("soon")).toBe(30);
    expect(m("-1")).toBe(30);
    expect(m("")).toBe(30);
  });
  // tauri dev starts vite, then builds Rust for minutes before its webview connects, and stops
  // vite when it exits: an idle exit there leaves the app on a dead dev URL (2026-10-12).
  it("is off under tauri dev", () =>
    expect(idleMinutes({ TAURI_ENV_PLATFORM: "darwin", DROVER_VITE_IDLE_MINUTES: "0.5" })).toBe(0));
  it("is off under vitest, whose watch mode sits idle on purpose", () => expect(idleMinutes({ VITEST: "true" })).toBe(0));
});
