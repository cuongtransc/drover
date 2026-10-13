import { memo } from "react";
import type { ReactNode } from "react";
import { chatLocate, herdrCall, sessionStart } from "../lib/ipc";
import { paneKey } from "../lib/types";
import type { AgentStatus, PaneRef, PaneView, SessionView, TabView, WorkspaceView } from "../lib/types";
import { useFilesPanel } from "../files/panelStore";
import { useApp } from "../store/app";
import { itemKey } from "../store/openItems";
import { stepTriage, triageQueue } from "../dashboard/triage";
import type { MenuEntry, MenuItem } from "../sidebar/ContextMenu";
import { ActionsProvider, useActions } from "../sidebar/actions";
import { ActiveToggle } from "../sidebar/ActiveToggle";
import { BookIcon, BotIcon, CheckIcon, CopyIcon, GitBranchIcon, LayersIcon, LockIcon, UnplugIcon, ArchiveIcon, ChevronIcon, CloseIcon, FolderOpenIcon, PencilIcon, PlusIcon, SplitDownIcon, SplitRightIcon, TerminalIcon } from "../ui/icons";
import { firstWorkspaceFolder, folderName, suggestFolder, useFolder } from "../workspaces/folder";
import { beginWorkspaceRename, endWorkspaceRename, saveWorkspaceFolder } from "../workspaces/keptActions";
import { forgetKept, projectKey, renameProjectKey, setKept, useLayout } from "../sidebar/groups";
import { ClosedSection } from "./ClosedSection";
import { AgentIcon } from "./AgentIcon";
import { isProtected, protectedIn, useProtect } from "./protect";
import { forkBlocked, forkSession } from "./forkSession";
import { copyTranscriptPath } from "./transcriptPath";
import { busyIn, busyWhy, idleLabel, paneState, useActiveKeptMs, useMinuteClock, usePaneFilter } from "./paneFilter";
import { useLaneRecords } from "./laneOwners";
import { laneTitle, sessionRoles, tabRole } from "./roles";
import { AGENTS, openAgentTab } from "./openAgentTab";
import { useTabReorder } from "./tabDnd";

export interface PaneEntry {
  pane: PaneView;
  workspace: WorkspaceView;
  tab: TabView;
  /** The tab label when the workspace has several tabs, else "". */
  sub: string;
}

/** A session's workspaces in order, each with its panes (empty workspaces included). */
export function workspaceGroups(session: SessionView): { workspace: WorkspaceView; entries: PaneEntry[] }[] {
  return session.workspaces.map((workspace) => ({
    workspace,
    entries: workspace.tabs.flatMap((tab) =>
      tab.panes.map((pane) => ({ pane, workspace, tab, sub: workspace.tabs.length > 1 ? tab.label : "" })),
    ),
  }));
}

/** Splits a workspace's rows into consecutive runs sharing a tab. */
function tabRuns(rows: Row[]): Row[][] {
  const runs: Row[][] = [];
  for (const r of rows) {
    const last = runs[runs.length - 1];
    if (last && last[0].entry.tab.tab_id === r.entry.tab.tab_id) last.push(r);
    else runs.push([r]);
  }
  return runs;
}

/** What a row's accessible name says about its status; "" for a shell, which herdr reports none for. */
function statusWord(status: AgentStatus, seen: boolean, agent: boolean, lane: boolean): string {
  if (status === "blocked") return "blocked";
  if (status === "working") return "in progress";
  if (status === "done") return seen || lane ? "done" : "review";
  if (status === "idle") return "idle";
  return agent ? "state unknown" : "";
}

/** A pane with how Active treats it (paneFilter.ts). */
interface Row {
  entry: PaneEntry;
  /** The pane's store key (paneKey). */
  key: string;
  quiet: boolean;
  /** Set on an agent kept in Active for having gone idle recently. */
  idleFor: number | null;
  /** An orchestrator, or a lane (roles.ts `sessionRoles`). */
  role: "orch" | "lane" | null;
  /** A lane's owner (a pane id): the lane folds under that pane's row. */
  owner?: string;
  /** A lane whose owner is unknown or gone: it shows on its own, marked. */
  orphan?: true;
}

/** A folded lane: one with an owner to fold under. */
const folded = (r: Row) => r.role === "lane" && !r.orphan;


