import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_HIDDEN_FOLDERS, folderNameError, loadHiddenFolders, normalizeHiddenFolders, useHiddenFolders } from "./hiddenFolders";

const KEY = "drover:settings";

beforeEach(() => {
  localStorage.clear();
  useHiddenFolders.setState({ folders: loadHiddenFolders() });
});

describe("hidden folders", () => {
  it("defaults to the folders the backend hid before", () => {
    expect(loadHiddenFolders()).toEqual(DEFAULT_HIDDEN_FOLDERS);
    expect(DEFAULT_HIDDEN_FOLDERS).toEqual([".git", "node_modules", ".venv", "venv", "__pycache__", "target", "dist", "build", ".next", ".worktrees"]);
  });

  it("keeps plain names once, trimmed; anything but a list falls back to the defaults", () => {
    expect(normalizeHiddenFolders([" out ", "", ".", "..", "a/b", "x\ny", 3, "out", "dist"])).toEqual(["out", "dist"]);
    expect(normalizeHiddenFolders("out")).toEqual(DEFAULT_HIDDEN_FOLDERS);
    expect(normalizeHiddenFolders([])).toEqual([]);
  });

  it("says why a name cannot be added", () => {
    expect(folderNameError("out", [])).toBeNull();
    expect(folderNameError("  ", [])).toBe("Enter a folder name");
    expect(folderNameError("a/b", [])).toBe("A folder name, not a path");
    expect(folderNameError("..", [])).toBe("A folder name, not a path");
    expect(folderNameError(" out", ["out"])).toBe("Already hidden");
  });

  it("adds, removes and resets, saving next to the other settings", () => {
    localStorage.setItem(KEY, JSON.stringify({ notifications: false }));
    const s = () => useHiddenFolders.getState();
    expect(s().add(" coverage ")).toBe(true);
    expect(s().add("coverage")).toBe(false);
    expect(s().folders[s().folders.length - 1]).toBe("coverage");
    s().remove("node_modules");
    expect(s().folders).not.toContain("node_modules");
    const saved = JSON.parse(localStorage.getItem(KEY)!);
    expect(saved.notifications).toBe(false);
    expect(saved.hiddenFolders).toEqual(s().folders);
    expect(loadHiddenFolders()).toEqual(s().folders);
    s().reset();
    expect(s().folders).toEqual(DEFAULT_HIDDEN_FOLDERS);
    expect(loadHiddenFolders()).toEqual(DEFAULT_HIDDEN_FOLDERS);
  });

  it("keeps an emptied list empty", () => {
    for (const f of DEFAULT_HIDDEN_FOLDERS) useHiddenFolders.getState().remove(f);
    expect(loadHiddenFolders()).toEqual([]);
  });
});
