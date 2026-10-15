import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { showToast } from "../ui/Toast";
import type { ActionId } from "../shortcuts/actions";
import type { Bindings } from "../shortcuts/store";
import type { LaneRecord } from "../agents/roles";
import type { AttachEvent, Changed, ChatEvent, ChatItem, FileContent, FileEntry, FileList, FileVersion, GitStatus, Located, MachineView, PaneRef, PaneStatusEvent, QuotaOutcome, QuotaProvider, CtaQuota, SlashCommand, WatchEvent } from "./types";

export const machinesList = () => invoke<MachineView[]>("machines_list");
export const machineConnect = (id: string) => invoke<void>("machine_connect", { id });
export const machineDisconnect = (id: string) => invoke<void>("machine_disconnect", { id });
export const sshHosts = () => invoke<string[]>("ssh_hosts");
export const systemFonts = (monospace = true) => invoke<string[]>("system_fonts", { monospace });
/** Raw file of an installed font's face (CoreText style name); rejects when not web-loadable. */
export const fontFace = (family: string, style: string) => invoke<ArrayBuffer>("font_face", { family, style });
/** Native appearance (vibrancy, traffic lights); `null` follows the system. */
export const setWindowTheme = (theme: "light" | "dark" | null) => getCurrentWindow().setTheme(theme);
/** The Dock icon's badge; 0 removes it. */
export const setDockBadge = async (n: number) => getCurrentWindow().setBadgeCount(n > 0 ? n : undefined);
export const machineAdd = (sshTarget: string, label: string | null, herdrPath: string | null) =>
  invoke<MachineView>("machine_add", { sshTarget, label, herdrPath });
export const machineRemove = (id: string) => invoke<void>("machine_remove", { id });
export const machineUpdate = (id: string, herdrPath: string | null) =>
  invoke<MachineView>("machine_update", { id, herdrPath });
export const machineMasterAlive = (id: string) => invoke<boolean>("machine_master_alive", { id });
export const connectOpen = (
  machineId: string,
  cols: number,
  rows: number,
  data: Channel<ArrayBuffer>,
  events: Channel<AttachEvent>,
) => invoke<void>("connect_open", { machineId, cols, rows, data, events });
export const connectWrite = (machineId: string, data: string) => invoke<void>("connect_write", { machineId, data });
export const connectAck = (machineId: string, bytes: number) => invoke<void>("connect_ack", { machineId, bytes });
export const connectResize = (machineId: string, cols: number, rows: number) =>
  invoke<void>("connect_resize", { machineId, cols, rows });
export const connectClose = (machineId: string) => invoke<void>("connect_close", { machineId });
/** The saved sidebar layout, or `null` when none was saved yet. */
export const layoutLoad = () => invoke<unknown>("layout_load");
export const layoutSave = (layout: unknown) => invoke<void>("layout_save", { layout });
export const sessionsRefresh = (machineId: string) => invoke<void>("sessions_refresh", { machineId });
export const sessionStart = (machineId: string, session: string) =>
  invoke<void>("session_start", { machineId, session });
export const sessionStop = (machineId: string, session: string) =>
  invoke<void>("session_stop", { machineId, session });
export const sessionDelete = (machineId: string, session: string) =>
  invoke<void>("session_delete", { machineId, session });
export const sessionRename = (machineId: string, session: string, to: string) =>
  invoke<void>("session_rename", { machineId, session, to });
export const herdrCall = <T>(machineId: string, session: string, method: string, params: unknown) =>
  invoke<T>("herdr_call", { machineId, session, method, params }).catch((e: unknown) => {
    if ((e as { code?: string } | null)?.code === "timeout") showToast(`${method} timed out`);
    throw e;
  });
/** Saves image bytes on the Machine (remote ones over ssh) and returns the path there. */
/** Opens a file on this Mac: a viewable kind in its default app, anything else shown in Finder. */
export const openLocalFile = (path: string) => invoke<"opened" | "revealed">("open_local_file", { path });
/** Shows a file on this Mac in Finder, whatever its kind. */
export const revealLocalFile = (path: string) => invoke<void>("reveal_local_file", { path });
export const imageSaveTemp = (machineId: string, bytes: Uint8Array, ext: string) =>
  invoke<string>("image_save_temp", bytes, { headers: { "x-machine-id": machineId, "x-image-ext": ext } });

