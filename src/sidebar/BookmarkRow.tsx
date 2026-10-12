import { useMemo, useState } from "react";
import { useActiveKeptMs, useMinuteClock } from "../agents/paneFilter";
import { useApp } from "../store/app";
import { CheckIcon, StarOffIcon } from "../ui/icons";
import { reopenKept } from "../workspaces/keptActions";
import { useActions } from "./actions";
import { useViewOrigin } from "./activeFilter";
import { useDragState } from "./dnd";
import { setBookmarked, useLayout } from "./groups";
import type { RBookmark } from "./groups";
import { WORD } from "./ProjectRows";
import { sessionProjects } from "./projects";
import { indicatorClass, useBookmarkRowDnd } from "./useRowDnd";

/**
 * A bookmarked project (ADR 0006): its state, its name, its Session muted after it (names repeat across
 * Sessions), then Blocked / Review or its lanes. A click opens the pane behind it, as its row in the
 * tree does. A project whose Workspace (or Session) is gone stays, muted, saying "closed".
 */
export function BookmarkRow({ bookmark: b, nextKey }: { bookmark: RBookmark; nextKey: string | null }) {
  const doneSeen = useApp((s) => s.doneSeen);
  const since = useApp((s) => s.statusSince);
  const now = useMinuteClock();
  const keptMs = useActiveKeptMs();
  const row = useMemo(
    () => (b.node ? sessionProjects(b.node.machine, b.node.session, doneSeen, true, since, now, keptMs).find((r) => r.label === b.label) ?? null : null),
    [b, doneSeen, since, now, keptMs],
  );
  const openProject = useApp((s) => s.openProject);
  const kept = useLayout((s) => s.layout.kept?.[b.key]);
  const setOrigin = useViewOrigin((s) => s.set);
  const clickedHere = useViewOrigin((s) => s.from === "bookmarks");
  // Lit when the selected pane is in this project and the user got there from Bookmarks.
  const holdsSelected = useApp((s) => {
    const sel = s.selected;
    if (!row || !b.node || sel?.machine_id !== b.node.machine.id || sel.session !== b.node.session.name) return false;
    return b.node.session.workspaces.some((w) => w.workspace_id === row.id && w.tabs.some((t) => t.panes.some((p) => p.pane_id === sel.pane_id)));
  });
  const lit = holdsSelected && clickedHere;
  const a = useActions();
  const drag = useDragState();
  const dnd = useBookmarkRowDnd(b.key, nextKey);
  const word = row ? WORD[row.state] : undefined;
  const lanes = row && row.state === "working" && row.lanes > 0 ? `${row.lanes} ${row.lanes === 1 ? "lane" : "lanes"}` : null;
  const node = b.node;
  // Stay disabled until workspace.create settles, so a double click makes one Workspace (ADR 0008).
  const [pending, setPending] = useState(false);
  const open = () => {
    if (pending) return;
    // A closed Bookmark whose Workspace is kept opens it again in the folder it was kept with (ADR 0008).
    if (!row && kept && node && node.machine.state === "connected" && node.session.running) {
      setPending(true);
      setOrigin("bookmarks");
      a?.guard(() =>
        reopenKept(node.machine.id, node.session.name, { key: b.key, label: b.label, folder: kept.folder }).finally(() => setPending(false)),
      );
      return;
    }
    if (!row?.target || !node) return;
    setOrigin("bookmarks");
    openProject({ machine_id: node.machine.id, session: node.session.name }, row);
  };
  const unbookmark = { label: "Unbookmark", icon: StarOffIcon, onSelect: () => useLayout.getState().update((l) => setBookmarked(l, b.key, false)) };
  return (
    <li className="bookmark">
      <button
        {...dnd}
        type="button"
        className={"row bm-row " + (row ? row.state : "closed") + (lit ? " active" : "") + indicatorClass(drag, `bookmark:${b.key}`)}
        aria-current={lit ? "true" : undefined}
        aria-label={[b.label, b.sessionName, word?.toLowerCase() ?? lanes ?? (row ? null : "closed")].filter(Boolean).join(", ")}
        disabled={pending}
        onClick={open}
        onContextMenu={(e) => a?.menu(e, [unbookmark])}
      >
        <span className="slot" aria-hidden="true">
          {row?.state === "review" ? <CheckIcon className="icon mark-done" /> : <span className="project-dot" />}
        </span>
        <span className="label">{b.label}</span>
        <span className="bm-session">{b.sessionName}</span>
        {word ? <span className={"project-word " + row!.state}>{word}</span> : (lanes ?? !row) && <span className="project-meta">{lanes ?? "closed"}</span>}
      </button>
    </li>
  );
}