/** "1 in progress, 1 done, 1 blocked" over some lanes. */
function laneSummary(lanes: Row[]): string {
  const n = (s: AgentStatus) => lanes.filter((r) => r.entry.pane.status === s).length;
  const parts: [number, string][] = [[n("working"), "in progress"], [n("done"), "done"], [n("blocked"), "blocked"], [n("idle"), "idle"]];
  return parts.filter(([c]) => c > 0).map(([c, w]) => `${c} ${w}`).join(", ");
}

/** The mark at a row's end: only the states that ask for a look carry one. `slot` goes between the
 *  word and the mark: the place the lane toggle, laid over the row, covers. */
function StatusMark({ status, seen, agent, lane, slot }: { status: AgentStatus; seen: boolean; agent: boolean; lane: boolean; slot?: ReactNode }) {
  if (status === "blocked")
    return (
      <>
        <span className="agent-input">Blocked</span>
        {slot}
        <span className="mark mark-blocked" aria-hidden="true" />
      </>
    );
  if (status === "working")
    return (
      <>
        {slot}
        <span className="mark mark-working" aria-hidden="true" />
      </>
    );
  if (status === "done" && !seen && !lane)
    return (
      <>
        <span className="agent-review">Review</span>
        {slot}
        <CheckIcon className="icon mark-done" aria-hidden="true" />
      </>
    );
  if (status === "unknown" && agent)
    return (
      <>
        {slot}
        <span className="mark-unknown" title="herdr can't read this agent's state (started through a wrapper?)">
          ?
        </span>
      </>
    );
  return (
    <>
      {slot}
      <span className="mark" aria-hidden="true" />
    </>
  );
}

type Reorder = ReturnType<typeof useTabReorder>;

/** Fork session and Fork into a new worktree, both off with the reason under them while the pane cannot fork. */
function forkItems(a: NonNullable<ReturnType<typeof useActions>>, ref: PaneRef, ws: WorkspaceView, pane: PaneView): MenuItem[] {
  const why = forkBlocked(pane) ?? undefined;
  const fork = (worktree: boolean) => () =>
    a.guard(() => forkSession(ref, ws, pane, { worktree }, { call: (m, p) => herdrCall(ref.machine_id, ref.session, m, p), locate: chatLocate }));
  return [
    { label: "Fork session", icon: GitBranchIcon, disabled: !!why, onSelect: fork(false) },
    { label: "Fork into a new worktree", icon: GitBranchIcon, disabled: !!why, note: why, onSelect: fork(true) },
  ];
}

