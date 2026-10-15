import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useShallow } from "zustand/react/shallow";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filesRead, openLocalFile, revealLocalFile } from "../lib/ipc";
import type { FileChange, FileContent } from "../lib/types";
import { useApp } from "../store/app";
import { itemKey, type OpenItem } from "../store/openItems";
import { CopyIcon, FileCopyIcon, FolderOpenIcon, LaptopIcon, OutlineIcon } from "../ui/icons";
import { showToast } from "../ui/Toast";
import { useFilesBus } from "./bus";
import { closeItemsGuarded, settleDrafts } from "./closeGuard";
import { draftKey, isDirty, useDrafts } from "./drafts";
import { canEdit, createEditorState, diskVersion, roundTrips } from "./editorSetup";
import { FileEditor } from "./FileEditor";
import type { FindStatus } from "./find";
import { FindBar } from "./FindBar";
import { type FindRequest, onFindRequest } from "./findBus";
import { FolderView } from "./FolderView";
import { FileView, type FileMode } from "./FileView";
import { latestOnly, STALE } from "./latest";
import { HIGHLIGHT_LIMIT } from "./limits";
import { lineOfHash } from "./links";
import { useOutline } from "./outlineStore";
import { absPath } from "./root";
import { saveDraft } from "./save";
import { filesKey, useFiles } from "./store";

const isMarkdown = (rel: string) => /\.(md|markdown)$/i.test(rel);
const errMessage = (e: unknown) => String((e as { message?: string } | null)?.message ?? e);

interface Props {
  item: Extract<OpenItem, { kind: "file" }>;
  online: boolean;
}

