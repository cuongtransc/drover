import type { PaneRef } from "../lib/types";
import { useApp } from "../store/app";
import { itemKey } from "../store/openItems";
import { showToast } from "../ui/Toast";
import type { WorkspaceRef } from "../workspaces/folder";
import { useFilesBus } from "./bus";

/** `abs` relative to `root`, or null when it is not inside it. */
export function relUnder(abs: string, root: string): string | null {
  const base = root.endsWith("/") ? root : `${root}/`;
  return abs.startsWith(base) && abs.length > base.length ? abs.slice(base.length) : null;
}

/** Opens `abs` (a path on `ref`'s machine, e.g. clicked in Chat) as a file item under `root`, at
 *  `line`. A path outside `root` only says so. Clicked in the Chat of `from`, that agent's tab is
 *  pinned first, so the file opens beside it instead of replacing it. */
export function openInFiles(ref: WorkspaceRef, root: string, abs: string, line: number | null, from?: PaneRef): void {
  const rel = relUnder(abs, root);
  if (!rel) {
    showToast(`${abs} is outside this workspace's folder (${root})`);
    return;
  }
  useFilesBus.getState().setJump(line ? { key: itemKey({ kind: "file", ws: ref, root, rel }), hash: `L${line}` } : null);
  if (from) useApp.getState().pinItem(itemKey({ kind: "agent", ref: from }));
  useApp.getState().openFile(ref, root, rel, { pin: false });
}