/** `tabRow` when this card is its Tab's whole row (a single-pane Tab), so it is also the drop target. */
function AgentCard({
  machineId,
  session,
  row,
  reorder,
  tabRow,
  lanes,
}: {
  machineId: string;
  session: string;
  row: Row;
  reorder: Reorder;
  tabRow?: boolean;
  /** On the orchestrator's row: its lanes' toggle. */
  lanes?: { rows: Row[]; open: boolean; toggle: () => void };
}) {
  const { entry, quiet, idleFor } = row;
  const { pane, workspace: ws, tab } = entry;
  // The badge says "lane" or "brief", so the title drops the prefix that said it.
  const tabKind = tabRole(tab.label);
  const title = row.role === "lane" || tabKind === "lane" || tabKind === "brief" ? laneTitle(pane.title) : pane.title;
  const ref = { machine_id: machineId, session, pane_id: pane.pane_id };
  const active = useApp((s) => s.selected !== null && paneKey(s.selected) === paneKey(ref));
  const pin = useApp((s) => s.pinItem);
  const seen = useApp((s) => !!s.doneSeen[paneKey(ref)]);
  const lane = tabRole(tab.label) === "lane";
  const word = statusWord(pane.status, seen, !!pane.agent, lane);
  // The tab's name only when it says more than its number.
  const activity = pane.agent ? "" : (pane.activity ?? "");
  const sub = entry.sub && !/^\d+$/.test(entry.sub) ? entry.sub : "";
  const select = useApp((s) => s.select);
  const a = useActions();
  const call = (method: string, params: unknown) => () => herdrCall(machineId, session, method, params);
  const close = call("pane.close", { pane_id: pane.pane_id });
  const key = paneKey(ref);
  const isProt = useProtect((s) => isProtected(s.marks, key, row.role === "orch" || (tabRole(tab.label) === "orch" && !!pane.agent)));
  // A one-pane Tab closes with its pane: one Close tab, which acts as Close pane (off while protected).
  const onlyPane = tab.panes.length === 1;
  const closeLabel = onlyPane ? "Close tab" : "Close pane";
  // Asks first when the pane has work running; otherwise closes at once.
  const closeChecked = () => {
    const why = busyWhy(pane);
    if (why) a?.confirm(closeLabel, `${closeLabel} "${title}"? ${why}`, "Close", close, [], { cancelFirst: true });
    else a?.guard(close);
  };
  const closePane: MenuItem = isProt
    ? { label: closeLabel, icon: CloseIcon, disabled: true, note: "Protected: unprotect it to close", onSelect: () => {} }
    : { label: closeLabel, icon: CloseIcon, onSelect: closeChecked };
  const items: MenuEntry[] = a
    ? [
        { label: "Rename pane…", icon: PencilIcon, onSelect: () => a.rename("Rename pane", pane.title, (label) => call("pane.rename", { pane_id: pane.pane_id, label })()) },
        { label: "Split right", icon: SplitRightIcon, onSelect: () => a.guard(call("pane.split", { target_pane_id: pane.pane_id, direction: "right" })) },
        { label: "Split down", icon: SplitDownIcon, onSelect: () => a.guard(call("pane.split", { target_pane_id: pane.pane_id, direction: "down" })) },
        { label: isProt ? "Protected" : "Protect", icon: LockIcon, checked: isProt, onSelect: () => useProtect.getState().set(key, !isProt) },
        ...(onlyPane ? [] : [closePane]),
        "sep",
        ...(pane.agent === "claude" ? forkItems(a, ref, ws, pane) : []),
        ...(pane.agent === "claude" || pane.agent === "pi"
          ? [{ label: "Copy transcript path", icon: CopyIcon, onSelect: () => void copyTranscriptPath(ref) }]
          : []),
        "sep",
        { label: "Rename tab…", icon: PencilIcon, onSelect: () => a.rename("Rename tab", tab.label, (label) => call("tab.rename", { tab_id: tab.tab_id, label })()) },
        onlyPane
          ? closePane
          : {
              label: "Close tab",
              icon: CloseIcon,
              onSelect: () => {
                const inTab = new Set(tab.panes.map((p) => paneKey({ machine_id: machineId, session, pane_id: p.pane_id })));
                const prot = protectedIn(machineId, session, [ws], useProtect.getState().marks).filter((p) => inTab.has(p.key));
                const busy = busyIn(machineId, session, [{ ...ws, tabs: [tab] }], new Set(prot.map((p) => p.key)));
                const closeTab = call("tab.close", { tab_id: tab.tab_id });
                // Asks only when closing ends work or a protected pane (ui-ux-guidelines §4.3).
                if (prot.length === 0 && busy.length === 0) a.guard(closeTab);
                else a.confirm("Close tab", `Close tab "${tab.label}" and all its panes?`, "Close", closeTab, prot, { busy });
              },
            },
      ]
    : [];
  const laneToggleText = lanes && (
    <>
      {lanes.rows.length} {lanes.rows.length === 1 ? "lane" : "lanes"}
      <ChevronIcon className={"icon chev" + (lanes.open ? " open" : "")} />
    </>
  );
  return (
    <li
      className={"agent-card-item" + (folded(row) ? " lane-row" : "") + (lanes ? " has-lanes" : "") + (tabRow ? reorder.indicatorClass(tab.tab_id) : "")}
      {...(tabRow ? reorder.target(tab.tab_id) : {})}
    >
      <button
        {...reorder.source(tab.tab_id)}
        className={"agent-card" + (active ? " active" : "") + (pane.status === "blocked" ? " blocked" : "") + (pane.agent ? "" : " shell") + (quiet ? " quiet" : "")}
        aria-label={`${title}${activity ? ` · ${activity}` : ""}, ${pane.agent ?? "shell"}${word ? `, ${word}` : ""}`}
        aria-current={active ? "true" : undefined}
        onClick={() => select(ref)}
        onDoubleClick={() => pin(itemKey({ kind: "agent", ref }))}
        onContextMenu={(e) => a?.menu(e, items)}
        // The tab's name and the folder live in the tooltip: on the row they crowded the title.
        title={[sub, pane.cwd].filter(Boolean).join(" · ") || undefined}
      >
        <AgentIcon agent={pane.agent} />
        <span className={"agent-card-title" + (activity ? " has-activity" : "")}>{title}</span>
        {/* A role mark the width of the lock. A lane says it by its place under the pane that owns it, and
            that pane by its "N lanes" toggle, so neither needs one. */}
        {(row.role === "orch" || tabKind === "orch") && !lanes && (
          <span className="role-mark" role="img" aria-label="Orchestrator" title="Orchestrator: dispatches lanes">
            <LayersIcon />
          </span>
        )}
        {tabKind === "brief" && (
          <span className="role-mark" role="img" aria-label="Brief" title="Brief: a decision to study">
            <BookIcon />
          </span>
        )}
        {row.orphan && (
          <span className="role-mark orphan" role="img" aria-label="Orphan lane" title="Orphan lane: no orchestrator owns it (the lane store names none, or its pane is gone)">
            <UnplugIcon />
          </span>
        )}
        {isProt && (
          <span className="agent-card-lock" role="img" aria-label={`Protected: ${title}`} title="Protected: close is turned off (right-click to unprotect)">
            <LockIcon />
          </span>
        )}
        {activity && <span className="agent-card-activity">{activity}</span>}
        {!quiet && idleFor !== null && (
          <span className="row-age" title={`Idle for ${idleLabel(idleFor)}`}>
            {idleLabel(idleFor)}
          </span>
        )}
        <StatusMark
          status={pane.status}
          seen={seen}
          agent={!!pane.agent}
          lane={lane}
          // The toggle is a button of its own, so it cannot sit in this one: an invisible twin keeps its room.
          slot={lanes && <span className="lane-toggle lane-slot" aria-hidden="true">{laneToggleText}</span>}
        />
      </button>
      {lanes && (
        <button className="lane-toggle" aria-expanded={lanes.open} title={laneSummary(lanes.rows)} onClick={lanes.toggle}>
          {laneToggleText}
        </button>
      )}
      {!isProt && (
        <button className="agent-card-close" aria-label={`${closeLabel} ${title}`} title={closeLabel} onClick={closeChecked}>
          <CloseIcon />
        </button>
      )}
    </li>
  );
}

