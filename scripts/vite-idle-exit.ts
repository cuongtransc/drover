import type { Plugin } from "vite";

/**
 * Stops a dev server nobody uses. Agents start `nohup pnpm exec vite --port 144x &` to look at
 * the UI in a browser and leave it running: on 2026-10-12, five from 2026-10-07 held about 1 GB
 * each. They are reparented to launchd as soon as the agent's shell exits, so the parent process
 * cannot tell an abandoned server from one in use; traffic can. `tauri dev` keeps its webview's
 * HMR socket open, so it never idles out.
 */
export function idleExit(): Plugin {
  return {
    name: "drover-idle-exit",
    apply: "serve",
    configureServer(server) {
      // vitest runs on a Vite server too; `vitest` in watch mode sits idle on purpose.
      if (process.env.VITEST) return;
      const minutes = idleMinutes(process.env.DROVER_VITE_IDLE_MINUTES);
      if (minutes === 0) return;
      const watch = idleWatch({
        idleMs: minutes * 60_000,
        now: Date.now,
        onIdle: () => {
          server.config.logger.info(`no request or client for ${minutes} min, exiting (DROVER_VITE_IDLE_MINUTES=0 keeps it)`);
          void server.close().finally(() => process.exit(0));
        },
      });
      server.middlewares.use((_req, _res, next) => {
        watch.touch();
        next();
      });
      server.ws.on("connection", (socket) => {
        watch.open();
        socket.on("close", () => watch.close());
      });
      setInterval(watch.check, Math.min(60_000, minutes * 15_000)).unref();
    },
  };
}

/** Minutes from `DROVER_VITE_IDLE_MINUTES`: 30 when unset or unreadable, 0 for never. */
export function idleMinutes(raw: string | undefined): number {
  if (!raw) return 30;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

/** Calls `onIdle` once when no client is connected and nothing touched it for `idleMs`. */
export function idleWatch({ idleMs, now, onIdle }: { idleMs: number; now: () => number; onIdle: () => void }) {
  let last = now();
  let clients = 0;
  let fired = false;
  return {
    touch: () => {
      last = now();
    },
    open: () => {
      clients += 1;
      last = now();
    },
    close: () => {
      clients = Math.max(0, clients - 1);
      last = now();
    },
    check: () => {
      if (fired || clients > 0 || now() - last < idleMs) return;
      fired = true;
      onIdle();
    },
  };
}