/** Shows one open file: breadcrumbs, render/source, find, and a re-read when the change bus says so. */
export function FileViewer({ item, online }: Props) {
  const { ws, root, rel } = item;
  const machineId = ws.machine_id;
  const key = filesKey(ws, root);
  const [doc, setDoc] = useState<{ rel: string; content: FileContent } | null>(null);
  const [error, setError] = useState<{ rel: string; message: string } | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  /** Set when `rel` turned out to be a folder: it is listed instead. */
  const [folder, setFolder] = useState<string | null>(null);
  const [folderReload, setFolderReload] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  /** Bumped by ⌘F, so an open find bar takes the focus again. */
  const [findFocus, setFindFocus] = useState(0);
  /** The `#fragment` of the link that opened this file, taken from the bus when it is shown. */
  const [jump, setJump] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const outline = useOutline((s) => s.shown);
  const toggleOutline = useOutline((s) => s.toggle);
  const [hasOutline, setHasOutline] = useState(false);
  const [index, setIndex] = useState(0);
  const read = useMemo(() => latestOnly(filesRead), []);
  const reloads = useFilesBus((s) => s.reloads[key] ?? 0);
  const batch = useFilesBus((s) => s.batches[key]);

  /** A file that is gone: a Draft keeps its text and says so, otherwise the plain banner shows. */
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const gone = useCallback(
    (r: string) => {
      const dk = draftKey(key, r);
      // A Machine that is not connected fails every read with not_found; that says nothing about the file.
      if (useDrafts.getState().drafts[dk]) {
        if (onlineRef.current) useDrafts.getState().setConflict(dk, "removed");
      } else setRemoved(r);
    },
    [key],
  );

  const load = useCallback(
    (r: string) => {
      const dk = draftKey(key, r);
      const started = useDrafts.getState().drafts[dk];
      read(machineId, root, r).then(
        (content) => {
          if (content === STALE) return;
          setDoc({ rel: r, content });
          setError(null);
          setRemoved(null);
          setFolder(null);
          // Read at resolve time: `saving` and `dirty` are as they are now, not as they were when the read began.
          const { drafts, rebase, setConflict, touch } = useDrafts.getState();
          const d = drafts[dk];
          // Our own save, or a read that began before it (or before this Draft), says nothing about the file now.
          if (!d || d.saving || !started || started.saving || started.id !== d.id || started.gen !== d.gen) return;
          if (content.cksum === d.base.cksum && content.size === d.base.size) {
            // Only the mtime moved (a touch, or our save echoing back): keep the editor state and its history.
            if (content.mtime !== d.base.mtime || d.conflict) touch(dk, content.mtime);
          } else if (d.dirty) {
            setConflict(dk, "changed");
          } else {
            const base = diskVersion(content);
            if (base) {
              rebase(dk, base, createEditorState(base.text));
              if (d.conflict) setConflict(dk, null);
            } else setConflict(dk, "changed");
          }
        },
        (e) => {
          const code = (e as { code?: string } | null)?.code;
          if (code === "is_dir") {
            setFolder(r);
            setFolderReload((n) => n + 1);
          } else if (code === "not_found") gone(r);
          else setError({ rel: r, message: errMessage(e) });
        },
      );
    },
    [read, machineId, root, key, gone],
  );

  useEffect(() => {
    load(rel);
  }, [rel, load, reloads]);

  // Batches published before this viewer mounted are not its to handle.
  const seen = useRef(batch?.seq ?? 0);
  useEffect(() => {
    if (!batch || batch.seq === seen.current) return;
    seen.current = batch.seq;
    const own = batch.changes.find((c) => c.path === rel);
    // A folder above it changed (e.g. removed or renamed): reading it again finds out.
    const above = (c: FileChange) => c.isDir && (c.path === "" || rel.startsWith(c.path + "/"));
    if (own) {
      if (own.removed) gone(rel);
      else load(rel);
    } else if (batch.changes.some(above)) load(rel);
    // A listed folder: a name in it came, went or changed.
    else if (folder === rel && batch.changes.some((c) => c.path.startsWith(rel + "/"))) setFolderReload((n) => n + 1);
  }, [batch, rel, load, gone, folder]);

  // A link's fragment waits on the bus under the key of the file it targets; this viewer takes its own.
  const itemId = itemKey(item);
  const pending = useFilesBus((s) => (s.jump?.key === itemId ? s.jump.hash : null));
  useEffect(() => {
    if (pending === null) return;
    setJump(pending);
    useFilesBus.getState().setJump(null);
  }, [pending]);

  const onLink = useCallback(
    (to: string, hash: string | null) => {
      useFilesBus.getState().setJump(hash ? { key: itemKey({ kind: "file", ws, root, rel: to }), hash } : null);
      useApp.getState().openFile(ws, root, to, { pin: false });
    },
    [ws, root],
  );

  const shown = doc && doc.rel === rel ? doc.content : null;
  // Rendering parses on the main thread, so text past the highlight limit opens as source.
  const large = shown?.text != null && shown.text.length > HIGHLIGHT_LIMIT;
  // A `#L12` link has a line to show, which only the source view has.
  const toLine = jump !== null && lineOfHash(jump) !== null;
  // Kept in the files store, so it survives switching to another item and back.
  const chosen = useFiles((s) => s.ws(key).modes[rel]);
  const mode: FileMode = chosen ?? (large || toLine ? "source" : "render");
  const setMode = (m: FileMode) => useFiles.getState().setMode(key, rel, m);
  // The other view searches afresh from what it shows on screen.
  useEffect(() => setIndex(0), [mode]);
  const md = isMarkdown(rel);
  // Rendered markdown is searched in its rendered text, everything else in its source.
  const searchable = shown !== null && shown.kind === "text" && shown.text !== null;
  /** Reported by the view, which owns the matches and where the search starts. */
  const [status, setStatus] = useState<FindStatus>({ count: 0, index: 0 });
  const count = findOpen && searchable && query ? status.count : 0;

  const draftId = itemKey(item);
  // Only what the toolbar shows, so typing in the editor does not re-render the viewer.
  const draft = useDrafts(
    useShallow((s) => {
      const d = s.drafts[draftId];
      return d ? { dirty: d.dirty, saving: d.saving, conflict: d.conflict } : null;
    }),
  );
  // Parsing the text is costly, so it is done once per read, not per render.
  const { editable, mixedEnds } = useMemo(() => {
    if (!shown) return { editable: false, mixedEnds: false };
    const editable = canEdit(shown);
    // Text the editor would not give back as it is (mixed line endings) is offered, but cannot be edited.
    const mixedEnds = !editable && shown.kind === "text" && shown.editable && shown.cksum !== null && shown.text !== null && !roundTrips(shown.text);
    return { editable, mixedEnds };
  }, [shown]);
  /** The conflict banner pulses for a moment when ⌘S is pressed while it is up. */
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const edit = () => {
    const base = shown && diskVersion(shown);
    // `open` replaces a Draft unconditionally; a dirty one is never replaced.
    if (!base || isDirty(draftId)) return;
    // A preview item is replaced by the next file opened; a Draft's item must stay until it is settled.
    // Pinned first, so the Draft is never dirty while its item can still be replaced.
    useApp.getState().pinItem(draftId);
    useDrafts.getState().open({ fk: key, machineId, root, rel }, base, createEditorState(base.text));
  };
  const done = () => void settleDrafts([draftId]);
  const save = () => {
    if (useDrafts.getState().drafts[draftId]?.conflict) {
      setFlash(true);
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(false), 600);
    } else void saveDraft(draftId, { force: false });
  };

  /** Drops the edits and takes what is on disk. */
  const reload = () => {
    const before = useDrafts.getState().drafts[draftId];
    filesRead(machineId, root, rel).then(
      (content) => {
        // Edits typed while the read was under way are not the ones the user chose to drop.
        const now = useDrafts.getState().drafts[draftId];
        if (!now) return;
        if (now.id !== before?.id || now.state !== before.state) {
          showToast(`Not reloaded: ${rel.split("/").pop()} was edited meanwhile`);
          return;
        }
        const base = diskVersion(content);
        if (base) useDrafts.getState().open({ fk: key, machineId, root, rel }, base, createEditorState(base.text));
        else useDrafts.getState().drop(draftId);
        setDoc({ rel, content });
      },
      (e) => showToast(`Cannot reload ${rel.split("/").pop()}: ${errMessage(e)}`),
    );
  };
  const overwrite = () => void saveDraft(draftId, { force: true });
  // The Draft is dirty here, so closing asks first.
  const close = () => void closeItemsGuarded(draftId, "one");

  /** ⌘F / ⌘G / ⇧⌘G, or their Edit menu items: open the find bar, step to the next or previous match. */
  const find = (what: FindRequest) => {
    if (draft || !searchable) return;
    if (what === "open") {
      setFindOpen(true);
      setFindFocus((n) => n + 1);
    }
    // Not wrapped here: the view wraps it, and each step re-scrolls even onto the same match.
    else if (findOpen && count > 0) setIndex((i) => i + (what === "prev" ? -1 : 1));
  };
  const keys = (e: KeyboardEvent) => {
    // A dialog over the file (Change folder…, Unsaved Changes) keeps its keys.
    if (document.querySelector(".overlay")) return;
    if (e.key === "Escape" && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
      if (e.repeat || e.isComposing) return;
      // The editor's search panel takes the Esc that closes it (it prevents the default); one still open keeps it too.
      if (draft && !e.defaultPrevented && !document.querySelector(".files-editor .cm-search")) done();
      return;
    }
    if (!e.metaKey || e.altKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k === "s" && !e.shiftKey && draft) {
      e.preventDefault();
      save();
    } else if (k === "e" && e.shiftKey) {
      e.preventDefault();
      if (e.repeat) return;
      if (!draft && editable) edit();
      else if (draft) done();
    } else if (draft && (k === "f" || k === "g")) {
      // The editor's own search takes them.
      return;
    } else if (!e.shiftKey && k === "f") {
      e.preventDefault();
      find("open");
    } else if (k === "g") {
      e.preventDefault();
      find(e.shiftKey ? "prev" : "next");
    } else if (!e.shiftKey && k === "r") {
      e.preventDefault();
      useFilesBus.getState().reload(key);
    }
  };
  const keysRef = useRef(keys);
  keysRef.current = keys;
  useEffect(() => {
    const h = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", h, false);
    return () => window.removeEventListener("keydown", h, false);
  }, []);
  // Edit › Find…, Find Next, Find Previous: the menu bar takes ⌘F/⌘G in the app (ADR 0010).
  // While editing, the editor's own search answers them (FileEditor).
  const findRef = useRef(find);
  findRef.current = find;
  useEffect(() => onFindRequest((what) => findRef.current(what)), []);

  const fullPath = absPath(root, rel);
  // On this Mac, what Chat's path menu offers is here too (Apple's HIG: a context menu's items are
  // also in the main interface).
  const local = useApp((s) => s.machines[machineId]?.kind === "local");
  const failed = (what: string) => (e: unknown) => showToast(`Cannot ${what} ${fullPath}: ${String((e as { message?: string } | null)?.message ?? e)}`);
  const reveal = () => void revealLocalFile(fullPath).catch(failed("show in Finder"));
  const openOnMac = () =>
    void openLocalFile(fullPath).then((done) => {
      if (done === "revealed") showToast(`Shown in Finder: ${fullPath}`, { alert: false });
    }, failed("open"));
  const copyPath = () => {
    writeText(fullPath).then(
      () => showToast("Path copied"),
      (e) => console.error("copy failed", e),
    );
  };
  const cut = shown?.truncated ? " (first 2 MB only)" : "";
  const copyContents = () => {
    if (shown?.text == null) return;
    writeText(shown.text).then(
      () => showToast(`Contents copied${cut}`),
      (e) => console.error("copy failed", e),
    );
  };

  return (
    <>
      <div className="files-crumbs">
        <span className="files-crumb-path" title={fullPath}>
          {rel.split("/").join(" / ")}
        </span>
        <button type="button" className="icon-btn" aria-label="Copy path" title="Copy path" onClick={copyPath}>
          <CopyIcon />
        </button>
        {local && (
          <>
            <button type="button" className="icon-btn" aria-label="Reveal in Finder" title="Reveal in Finder" onClick={reveal}>
              <FolderOpenIcon />
            </button>
            <button type="button" className="icon-btn" aria-label="Open on this Mac" title="Open on this Mac" onClick={openOnMac}>
              <LaptopIcon />
            </button>
          </>
        )}
        {shown?.kind === "text" && shown.text !== null && (
          <button type="button" className="icon-btn" aria-label="Copy contents" title={`Copy contents${cut}`} onClick={copyContents}>
            <FileCopyIcon />
          </button>
        )}
        {md && !draft && mode === "render" && hasOutline && (
          <button
            type="button"
            className="icon-btn files-outline-btn"
            aria-label="Outline"
            title={outline ? "Hide outline" : "Show outline"}
            aria-pressed={outline}
            onClick={toggleOutline}
          >
            <OutlineIcon />
          </button>
        )}
        {md && !draft && shown?.kind === "text" && (
          <div className="files-mode" role="group" aria-label="Markdown view">
            {(["render", "source"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m === "render" ? "Render" : "Source"}
              </button>
            ))}
          </div>
        )}
        {(draft || editable || mixedEnds) && (
        <div className="files-mode files-edit" role="group" aria-label="Edit">
          {draft ? (
            <>
              <button type="button" disabled={!draft.dirty} onClick={save}>
                Save{draft.saving ? "…" : ""}
              </button>
              <button type="button" onClick={done}>Done</button>
            </>
          ) : editable ? (
            <button type="button" aria-label="Edit" onClick={edit}>Edit</button>
          ) : (
            <button type="button" aria-label="Edit" disabled title="Mixed line endings">Edit</button>
          )}
        </div>
        )}
      </div>
      {draft?.conflict && (
        <div className={`files-banner files-banner-conflict${flash ? " flash" : ""}`} role="alert">
          <span>{draft.conflict === "changed" ? "File changed on disk" : "File was deleted"}</span>
          {draft.conflict === "changed" ? (
            <>
              <button type="button" onClick={reload}>Reload</button>
              <button type="button" onClick={overwrite}>Overwrite</button>
            </>
          ) : (
            <>
              <button type="button" onClick={overwrite}>Save again</button>
              <button type="button" onClick={close}>Close</button>
            </>
          )}
        </div>
      )}
      {removed === rel && <div className="files-banner files-banner-removed">File removed</div>}
      {shown && error && error.rel === rel && (
        <div className="files-banner files-banner-error" role="alert">
          Could not reload: {error.message}
        </div>
      )}
      {!draft && findOpen && searchable && (
        <FindBar
          count={count}
          index={status.index}
          focusKey={findFocus}
          query={query}
          matchCase={matchCase}
          onQuery={(q) => {
            setQuery(q);
            setIndex(0);
          }}
          onMatchCase={(on) => {
            setMatchCase(on);
            setIndex(0);
          }}
          // Not wrapped here: the view wraps it, and each step re-scrolls even onto the same match.
          onStep={(d) => count > 0 && setIndex((i) => i + d)}
          onClose={() => setFindOpen(false)}
        />
      )}
      <div className="files-view">
        {draft ? (
          <FileEditor draftKey={draftId} />
        ) : shown ? (
          <FileView
            machineId={machineId}
            root={root}
            rel={rel}
            content={shown}
            mode={mode}
            onMode={(m) => setMode(m)}
            onOpen={onLink}
            find={findOpen && searchable && query ? { query, index, matchCase } : null}
            onFindStatus={setStatus}
            initialScroll={useFiles.getState().ws(key).scroll[rel] ?? 0}
            hash={jump}
            saveScroll={(r, top) => useFiles.getState().setScroll(key, r, top)}
            outline={outline}
            onOutline={setHasOutline}
          />
        ) : folder === rel ? (
          <FolderView ws={ws} root={root} rel={rel} reload={folderReload} />
        ) : error && error.rel === rel ? (
          <div className="files-notice" role="alert">{error.message}</div>
        ) : null}
      </div>
    </>
  );
}