/** Quits the app; the caller has settled unsaved Drafts first. */
export const appQuit = () => invoke<void>("app_quit");
/** Tells the app process whether some Draft is dirty, so Dock Quit and logout ask first. */
export const appSetUnsaved = (unsaved: boolean) => invoke<void>("app_set_unsaved", { unsaved });
/** Fires when the app menu's Quit (⌘Q) is chosen; the app quits only through `appQuit`. */
export const onQuitRequested = (fn: () => void): Promise<UnlistenFn> =>
  listen("app://quit-requested", fn).catch((err) => {
    console.error("registering the quit listener failed", err);
    return () => {};
  });
/** Runs `cb` when the window is asked to close (red button); `cb` calls `e.preventDefault()` to keep it open.
 *  Without a window (tests, a plain browser) nothing is registered and the close is never held back. */
export const onWindowCloseRequested = (cb: (e: { preventDefault: () => void }) => Promise<void> | void): Promise<UnlistenFn> => {
  try {
    return getCurrentWindow()
      .onCloseRequested(cb)
      .catch((err) => {
        console.error("registering the close guard failed", err);
        return () => {};
      });
  } catch {
    return Promise.resolve(() => {});
  }
};
/** Closes the window without asking again (needs `core:window:allow-destroy`). */
export const destroyWindow = () => getCurrentWindow().destroy();
export const onMachine = (cb: (m: MachineView) => void): Promise<UnlistenFn> =>
  listen<MachineView>("sidebar://machine", (e) => cb(e.payload));
export const onPaneStatus = (cb: (e: PaneStatusEvent) => void): Promise<UnlistenFn> =>
  listen<PaneStatusEvent>("pane://status", (e) => cb(e.payload));
export const notifyPane = (pane: PaneRef, title: string, body: string) =>
  invoke<void>("notify_pane", { pane, title, body });
/** Fires when the app menu's Settings… (⌘,) is chosen, or Help › Keyboard Shortcuts… ("shortcuts"). */
export const onMenuSettings = (cb: (section: "shortcuts" | null) => void): Promise<UnlistenFn> =>
  listen<"shortcuts" | null>("menu://settings", (e) => cb(e.payload ?? null));
/** Fires with the action of a menu bar item the user chose, by click or by its key (ADR 0010);
 *  `repeat` when macOS repeats the key of a held chord. */
export const onMenuAction = (cb: (id: ActionId, repeat: boolean) => void): Promise<UnlistenFn> =>
  listen<{ id: ActionId; repeat: boolean }>("menu://action", (e) => cb(e.payload.id, e.payload.repeat));
/** Fires with what File's Reveal in Finder, Open on this Mac or Copy Path asks for. */
export const onMenuFile = (cb: (what: "reveal" | "open" | "copy") => void): Promise<UnlistenFn> =>
  listen<"reveal" | "open" | "copy">("menu://file", (e) => cb(e.payload));
/** Gives the menu bar's action items the user's keys, and File's own keys unless `fileKeys` is
 *  false (while Settings records a key, with every binding null). */
export const menuSetShortcuts = (bindings: Bindings, fileKeys: boolean) => invoke<void>("menu_set_shortcuts", { bindings, fileKeys });
/** Enables File's items for the file they act on: on this Mac, on another machine, or none. */
export const menuSetFileTarget = (target: "local" | "remote" | "none") => invoke<void>("menu_set_file_target", { target });
/** Fires with the pane of a desktop notification the user clicked. */
export const onNotifyActivate = (cb: (pane: PaneRef) => void): Promise<UnlistenFn> =>
  listen<PaneRef>("notify://activate", (e) => cb(e.payload));

export interface AttachKey {
  machine_id: string;
  session: string;
  terminal_id: string;
}

export const attachKeyString = (k: AttachKey) => `${k.machine_id}/${k.session}/${k.terminal_id}`;

export const termOpen = (
  k: AttachKey,
  cols: number,
  rows: number,
  takeover: boolean,
  data: Channel<ArrayBuffer>,
  events: Channel<AttachEvent>,
) =>
  invoke<void>("term_open", {
    machineId: k.machine_id,
    session: k.session,
    terminalId: k.terminal_id,
    cols,
    rows,
    takeover,
    data,
    events,
  });
export const termWrite = (key: AttachKey, data: string) => invoke<void>("term_write", { key, data });
export const termResize = (key: AttachKey, cols: number, rows: number) =>
  invoke<void>("term_resize", { key, cols, rows });
export const termAck = (key: AttachKey, bytes: number) => invoke<void>("term_ack", { key, bytes });
export const termRelease = (key: AttachKey) => invoke<void>("term_release", { key });
export const termClose = (key: AttachKey) => invoke<void>("term_close", { key });

export const chatOpen = (p: PaneRef, path: string | null, events: Channel<ChatEvent>) =>
  invoke<Located>("chat_open", { machineId: p.machine_id, session: p.session, paneId: p.pane_id, path, events });