function WorkspaceGroup({ machineId, session, workspace: ws, rows: all, active }: { machineId: string; session: string; workspace: WorkspaceView; rows: Row[]; active: boolean }) {
  const a = useActions();
  const ref = { machine_id: machineId, session, workspace_id: ws.workspace_id };
  const folder = useFolder(ref);
  const layout = useLayout((s) => s.layout);
  const keptKey = projectKey(machineId, session, ws.label);
  const kept = keptKey in (layout.kept ?? {});
  const bookmarked = layout.bookmarks.includes(keptKey);
  const call = (method: string, params: unknown) => () => herdrCall(machineId, session, method, params);
  // The header folds the whole workspace (§7.1); Active leaves out the quiet panes.
  const foldKey = `ws:${machineId}/${session}/${ws.workspace_id}`;
  const open = useApp((s) => s.expanded[foldKey] ?? true);
  const toggle = useApp((s) => s.toggle);
  const selected = useApp((s) => (s.selected ? paneKey(s.selected) : null));
  const doneSeen = useApp((s) => s.doneSeen);
  const entries = all.map((r) => r.entry);
  const keyOf = (e: PaneEntry) => paneKey({ machine_id: machineId, session, pane_id: e.pane.pane_id });
  // The selected pane always shows, so ⌘J and the palette never land on a hidden row.
  // Lanes sit right under the pane that owns them and fold behind it; one that needs input, or the
  // selected one, still shows. An orphan lane is a row of its own.
  const expanded = useApp((s) => s.expanded);
  const lanesKey = (owner: string) => `lanes:${machineId}/${session}/${owner}`;
  const lanesOf = (r: Row) => all.filter((l) => folded(l) && l.owner === r.entry.pane.pane_id);
  const ordered = all.filter((r) => !folded(r)).flatMap((r) => [r, ...lanesOf(r)]);
  const inView = (r: Row) =>
    folded(r) ? (expanded[lanesKey(r.owner!)] ?? false) || r.entry.pane.status === "blocked" : !active || !r.quiet;
  const shown = ordered.filter((r) => r.key === selected || (open && inView(r)));
  const lanesFor = (r: Row) => {
    const rows = lanesOf(r);
    if (rows.length === 0) return undefined;
    const key = lanesKey(r.entry.pane.pane_id);
    const isOpen = expanded[key] ?? false;
    return { rows, open: isOpen, toggle: () => toggle(key, isOpen) };
  };
  const need = entries.filter((e) => {
    if (!e.pane.agent) return false;
    return e.pane.status === "blocked" || (e.pane.status === "done" && tabRole(e.tab.label) !== "lane" && !doneSeen[keyOf(e)]);
  }).length;
  const reorder = useTabReorder(
    ws.tabs.map((t) => t.tab_id),
    (tab_id, insert_index) => a?.guard(call("tab.move", { tab_id, insert_index })),
  );
  // The panel follows the active item, else the selected Pane: browsing a Workspace selects its selected
  // pane again (or its first), which also leaves a file item of another Workspace.
  const browse = () => {
    const panes = ws.tabs.flatMap((t) => t.panes);
    const sel = useApp.getState().selected;
    const inWs = sel && sel.machine_id === machineId && sel.session === session && panes.some((p) => p.pane_id === sel.pane_id);
    if (!inWs && !panes[0]) return;
    useApp.getState().select(inWs ? sel : { machine_id: machineId, session, pane_id: panes[0].pane_id });
    useFilesPanel.getState().focusTree();
  };
  const items: MenuItem[] = a
    ? [
        // Starts straight away in the workspace folder (else a pane's cwd, else herdr's default).
        ...AGENTS.map((agent) => ({
          label: `New ${agent}`,
          icon: agent === "shell" ? TerminalIcon : BotIcon,
          onSelect: () => a.guard(() => openAgentTab(machineId, session, ws.workspace_id, agent, folder ?? suggestFolder(ws))),
        })),
        { label: "Browse files", icon: FolderOpenIcon, onSelect: browse },
        { label: "Change folder…", icon: FolderOpenIcon, onSelect: () => a.changeFolder(machineId, folder ?? suggestFolder(ws), (path) => saveWorkspaceFolder(ref, ws.label, path)) },
        { label: "Rename workspace…", icon: PencilIcon, onSelect: () => a.rename("Rename workspace", ws.label, (label) => {
          const from = projectKey(machineId, session, ws.label);
          const to = projectKey(machineId, session, label);
          // Neither key may read as closed or reopen until herdr accepted the rename and the layout moved;
          // a rejection leaves the layout as it is.
          beginWorkspaceRename(from, to);
          return call("workspace.rename", { workspace_id: ws.workspace_id, label })()
            .then(() => {
              // Another live Workspace still carrying the old label keeps the kept entry and Bookmark;
              // the renamed one starts un-kept.
              const sibling = useApp.getState().machines[machineId]?.sessions.find((x) => x.name === session)
                ?.workspaces.some((w) => w.workspace_id !== ws.workspace_id && w.label === ws.label);
              if (!sibling) useLayout.getState().update((l) => renameProjectKey(l, from, to));
            })
            .finally(() => endWorkspaceRename(from, to));
        }) },
        {
          label: "Keep when closed",
          icon: ArchiveIcon,
          checked: kept,
          disabled: bookmarked,
          note: bookmarked ? "Bookmarked" : undefined,
          onSelect: () =>
            useLayout.getState().update((l) =>
              kept
                ? forgetKept(l, keptKey)
                : setKept(
                    l,
                    keptKey,
                    firstWorkspaceFolder(
                      machineId,
                      session,
                      useApp.getState().machines[machineId]?.sessions.find((x) => x.name === session)?.workspaces ?? [],
                      ws.label,
                    ),
                  ),
            ),
        },
        {
          label: "Close workspace",
          icon: CloseIcon,
          onSelect: () => {
            const prot = protectedIn(machineId, session, [ws], useProtect.getState().marks);
            const busy = busyIn(machineId, session, [ws], new Set(prot.map((p) => p.key)));
            const closeWs = call("workspace.close", { workspace_id: ws.workspace_id });
            if (prot.length === 0 && busy.length === 0) a.guard(closeWs);
            else a.confirm("Close workspace", `Close workspace "${ws.label}" and all its panes?`, "Close", closeWs, prot, { busy });
          },
        },
      ]
    : [];
  return (
    <section role="group" aria-label={ws.label} className="ws-group">
      <div className="ws-head" onContextMenu={(e) => a?.menu(e, items)}>
        <button
          className="ws-label"
          aria-expanded={open}
          aria-label={!open && need ? `${ws.label}, ${need} ${need === 1 ? "needs" : "need"} you` : undefined}
          onClick={() => toggle(foldKey, open)}
        >
          {ws.label}
        </button>
        {folder && <span className="ws-folder" title={folder}>{folderName(folder)}</span>}
        {!open && need > 0 && <span className="need" aria-hidden="true">{need}</span>}
        <button className="ws-add" aria-label={`New agent in ${ws.label}`} onClick={() => a?.newAgent(machineId, session, ws)}>
          <PlusIcon />
        </button>
      </div>
      {shown.length > 0 && rows(shown)}
    </section>
  );

  function rows(list: Row[]) {
    return (
        <ul className="agent-cards">
          {tabRuns(list).map((run) =>
            run.length > 1 ? (
              <li
                key={run[0].entry.tab.tab_id}
                role="group"
                aria-label={`Tab ${run[0].entry.tab.label}`}
                className={"tab-group" + reorder.indicatorClass(run[0].entry.tab.tab_id)}
                {...reorder.target(run[0].entry.tab.tab_id)}
              >
                <ul className="agent-cards">
                  {run.map((r) => (
                    <AgentCard key={r.entry.pane.pane_id} machineId={machineId} session={session} row={r} reorder={reorder} lanes={lanesFor(r)} />
                  ))}
                </ul>
              </li>
            ) : (
              <AgentCard key={run[0].entry.pane.pane_id} machineId={machineId} session={session} row={run[0]} reorder={reorder} lanes={lanesFor(run[0])} tabRow />
            ),
          )}
        </ul>
    );
  }
}

