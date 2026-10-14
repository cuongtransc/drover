import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import "./fonts/fonts.css";
import "./styles.css";
import { appQuit, destroyWindow, machinesList, onMachine, onMenuSettings, onNotifyActivate, onPaneStatus, onQuitRequested, onWindowCloseRequested, sessionStart } from "./lib/ipc";
import { notifyPaneStatus } from "./notify";
import { Palette } from "./palette/Palette";
import { Settings, useSettingsOpen } from "./settings/Settings";
import { applyChatFont, type FontZoom, useSettings, zoomFont } from "./settings/store";
import type { ActionId } from "./shortcuts/actions";
import { actionFor } from "./shortcuts/dispatch";
import { useShortcutLabel, useShortcuts } from "./shortcuts/store";
import { applyTheme, useTheme } from "./settings/theme";
import { LayoutControls } from "./main/LayoutControls";
import { useDockBadge } from "./main/dockBadge";
import { TriageHud } from "./main/TriageHud";
import { useTriage } from "./main/triage";
import { useLayout } from "./settings/layout";
import { TopBar } from "./main/TopBar";
import { Sidebar } from "./sidebar/Sidebar";
import { QuotaStrip } from "./sidebar/QuotaStrip";
import { guardFileDrops } from "./sidebar/dnd";
import { AgentList } from "./agents/AgentList";
import { watchProtectPrune } from "./agents/protect";
import { watchForkPrune } from "./agents/forkSession";
import { AgentDashboard } from "./dashboard/AgentDashboard";
import { closeItemsGuarded, settleDrafts } from "./files/closeGuard";
import { useDrafts } from "./files/drafts";
import { UnsavedDialog } from "./files/unsaved";
import { FilesPanel } from "./files/FilesPanel";
import { useFilesPanel } from "./files/panelStore";
import { openNewTabHere } from "./agents/newTabShortcut";
import { paneKey } from "./lib/types";
import { activeItem, chosenLens, selectedPane, useApp } from "./store/app";
import { itemKey } from "./store/openItems";
import { syncSeenToHerdr } from "./store/seenSync";
import { showToast, Toasts } from "./ui/Toast";
import { openUrl } from "@tauri-apps/plugin-opener";
import { defaultLens } from "./lens";
import { useTranscriptProbe } from "./chat/transcriptProbe";
import { AlertIcon, LayersIcon, TerminalIcon } from "./ui/icons";
import { StartingOverlay } from "./terminal/StartingOverlay";

