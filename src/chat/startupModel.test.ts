import { describe, expect, it } from "vitest";
import { parseStartupEffort, parseStartupModel } from "./startupModel";

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
  it("leaves the effort the banner adds out of the Model", () => {
    expect(parseStartupModel(BANNER.replace("Opus 5.5 ·", "Opus 5.5 with max effort ·"))).toBe("Opus 5.5");
  });
});

// Claude Code 2.1.296 draws the effort above the message box; `/effort max` redraws the banner too.
const EFFORT_LINE = "                                                    ◐ medium · /effort";

describe("parseStartupEffort", () => {
  it("reads the effort above the message box", () => {
    expect(parseStartupEffort([BANNER.split("\n").slice(0, 4).join("\n"), EFFORT_LINE, ...BANNER.split("\n").slice(4)].join("\n"))).toBe("medium");
  });
  it("reads it inside the rule a picker draws over the box", () => {
    expect(parseStartupEffort(`${BANNER}\n▔▔▔▔▔▔▔▔▔▔▔ ◈ max · /effort ▔`)).toBe("max");
  });
  it("prefers the banner's effort, which a later /effort redraws", () => {
    expect(parseStartupEffort(`${BANNER.replace("Opus 5.5 ·", "Opus 5.5 with xhigh effort ·")}\n${EFFORT_LINE}`)).toBe("xhigh");
  });
  it("is null without a banner or an effort line", () => {
    expect(parseStartupEffort(BANNER)).toBeNull();
    expect(parseStartupEffort(EFFORT_LINE)).toBeNull();
    expect(parseStartupEffort("❯ set ◐ medium · /effort please")).toBeNull();
  });
});