function StoppedSession({ machineId, session }: { machineId: string; session: string }) {
  const a = useActions();
  return (
    <div className="agents-stopped">
      <span>Stopped</span>
      <button className="btn btn-xs" aria-label={`Start ${session}`} onClick={() => a?.guard(() => sessionStart(machineId, session))}>
        Start
      </button>
    </div>
  );
}

/** The ⌘J queue (triage.ts) narrowed to one session. */
function sessionQueue(s: ReturnType<typeof useApp.getState>, machineId: string, session: string) {
  const machine = s.machines[machineId];
  if (!machine) return [];
  return triageQueue({ [machineId]: machine }, [machineId], s.doneSeen, s.statusSince).filter((c) => c.ref.session === session);
}

/** "1 blocked · 2 review" for the viewed session: a click selects the next of them, Blocked first. */
function SessionQueueChip({ machineId, session }: { machineId: string; session: string }) {
  // "waiting:done" as one string, so the selector's value compares equal between renders.
  const counts = useApp((s) => {
    const q = sessionQueue(s, machineId, session);
    const waiting = q.filter((c) => c.bucket === "attention").length;
    return `${waiting}:${q.length - waiting}`;
  });
  const [waiting, done] = counts.split(":").map(Number);
  if (!waiting && !done) return null;
  const parts = [waiting && `${waiting} blocked`, done && `${done} review`].filter(Boolean) as string[];
  const next = () => {
    const s = useApp.getState();
    const q = sessionQueue(s, machineId, session);
    const at = stepTriage(q.map((c) => c.key), s.selected ? paneKey(s.selected) : null, -1, 1);
    if (at >= 0) s.select(q[at].ref);
  };
  return (
    <button
      type="button"
      className="need-chip"
      aria-label={`${parts.join(", ")}: go to the next one in this session`}
      title="Next Blocked or Review in this session"
      onClick={next}
    >
      {waiting > 0 && <span className="need-waiting">{waiting} blocked</span>}
      {waiting > 0 && done > 0 && " · "}
      {done > 0 && <span className="need-done">{done} review</span>}
    </button>
  );
}