export const chatLocate = (p: PaneRef) =>
  invoke<Located>("chat_locate", { machineId: p.machine_id, session: p.session, paneId: p.pane_id });
export const completeCommands = (p: PaneRef) =>
  invoke<SlashCommand[]>("complete_commands", { machineId: p.machine_id, session: p.session, paneId: p.pane_id });
/** Claude Code's own prompts for the Pane's folder (`~/.claude/history.jsonl` on its Machine), oldest first. */
export const claudePromptHistory = (p: PaneRef) =>
  invoke<string[]>("claude_prompt_history", { machineId: p.machine_id, session: p.session, paneId: p.pane_id });
/** `hidden`: the folder names left out (Settings → Files). */
export const completeFiles = (p: PaneRef, hidden: string[]) =>
  invoke<string[]>("complete_files", { machineId: p.machine_id, session: p.session, paneId: p.pane_id, hidden });
/** Entries of `dir` (relative to the Pane's folder, e.g. `../`), folders ending in `/`; empty when it is missing. */
export const completeEntries = (p: PaneRef, dir: string) =>
  invoke<string[]>("complete_entries", { machineId: p.machine_id, session: p.session, paneId: p.pane_id, dir });
/** Folder names inside `dir` (absolute or `~/…`) on a Machine; empty when it is missing. */
export const completeDirs = (machineId: string, dir: string) => invoke<string[]>("complete_dirs", { machineId, dir });
export const chatGitStatus = (p: PaneRef) =>
  invoke<GitStatus | null>("chat_git_status", { machineId: p.machine_id, session: p.session, paneId: p.pane_id });
export const chatPage = (p: PaneRef, before: number) =>
  invoke<ChatItem[]>("chat_page", { machineId: p.machine_id, session: p.session, paneId: p.pane_id, before });
export const chatImage = (p: PaneRef, ref: string) =>
  invoke<ArrayBuffer>("chat_image", { machineId: p.machine_id, session: p.session, paneId: p.pane_id, ref });
export const chatClose = (p: PaneRef) =>
  invoke<void>("chat_close", { machineId: p.machine_id, session: p.session, paneId: p.pane_id });
export const quotaFetch = (provider: QuotaProvider) => invoke<QuotaOutcome>("quota_fetch", { provider });
export const quotaCta = (poll: boolean) => invoke<CtaQuota>("quota_cta", { poll });
/** `ctc lane list --json` on the Machine; null when its ctc reports no owner. */
export const lanesList = (machineId: string) => invoke<LaneRecord[] | null>("lanes_list", { machineId });

/** `hidden`: the folder names left out (Settings → Files); `showHeavy` lists them after all. */
export const filesListDir = (machineId: string, root: string, rel: string, hidden: string[], showHeavy = false) =>
  invoke<FileEntry[]>("files_list_dir", { machineId, root, rel, showHeavy, hidden });
export const filesListAll = (machineId: string, root: string, hidden: string[]) =>
  invoke<FileList>("files_list_all", { machineId, root, hidden });
export const filesRead = (machineId: string, root: string, rel: string) =>
  invoke<FileContent>("files_read", { machineId, root, rel });
export const filesWrite = (machineId: string, root: string, rel: string, text: string, expected: FileVersion | null) =>
  invoke<FileVersion>("files_write", { machineId, root, rel, text, expected });
export const filesChanged = (machineId: string, root: string) => invoke<Changed>("files_changed", { machineId, root });
export const filesImage = (machineId: string, root: string, rel: string) =>
  invoke<ArrayBuffer>("files_image", { machineId, root, rel });
/** For each group of places, in order, the first that is a file on the Machine, or null. */
export const filesFirstFiles = (machineId: string, groups: string[][]) =>
  invoke<(string | null)[]>("files_first_files", { machineId, groups });
export const filesPdf = (machineId: string, root: string, rel: string) =>
  invoke<ArrayBuffer>("files_pdf", { machineId, root, rel });
export const filesWatch = (machineId: string, root: string, hidden: string[], events: Channel<WatchEvent>) =>
  invoke<number>("files_watch", { machineId, root, hidden, events });
export const filesUnwatch = (id: number) => invoke<void>("files_unwatch", { id });
export const filesUpload = (machineId: string, root: string, destRel: string, sources: string[]) =>
  invoke<string[]>("files_upload", { machineId, root, destRel, sources });
export const filesDownload = (machineId: string, root: string, rel: string) =>
  invoke<string>("files_download", { machineId, root, rel });
