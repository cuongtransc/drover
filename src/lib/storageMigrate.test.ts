import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateStorageKeys } from "./storageMigrate";

// The app was Herdr before ADR 0007; its localStorage keys move from `herdr-app:` to `drover:`.
beforeEach(() => localStorage.clear());

describe("migrateStorageKeys", () => {
  it("moves every herdr-app: key to drover: with its value", () => {
    localStorage.setItem("herdr-app:settings", '{"theme":"light"}');
    localStorage.setItem("herdr-app:draft:local/ct/w1:p1", "half a prompt");
    expect(migrateStorageKeys(localStorage)).toBe(2);
    expect(localStorage.getItem("drover:settings")).toBe('{"theme":"light"}');
    expect(localStorage.getItem("drover:draft:local/ct/w1:p1")).toBe("half a prompt");
    expect(localStorage.getItem("herdr-app:settings")).toBeNull();
    expect(localStorage.getItem("herdr-app:draft:local/ct/w1:p1")).toBeNull();
  });

  it("keeps a drover: key that already exists and drops the old one", () => {
    localStorage.setItem("herdr-app:settings", '{"theme":"light"}');
    localStorage.setItem("drover:settings", '{"theme":"dark"}');
    expect(migrateStorageKeys(localStorage)).toBe(0);
    expect(localStorage.getItem("drover:settings")).toBe('{"theme":"dark"}');
    expect(localStorage.getItem("herdr-app:settings")).toBeNull();
  });

  it("leaves other keys alone and does nothing the second time", () => {
    localStorage.setItem("herdr-app:ui", "u");
    localStorage.setItem("other", "o");
    localStorage.setItem("herdr-app-not-a-prefix", "x");
    migrateStorageKeys(localStorage);
    expect(migrateStorageKeys(localStorage)).toBe(0);
    expect(localStorage.getItem("drover:ui")).toBe("u");
    expect(localStorage.getItem("other")).toBe("o");
    expect(localStorage.getItem("herdr-app-not-a-prefix")).toBe("x");
  });
});

// Every store reads its keys when its module loads, so the move must run before any of them:
// as main.tsx's first import, whose module runs before the next import's.
it("runs as main.tsx's first import", () => {
  const main = readFileSync(join(process.cwd(), "src/main.tsx"), "utf8");
  const first = main.split("\n").find((l) => l.startsWith("import "));
  expect(first).toBe('import "./lib/storageMigrate.run";');
});