function NewWorkspaceButton({ machineId, session }: { machineId: string; session: string }) {
  const a = useActions();
  return (
    <button className="ws-add" aria-label="New workspace" title="New workspace" onClick={() => a?.newWorkspace(machineId, session)}>
      <PlusIcon />
    </button>
  );
}

// Takes no props: memo keeps it out of App's re-renders; it reads the store itself.
export const AgentList = memo(function AgentList() {
  const viewed = useApp((s) => s.viewed);
  const session = useApp((s) =>
    s.viewed ? s.machines[s.viewed.machine_id]?.sessions.find((x) => x.name === s.viewed!.session) : undefined,
  );
  if (!viewed || !session)
    return (
      <>
        <div className="agents-head" data-tauri-drag-region />
        <p className="agents-empty">Select a session</p>
      </>
    );
  return <SessionPanes machineId={viewed.machine_id} session={session} />;
});

/** The PANES header (Active N, as in the sidebar's Sessions section). */
function PanesHeader({ active, count }: { active: boolean; count: number }) {
  const setFilter = usePaneFilter((s) => s.setFilter);
  return (
    <div className="section-head panes-head">
      <span className="section-label">Panes</span>
      <ActiveToggle on={active} count={count} onChange={(on) => setFilter(on ? "active" : "all")} />
    </div>
  );
}

