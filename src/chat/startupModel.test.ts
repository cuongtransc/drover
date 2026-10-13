import { describe, expect, it } from "vitest";
import { parseStartupModel } from "./startupModel";

// Claude Code 2.1.296's banner, read off a fresh pane (`pane.read`, source recent).
const BANNER = [
  " ▐▛███▛█   Claude Code v2.1.296",
  "▝▜██████▀  Opus 5.5 · Claude Max",
  " ▝▝   ▝▝   ~/Dev/PCT/01-AI/21-AI-Coding-Agent/drover",
  "",
  "────────────────────────────────",
  '❯ Try "refactor Composer.test.tsx"',
  "────────────────────────────────",
  "  👤 default | 📁 drover | Opus 5.5 | Context: 0%",
].join("\n");

describe("parseStartupModel", () => {
  it("reads the Model off Claude's startup banner", () => {
    expect(parseStartupModel(BANNER)).toBe("Opus 5.5");
  });
  it("keeps what the banner adds to the name", () => {
    expect(parseStartupModel(BANNER.replace("Opus 5.5 ·", "Opus 5.5 (1M context) ·"))).toBe("Opus 5.5 (1M context)");
  });
  it("reads the older boxed banner", () => {
    const boxed = [
      "╭─── Claude Code v2.0.14 ──────────────╮",
      "│            Welcome back!             │",
      "│        Sonnet 4.5 · Claude Pro       │",
      "╰──────────────────────────────────────╯",
    ].join("\n");
    expect(parseStartupModel(boxed)).toBe("Sonnet 4.5");
  });
  it("is null without a banner, so a status line or the user's words are not taken for one", () => {
    expect(parseStartupModel("")).toBeNull();
    expect(parseStartupModel(BANNER.split("\n").slice(2).join("\n"))).toBeNull();
    expect(parseStartupModel("❯ what is Opus 5.5 · Claude Max?")).toBeNull();
  });
});
