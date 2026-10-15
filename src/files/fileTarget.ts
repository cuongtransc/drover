import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { menuSetFileTarget, onMenuFile, openLocalFile, revealLocalFile } from "../lib/ipc";
import { activeItem, useApp } from "../store/app";
import { showToast } from "../ui/Toast";
import { absPath } from "./root";

/** The file File's Reveal in Finder, Open on this Mac and Copy Path act on. */
export interface FileTarget {
  abs: string;
  /** On this Mac, so Finder and its default app can reach it. */
  local: boolean;
}

/** The focused Chat path (its link carries `data-abs`), else the file shown in Files, else none. */
export function fileTarget(): FileTarget | null {
  const el = document.activeElement as HTMLElement | null;
  if (el?.dataset.abs) return { abs: el.dataset.abs, local: el.dataset.local === "1" };
  const s = useApp.getState();
  const item = activeItem(s);
  if (item?.kind !== "file") return null;
  return { abs: absPath(item.root, item.rel), local: s.machines[item.ws.machine_id]?.kind === "local" };
}

const kindOf = (t: FileTarget | null) => (t ? (t.local ? "local" : "remote") : "none");
const message = (e: unknown) => String((e as { message?: string } | null)?.message ?? e);

/** Keeps File's items enabled for the current target, and runs them when chosen. */
export function startFileMenu(): () => void {
  let sent: string | null = null;
  const report = () => {
    const kind = kindOf(fileTarget());
    if (kind === sent) return;
    sent = kind;
    void menuSetFileTarget(kind).catch((e: unknown) => console.error("menu file target failed", e));
  };
  report();
  const unsub = useApp.subscribe((s, prev) => {
    if (s.openItems !== prev.openItems || s.machines !== prev.machines) report();
  });
  // focusout fires before the next element has focus: look once it has settled.
  const onFocus = () => queueMicrotask(report);
  document.addEventListener("focusin", onFocus);
  document.addEventListener("focusout", onFocus);
  const off = onMenuFile((what) => {
    const t = fileTarget();
    if (!t) return;
    if (what === "copy") {
      void writeText(t.abs).then(
        () => showToast("Path copied", { alert: false }),
        (e) => showToast(`Cannot copy ${t.abs}: ${message(e)}`),
      );
    } else if (t.local && what === "reveal") {
      void revealLocalFile(t.abs).catch((e) => showToast(`Cannot show ${t.abs} in Finder: ${message(e)}`));
    } else if (t.local && what === "open") {
      void openLocalFile(t.abs).then(
        (done) => {
          if (done === "revealed") showToast(`Shown in Finder: ${t.abs}`, { alert: false });
        },
        (e) => showToast(`Cannot open ${t.abs}: ${message(e)}`),
      );
    }
  });
  return () => {
    unsub();
    document.removeEventListener("focusin", onFocus);
    document.removeEventListener("focusout", onFocus);
    void off.then((f) => f()).catch(() => {});
  };
}