function SessionPanes({ machineId, session }: { machineId: string; session: SessionView }) {
  const active = usePaneFilter((s) => s.filter === "active");
  const doneSeen = useApp((s) => s.doneSeen);
  const since = useApp((s) => s.statusSince);
  const selected = useApp((s) => (s.selected ? paneKey(s.selected) : null));
  const now = useMinuteClock();
  const keptMs = useActiveKeptMs();
  const built = workspaceGroups(session);
  // Read from the lane store only while the session has lane tabs; it names each lane's owner.
  const lanePanes = built.flatMap((g) => g.entries.filter((e) => tabRole(e.tab.label) === "lane").map((e) => e.pane.pane_id)).join(" ");
  const records = useLaneRecords(machineId, lanePanes);
  const roles = sessionRoles(session.name, built.map((g) => g.entries.map((e) => ({ tabLabel: e.tab.label, pane: e.pane }))), records);
  const placed = built.map((g, gi) => ({
    workspace: g.workspace,
    rows: g.entries.map((entry, i): Row => {
      const key = paneKey({ machine_id: machineId, session: session.name, pane_id: entry.pane.pane_id });
      return { entry, key, ...roles[gi][i], ...paneState(entry.pane, !!doneSeen[key], since[key], now, keptMs) };
    }),
  }));
  // A lane owned by a pane of another workspace moves to that workspace's group, under its owner.
  const groupOf = new Map(placed.flatMap((g, gi) => g.rows.map((r) => [r.entry.pane.pane_id, gi] as const)));
  const groups = placed.map((g, gi) => ({
    workspace: g.workspace,
    rows: [
      ...g.rows.filter((r) => !folded(r) || groupOf.get(r.owner!) === gi),
      ...placed.flatMap((o, oi) => (oi === gi ? [] : o.rows.filter((r) => folded(r) && groupOf.get(r.owner!) === gi))),
    ],
  }));
  // A lane counts only while it needs the user: the rest is its orchestrator's.
  const kept = (r: Row) => r.key === selected || (folded(r) ? r.entry.pane.status === "blocked" : !r.quiet);
  const count = groups.reduce((n, g) => n + g.rows.filter(kept).length, 0);
  // Active drops a workspace whose panes it all leaves out; an empty one stays, to add to it.
  const visible = active ? groups.filter((g) => g.rows.length === 0 || g.rows.some(kept)) : groups;
  return (
    <ActionsProvider>
      <div className="agents-head" data-tauri-drag-region>
        <span className="agents-title">{session.name}</span>
        <SessionQueueChip machineId={machineId} session={session.name} />
        {session.running && <NewWorkspaceButton machineId={machineId} session={session.name} />}
      </div>
      {session.running && groups.length > 0 && <PanesHeader active={active} count={count} />}
      {/* Only the list scrolls, so the head needs no background of its own: a second layer of the
          translucent chrome would darken it against the column. */}
      <div className="agents-list">
        {!session.running ? (
          <StoppedSession machineId={machineId} session={session.name} />
        ) : groups.length === 0 ? (
          <p className="agents-empty">No panes</p>
        ) : visible.length === 0 ? (
          <p className="agents-empty">Nothing active</p>
        ) : (
          visible.map((g) => (
            <WorkspaceGroup key={g.workspace.workspace_id} machineId={machineId} session={session.name} workspace={g.workspace} rows={g.rows} active={active} />
          ))
        )}
      </div>
      {/* Docked above the Files panel, apart from the Pane rows it is not one of. */}
      {session.running && <ClosedSection machineId={machineId} session={session} />}
    </ActionsProvider>
  );
}
