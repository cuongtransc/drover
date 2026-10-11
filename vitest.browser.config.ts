import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { doubleClick, drag, hover, key } from "./e2e/commands.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Every package the source imports, pre-bundled before the first test. One Vite finds mid-run
 * (a cache built before code first imported it) makes it re-optimize and reload the page: vitest
 * reports "unexpectedly reloaded", and a reload once broke a `vi.mock` (2026-10-09). Read from the
 * source, so a new import is covered without editing this list.
 */
function importedPackages(dir = "src"): string[] {
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : [],
    );
  const found = new Set<string>();
  for (const file of walk(dir)) {
    for (const m of readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']((?:@[\w.-]+\/)?\w[\w./-]*)["']/g)) {
      const spec = m[1];
      if (/^(node:|vitest|@vitest\/)/.test(spec) || /\.css$/.test(spec)) continue;
      found.add(spec);
    }
  }
  return [...found].sort();
}

// Real-browser tests (`*.browser.test.tsx`): the installed Chrome, real mouse and key events.
// Not part of `mise run ci`; run with `mise run test:browser`.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: importedPackages() },
  test: {
    include: ["src/**/*.browser.test.{ts,tsx}"],
    browser: {
      enabled: true,
      headless: true,
      // Scrollbars shown, as in the app: headless Chrome hides them, and they take width there.
      provider: playwright({ launchOptions: { channel: "chrome", ignoreDefaultArgs: ["--hide-scrollbars"] } }),
      instances: [{ browser: "chromium", viewport: { width: 1000, height: 600 } }],
      commands: { drag, doubleClick, hover, key },
    },
  },
});
