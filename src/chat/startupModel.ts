import { useEffect, useState } from "react";
import { herdrCall } from "../lib/ipc";
import type { PaneRef } from "../lib/types";

/** How often the screen is re-read while the banner is awaited. */
export const STARTUP_MODEL_POLL_MS = 1500;
/** How long to look: past it the banner has scrolled off or was never drawn. */
export const STARTUP_MODEL_WAIT_MS = 10_000;

// The logo's block characters and the older banner's box, around the banner's words.
const FRAME = /^[\s▐▛█▜▝▘▀▌▙▟▄▗▖│]+|[\s│]+$/g;

/**
 * The Model Claude's startup banner names (`Opus 5.5 · Claude Max` under `Claude Code v…`),
 * or null when no banner is on the screen. Claude writes no transcript before the first
 * reply, so until then the banner is the only place the Model shows.
 */
export function parseStartupModel(screen: string): string | null {
  const lines = screen.split("\n");
  const head = lines.findIndex((l) => /Claude Code v\d/.test(l));
  if (head < 0) return null;
  for (const line of lines.slice(head + 1, head + 4)) {
    const m = /^(.+?) · /.exec(line.replace(FRAME, ""));
    if (m) return m[1];
  }
  return null;
}

interface ReadResult {
  text?: string;
  read?: { text?: string };
}

/** Reads the banner's Model off the pane while `armed`, until it shows or the wait runs out. */
export function useStartupModel(pane: PaneRef, armed: boolean): string | null {
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    setModel(null);
    if (!armed) return;
    let live = true;
    let reading = false;
    const stop = () => {
      live = false;
      clearInterval(timer);
      clearTimeout(wait);
    };
    const read = () => {
      if (document.hidden || reading) return;
      reading = true;
      herdrCall(pane.machine_id, pane.session, "pane.read", {
        pane_id: pane.pane_id,
        source: "recent",
        lines: 200,
        format: "text",
        strip_ansi: true,
      })
        .then(
          (r) => {
            if (!live) return;
            const found = parseStartupModel((r as ReadResult | undefined)?.text ?? (r as ReadResult | undefined)?.read?.text ?? "");
            if (found) {
              setModel(found);
              stop();
            }
          },
          (e) => console.error("pane.read failed", e),
        )
        .finally(() => {
          reading = false;
        });
    };
    read();
    const timer = setInterval(read, STARTUP_MODEL_POLL_MS);
    const wait = setTimeout(stop, STARTUP_MODEL_WAIT_MS);
    return stop;
  }, [armed, pane.machine_id, pane.session, pane.pane_id]);

  return armed ? model : null;
}
