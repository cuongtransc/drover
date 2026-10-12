import { create } from "zustand";

/** Shared with store.ts, quickReplies.ts and notify.ts: one JSON object, each writer merges its own keys. */
const SETTINGS_KEY = "drover:settings";

/** As `DEFAULT_HIDDEN` in src-tauri/src/complete/files.rs, which applies when the UI sends none. */
export const DEFAULT_HIDDEN_FOLDERS = [".git", "node_modules", ".venv", "venv", "__pycache__", "target", "dist", "build", ".next", ".worktrees"];

function readRaw(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const p = raw ? (JSON.parse(raw) as unknown) : null;
    return p && typeof p === "object" ? (p as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function save(folders: string[]): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readRaw(), hiddenFolders: folders }));
  } catch {
    /* ignore */
  }
}

/** A name the backend keeps: no `/`, `.`, `..` or control characters (it drops the rest too). */
function isPlainName(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  return name !== "" && name !== "." && name !== ".." && !name.includes("/") && !/[\u0000-\u001f\u007f]/.test(name);
}

/** Plain names only, trimmed, each once; anything but a list falls back to the defaults. */
export function normalizeHiddenFolders(v: unknown): string[] {
  if (!Array.isArray(v)) return [...DEFAULT_HIDDEN_FOLDERS];
  const names = v.filter((n): n is string => typeof n === "string").map((n) => n.trim());
  return [...new Set(names.filter(isPlainName))];
}

/** Why `name` cannot join `folders`, or null when it can. */
export function folderNameError(name: string, folders: string[]): string | null {
  const n = name.trim();
  if (!n) return "Enter a folder name";
  if (!isPlainName(n)) return "A folder name, not a path";
  if (folders.includes(n)) return "Already hidden";
  return null;
}

export function loadHiddenFolders(): string[] {
  return normalizeHiddenFolders(readRaw().hiddenFolders);
}

interface HiddenFoldersStore {
  /** Sent with every file listing and the Files watch. */
  folders: string[];
  /** False when the name is not added (see `folderNameError`). */
  add: (name: string) => boolean;
  remove: (name: string) => void;
  reset: () => void;
}

export const useHiddenFolders = create<HiddenFoldersStore>((set, get) => {
  const put = (folders: string[]) => {
    save(folders);
    set({ folders });
  };
  return {
    folders: loadHiddenFolders(),
    add: (name) => {
      if (folderNameError(name, get().folders) !== null) return false;
      put([...get().folders, name.trim()]);
      return true;
    },
    remove: (name) => put(get().folders.filter((f) => f !== name)),
    reset: () => put([...DEFAULT_HIDDEN_FOLDERS]),
  };
});
