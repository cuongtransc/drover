import { playwright } from "@vitest/browser-playwright";
import browser from "./vitest.browser.config";

// `mise run docs:ui-map` only: renders the App to draw docs/design/ui-map.html and the README's
// screenshots, at 2x like a Retina screen. The browser config's own tests are left out
// (mergeConfig would add to its include, not replace it).
export default {
  ...browser,
  // optimizeDeps comes from the browser config: every package the source imports, pre-bundled.
  test: {
    ...browser.test,
    include: ["src/docs/*.capture.tsx"],
    browser: {
      ...browser.test!.browser,
      provider: playwright({ launchOptions: { channel: "chrome", ignoreDefaultArgs: ["--hide-scrollbars"] }, contextOptions: { deviceScaleFactor: 2 } }),
    },
  },
};
