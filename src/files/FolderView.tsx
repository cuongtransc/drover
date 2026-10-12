import { useEffect, useState } from "react";
import { filesListDir } from "../lib/ipc";
import type { FileEntry } from "../lib/types";
import { useApp } from "../store/app";
import { FileIcon, FolderIcon } from "../ui/icons";
import type { WorkspaceRef } from "../workspaces/folder";

const isFolder = (kind: FileEntry["kind"]) => kind === "dir" || kind === "dirlink";

/**
 * A folder opened as an item (a folder path clicked in Chat): what is in it, each opening as its
 * own item. Every name is listed, hidden folders too: the folder was asked for by its path.
 */
export function FolderView({ ws, root, rel, reload }: { ws: WorkspaceRef; root: string; rel: string; reload: number }) {
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    filesListDir(ws.machine_id, root, rel, [], true).then(
      (list) => {
        if (!live) return;
        setEntries(list);
        setError(null);
      },
      (e) => live && setError(String((e as { message?: string } | null)?.message ?? e)),
    );
    return () => {
      live = false;
    };
  }, [ws.machine_id, root, rel, reload]);

  if (error) return <div className="files-notice" role="alert">{error}</div>;
  if (!entries) return null;
  if (entries.length === 0) return <div className="files-notice">Empty folder</div>;
  return (
    <ul className="files-folder" aria-label={rel}>
      {entries.map((ent) => (
        <li key={ent.name}>
          <button
            type="button"
            className="files-tree-row"
            onClick={() => useApp.getState().openFile(ws, root, `${rel}/${ent.name}`, { pin: false })}
          >
            {isFolder(ent.kind) ? <FolderIcon className="icon files-tree-icon" /> : <FileIcon className="icon files-tree-icon" />}
            <span className="files-tree-name">{ent.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
