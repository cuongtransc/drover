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
  const line = bannerLine(screen);
  return line ? line.replace(BANNER_EFFORT, "") : null;
}

// After a non-default `/effort` the banner reads `Opus 5.5 with max effort · Claude Max`.
const BANNER_EFFORT = / with (\S+) effort$/;

/** The banner's `<model> · <plan>` line, up to the ` · `; null when no banner is on the screen. */
function bannerLine(screen: string): string | null {
  const lines = screen.split("\n");
  const head = lines.findIndex((l) => /Claude Code v\d/.test(l));
  if (head < 0) return null;
  for (const line of lines.slice(head + 1, head + 4)) {
    const m = /^(.+?) · /.exec(line.replace(FRAME, ""));
    if (m) return m[1];
  }
  return null;
}

/**
 * The Reasoning effort a new Claude shows before its first reply: the banner's `with <level>
 * effort`, else the `◐ medium · /effort` line above the message box. Null without a banner, so
 * a line of a later conversation is not taken for it.
 */
export function parseStartupEffort(screen: string): string | null {
  const line = bannerLine(screen);
  if (!line) return null;
  const inBanner = BANNER_EFFORT.exec(line);
  if (inBanner) return inBanner[1];
  for (const l of screen.split("\n")) {
    const m = /^[\s▔]*\S (\w+) · \/effort[\s▔]*$/.exec(l);
    if (m) return m[1];
  }
  return null;
}

interface ReadResult {
  text?: string;
  read?: { text?: string };
}

export interface StartupMeta {
  model: string | null;
  effort: string | null;
}

const NONE: StartupMeta = { model: null, effort: null };

/** Reads the Model and effort off the pane while `armed`, until both show or the wait runs out. */
export function useStartupModel(pane: PaneRef, armed: boolean): StartupMeta {
  const [found, setFound] = useState<StartupMeta>(NONE);

  useEffect(() => {
    setFound(NONE);
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
            const screen = (r as ReadResult | undefined)?.text ?? (r as ReadResult | undefined)?.read?.text ?? "";
            const model = parseStartupModel(screen);
            const effort = parseStartupEffort(screen);
            if (model || effort) setFound((f) => ({ model: model ?? f.model, effort: effort ?? f.effort }));
            if (model && effort) stop();
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

  return armed ? found : NONE;
}