function EmptyState({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

function EmptyMain() {
  const local = useApp((s) => s.machines["local"]);
  const jumpKey = useShortcutLabel("jump");
  if (local?.state === "error" && local.error?.code === "herdr_not_found") {
    return (
      <EmptyState icon={<AlertIcon />} title="herdr is not installed on this Mac">
        <p className="empty-hint">The app talks to the herdr multiplexer running on each machine.</p>
        <p>
          <a
            className="btn btn-primary"
            href="https://herdr.dev"
            onClick={(e) => {
              e.preventDefault();
              void openUrl("https://herdr.dev").catch((err) => console.error("openUrl failed", err));
            }}
          >
            Install herdr
          </a>
        </p>
      </EmptyState>
    );
  }
  if (local?.state === "connected" && !local.sessions.some((s) => s.running)) {
    return (
      <EmptyState icon={<LayersIcon />} title="No running sessions">
        <p className="empty-hint">Start a herdr session to see its workspaces and agents here.</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            void sessionStart("local", "default").catch((err: unknown) =>
              showToast(`Could not start the default session: ${(err as { message?: string } | null)?.message ?? String(err)}`),
            )
          }
        >
          Start default session
        </button>
      </EmptyState>
    );
  }
  return (
    <EmptyState icon={<TerminalIcon />} title="Select a pane">
      <p className="empty-hint">
        {jumpKey ? (
          <>
            Pick an agent from the list, or press <kbd>{jumpKey}</kbd> to jump to any pane.
          </>
        ) : (
          "Pick an agent from the list."
        )}
      </p>
    </EmptyState>
  );
}

/** Actions an open dialog (`.overlay`) keeps from running: their keys may mean something there. */
const KEPT_BY_DIALOGS = new Set<ActionId>(["files.toggle", "files.goto", "item.remove", "item.prev", "item.next"]);
/** Actions a held key runs again. */
const REPEATS = new Set<ActionId>(["item.prev", "item.next", "font.bigger", "font.smaller", "font.reset"]);

const ChatLens = lazy(() => import("./chat/ChatLens").then((m) => ({ default: m.ChatLens })));
const TerminalLens = lazy(() => import("./terminal/TerminalLens").then((m) => ({ default: m.TerminalLens })));
// react-markdown and lowlight load with the first open file, not with the app.
const FileViewer = lazy(() => import("./files/FileViewer").then((m) => ({ default: m.FileViewer })));

export default function App() {
  const upsert = useApp((s) => s.upsertMachine);
  useDockBadge();
  // Only the selected Pane and its ids: a change elsewhere on its Machine does not re-render App.
  const selected = useApp((s) => s.selected);
  const pane = useApp((s) => selectedPane(s)?.pane ?? null);
  const remembered = useApp((s) => (s.selected ? chosenLens(s, paneKey(s.selected)) : undefined));
  const starting = useApp((s) => (s.selected ? !!s.starting[paneKey(s.selected)] : false));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const dashboardOpen = useApp((s) => s.dashboardOpen);
  const item = useApp(activeItem);
  const online = useApp((s) => (item?.kind === "file" ? s.machines[item.ws.machine_id]?.state === "connected" : false));
  const chatFontSize = useSettings((s) => s.chatFontSize);
  const chatFontFamily = useSettings((s) => s.chatFontFamily);
  const chatMonoFamily = useSettings((s) => s.chatMonoFamily);
  const layout = useLayout((s) => s.layout);

  const theme = useTheme((s) => s.theme);
  const themePref = useTheme((s) => s.pref);

  useEffect(
    () => applyChatFont({ chatFontSize, chatFontFamily, chatMonoFamily }),
    [chatFontSize, chatFontFamily, chatMonoFamily],
  );
  useEffect(() => applyTheme(theme, themePref), [theme, themePref]);
  useEffect(() => syncSeenToHerdr(), []);
  useEffect(() => {
    const onFocus = () => useApp.getState().acknowledgeSelectedDone();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => guardFileDrops(), []);
  useEffect(() => watchProtectPrune(), []);
  useEffect(() => watchForkPrune(), []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void machinesList().then((ms) => {
      if (!cancelled) ms.forEach(upsert);
    }).catch((e) => console.error("machines_list failed", e));
    void onMachine(upsert).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [upsert]);

  // The app menu's Settings… ⌘, (a native menu item, so it works while a terminal or the Composer has focus).
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void onMenuSettings(() => useSettingsOpen.getState().show()).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Notifications: show one per status change, and jump to its pane when clicked.
  useEffect(() => {
    let cancelled = false;
    const unlisten: (() => void)[] = [];
    const keep = (u: () => void) => {
      if (cancelled) u();
      else unlisten.push(u);
    };
    void onPaneStatus((ev) => {
      const { selected, machines } = useApp.getState();
      void notifyPaneStatus(ev, selected, machines);
    }).then(keep);
    void onNotifyActivate((pane) => useApp.getState().select(pane)).then(keep);
    return () => {
      cancelled = true;
      unlisten.forEach((u) => u());
    };
  }, []);

  // Closing the window or quitting asks about unsaved Drafts first. If asking itself fails, the
  // app is kept open once and the next request goes through: a broken guard never traps the app.
  useEffect(() => {
    const drafts = () => useDrafts.getState().drafts;
    // After a failed check the next request goes through unasked: never trapped, nothing lost silently.
    let skipAsk = false;
    const settle = async (): Promise<boolean> => {
      if (skipAsk) {
        skipAsk = false;
        return true;
      }
      try {
        return await settleDrafts(Object.keys(drafts()));
      } catch (err) {
        console.error("settling Drafts failed; keeping the app open", err);
        skipAsk = true;
        showToast("Could not check unsaved edits; close again to discard");
        return false;
      }
    };
    const unlisten = [
      onWindowCloseRequested(async (e) => {
        if (!Object.values(drafts()).some((d) => d.dirty)) return;
        e.preventDefault();
        if (await settle()) await destroyWindow();
      }),
      onQuitRequested(async () => {
        if (await settle()) await appQuit();
      }),
    ];
    return () => unlisten.forEach((u) => void u.then((f) => f()).catch(() => {}));
  }, []);

  useEffect(() => {
    const zoom = (z: FontZoom) => {
      const s = useApp.getState();
      const open = s.selected ? selectedPane(s)?.pane : null;
      if (!open || !s.selected) return false;
      zoomFont(defaultLens(open, chosenLens(s, paneKey(s.selected))), z);
      return true;
    };
    const leaveFocus = () => {
      if (useLayout.getState().layout === "focus") useLayout.getState().toggle("focus");
    };
    // Each returns false when it did nothing, leaving the key to the page.
    const run: Record<ActionId, () => boolean | void> = {
      // ⌘+ / ⌘− / ⌘0: the font of the view on screen, Terminal or Chat (iTerm, Ghostty).
      "font.bigger": () => zoom(1),
      "font.smaller": () => zoom(-1),
      "font.reset": () => zoom(0),
      // While the dashboard is open, the Jump key focuses its search instead.
      jump: () => (useApp.getState().dashboardOpen ? false : setPaletteOpen((o) => !o)),
      "triage.next": () => useTriage.getState().step(1),
      "triage.prev": () => useTriage.getState().step(-1),
      board: () => useApp.getState().setDashboardOpen(!useApp.getState().dashboardOpen),
      "layout.sidebar": () => useLayout.getState().toggle("sidebar"),
      "layout.focus": () => useLayout.getState().toggle("focus"),
      "tabs.new": () =>
        void openNewTabHere().catch((err: unknown) =>
          showToast(`Could not open a new tab: ${(err as { message?: string } | null)?.message ?? String(err)}`),
        ),
      // Shown means expanded and not hidden by Focus, which hides the Agents column and the panel with it.
      "files.toggle": () => {
        const panel = useFilesPanel.getState();
        if (!panel.collapsed && useLayout.getState().layout !== "focus") return panel.setCollapsed(true);
        leaveFocus();
        panel.focusTree();
      },
      "files.goto": () => {
        leaveFocus();
        useFilesPanel.getState().focusGoto();
      },
      "item.remove": () => {
        const active = useApp.getState().openItems.active;
        if (active) void closeItemsGuarded(active, "one");
      },
      "item.prev": () => useApp.getState().cycleItems(-1),
      "item.next": () => useApp.getState().cycleItems(1),
    };
    const onKey = (e: KeyboardEvent) => {
      const keys = useShortcuts.getState();
      // Settings is recording a key: it gets the key, nothing runs.
      if (keys.recording) return;
      const action = actionFor(e, keys.bindings);
      if (!action) return;
      // A dialog keeps its keys.
      if (KEPT_BY_DIALOGS.has(action) && document.querySelector(".overlay")) return;
      if (e.repeat && !REPEATS.has(action)) {
        e.preventDefault();
        return;
      }
      if (run[action]() !== false) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { machine_id, session, pane_id } = selected ?? {};
  const selRef = useMemo(
    () => (machine_id && session && pane_id ? { machine_id, session, pane_id } : null),
    [machine_id, session, pane_id],
  );
  const ref = pane ? selRef : null;
  const key = ref ? paneKey(ref) : "";
  useTranscriptProbe(ref, pane?.status);

  return (
    <div className="app" data-layout={layout}>
      <LayoutControls />
      <nav className="sidebar" id="sidebar" aria-label="Machines" hidden={layout !== "normal"}>
        <div className="titlebar" data-tauri-drag-region />
        <div className="sidebar-scroll">
          <Sidebar />
        </div>
        <QuotaStrip />
        <Settings />
      </nav>
      <aside className="agents" aria-label="Agents" hidden={layout === "focus"}>
        <AgentList />
        <FilesPanel />
      </aside>
      <main className="main">
        {item?.kind === "file" ? (
          <>
            <TopBar />
            <Suspense fallback={null}>
              <FileViewer key={itemKey(item)} item={item} online={online} />
            </Suspense>
          </>
        ) : pane && ref ? (
          <>
            <TopBar lens />
            <Suspense fallback={null}>
              {defaultLens(pane, remembered) === "chat" ? (
                <ChatLens key={key} pane={ref} view={pane} />
              ) : (
                <TerminalLens key={key} pane={ref} terminalId={pane.terminal_id} />
              )}
            </Suspense>
          </>
        ) : selRef && starting ? (
          // herdr reports a new pane only in its next snapshot: keep the loading overlay up until then
          // rather than flashing the empty state.
          <>
            <TopBar />
            <div className="term-lens">
              <StartingOverlay pane={selRef} />
            </div>
          </>
        ) : (
          <>
            <TopBar />
            <div className="main-empty">
              <EmptyMain />
            </div>
          </>
        )}
      </main>
      {dashboardOpen && <AgentDashboard />}
      <TriageHud />
      <Toasts />
      <UnsavedDialog />
      {paletteOpen && <Palette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
