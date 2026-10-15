import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());

// findBy*/waitFor return as soon as their check passes, so a longer budget costs a passing test
// nothing. The default 1 s is what a loaded machine overruns (the commit hook runs the suite beside
// cargo): DiagramZoom's diagram draws in 165 ms alone and took 0.7-2.4 s with four suites and a
// cargo build running. Kept under vitest's 5 s testTimeout, so a real miss still reads as one.
configure({ asyncUtilTimeout: 3000 });

// jsdom lays nothing out and gives ranges no boxes (elements get empty ones); match that.
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
