import { Channel } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { chatLocate, chatPage, herdrCall } from "../lib/ipc";
import { paneKey, type AppError, type ChatEvent, type ChatItem, type Located, type PaneRef, type PaneView } from "../lib/types";
import { findPane, useApp } from "../store/app";
import { onOpenFailure, openChat, watchMachine } from "./chatSession";
import { PromptPanel } from "./PromptPanel";
import { pendingQuestions } from "./prompt/askedPreviews";
import { emptyChat, prepend, reduce, type ChatState } from "./chatStore";
import { ChatItemView } from "./ChatItemView";
import { ChatOpenContext, ChatPaneContext, revokeChatImages } from "./images";
import { WorkBlockView } from "./WorkBlockView";
import { buildRows, liveStart, rowOfCall } from "./workBlocks";
import { chatFindHits, rowFindRanges } from "./chatFind";
import { FindBar } from "../files/FindBar";
import { clearHighlights, setHighlight } from "../files/domFind";
import { wrapIndex } from "../files/find";
import { type FindRequest, onFindRequest } from "../files/findBus";

/** The highlights the File viewer's find paints, so Chat's look the same (styles.css). */
const FIND_ALL = "files-find";
const FIND_CURRENT = "files-find-current";
import { ChatPathsContext, pathResolver } from "./pathResolver";
import { ChatOutline } from "./ChatOutline";
import { currentEntry, outline } from "./outline";
import { Composer } from "./Composer";
import { QueuedMessages } from "./QueuedMessages";
import { BackgroundTasks } from "./BackgroundTasks";
import { BackgroundContext, stableBackground, taskEnds, type BackgroundState } from "./backgroundTaskState";
import { BtwPanel } from "./BtwPanel";
import { useBtw } from "./btw";
import { EditPanel } from "./EditPanel";
import { ChatEditContext } from "./editContext";
import { editLast } from "./rewind";
import { WorkingIndicator } from "./WorkingIndicator";
import { usePiModelPicker } from "./usePiModelPicker";
import { useStartupModel } from "./startupModel";
import { usePendingTranscript } from "./pendingTranscript";
import { ArrowDownIcon, GitBranchIcon } from "../ui/icons";
import { useLensSettings } from "../settings/lens";
import { useForks } from "../agents/forkSession";
import { forgetTranscript, rememberedTranscript, rememberTranscript, TranscriptPicker } from "./TranscriptPicker";

/** How long an open that has not answered yet may go without saying the transcript is loading. */
const LOADING_DELAY = 150;

type Action = (ChatEvent & { atBottom?: boolean }) | { type: "prepend"; items: ChatItem[]; before: number };
const reducer = (s: ChatState, a: Action): ChatState => (a.type === "prepend" ? prepend(s, a.items, a.before) : reduce(s, a, a.atBottom));

export function ChatLens({ pane, view }: { pane: PaneRef; view: PaneView }) {
  const key = paneKey(pane);
  const setLensOverride = useApp((s) => s.setLensOverride);
  const machineState = useApp((s) => s.machines[pane.machine_id]?.state);
  const chatWidth = useLensSettings((s) => s.chatWidth);
  const forkOf = useForks((s) => s.forks[key]);
  const sawDown = useRef(false);
  const [state, dispatch] = useReducer(reducer, emptyChat);
  const latest = useRef(state);
  latest.current = state;
  const [located, setLocated] = useState<Located | null>(null);
  const [openError, setOpenError] = useState<AppError | null>(null);
  const [unseen, setUnseen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const loadingOlder = useRef(false);
  const anchor = useRef<number | null>(null);
  const forceBottom = useRef(true);
  const generation = useRef(0);
  const handle = useRef<{ close: () => void } | null>(null);
  // Bumped on each `reset`: thumbnails that failed while the tail was gone ask again.
  const [opened, setOpened] = useState(0);
  // The first Reset waits for the whole backlog (seconds over a slow ssh): say so meanwhile.
  const [loaded, setLoaded] = useState(false);
  // Held back while the open may be a reattach to the running tail, whose Reset comes at once:
  // shown once the open turns out to have located, or after `LOADING_DELAY` without an answer.
  const [loadingShown, setLoadingShown] = useState(false);
  const loadingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Work blocks the user opened or closed, by block id: a virtualized row forgets its own state.
  const [chosenOpen, setChosenOpen] = useState<ReadonlyMap<string, boolean>>(new Map());
  // A jumped-to call whose card is not rendered yet (its Work block only opens on this render):
  // the block scrolls it into view when it mounts or opens, then calls `clearPendingCard`.
  const [pendingCard, setPendingCard] = useState<string | null>(null);
  // A strip click on a call that is not loaded: older pages are fetched, then this jumps to it.
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const [jumpNotice, setJumpNotice] = useState<string | null>(null);
  // The turn picked in the rail stays lit until the user scrolls: near the end it may not reach
  // the top, and the end rule would light the last turn instead.
  const [picked, setPicked] = useState<string | null>(null);
  // The Pane `/model` was sent to: pi waits on its picker idle, so the picker is looked for then.
  const [modelFor, setModelFor] = useState<string | null>(null);
  const picker = usePiModelPicker(pane, modelFor === key && view.agent === "pi", () => setModelFor(null));
  useEffect(() => setModelFor(null), [key]);
  // Before the first reply the transcript names no Model or effort; Claude's startup screen does.
  const startup = useStartupModel(pane, view.agent === "claude" && !state.meta.model);
  const meta =
    !state.meta.model && (startup.model || startup.effort)
      ? { ...state.meta, model: startup.model, effort: state.meta.effort ?? startup.effort }
      : state.meta;

  // `known`: where `path` was located, when the caller already knows (kept over what opening returns).
  const open = useCallback(
    (path: string | null, known?: Located) => {
      const gen = ++generation.current;
      setOpenError(null);
      setLoaded(false);
      setLoadingShown(false);
      clearTimeout(loadingTimer.current);
      loadingTimer.current = setTimeout(() => {
        if (gen === generation.current) setLoadingShown(true);
      }, LOADING_DELAY);
      const channel = new Channel<ChatEvent>();
      channel.onmessage = (ev) => {
        if (gen !== generation.current) return;
        if (ev.type === "reset" || ev.type === "error") setLoaded(true);
        if (ev.type === "reset") {
          forceBottom.current = true;
          setOpened((n) => n + 1);
        }
        dispatch(ev.type === "append" ? { ...ev, atBottom: atBottom.current } : ev);
      };
      handle.current?.close();
      const h = openChat(pane, path, channel);
      handle.current = h;
      h.opened
        .then((l) => {
          if (gen !== generation.current || !l) return;
          setLocated(known ?? l);
          clearTimeout(loadingTimer.current);
          if (!l.cached) setLoadingShown(true);
          // Reopened on the running tail without locating: the agent may since have moved on to
          // another transcript, so locate it now, off the open's path.
          if (l.cached && path === null) {
            chatLocate(pane).then(
              (fresh) => {
                if (gen !== generation.current) return;
                if (fresh.path !== l.path) open(fresh.path, fresh);
                else setLocated(fresh);
              },
              () => {},
            );
          }
        })
        .catch((e: AppError) => {
          if (gen !== generation.current) return;
          const machine = useApp.getState().machines[pane.machine_id]?.state;
          switch (onOpenFailure(path, e, machine)) {
            case "retry_auto":
              forgetTranscript(key);
              open(null);
              break;
            case "fallback":
              // In memory only: a fresh pane's transcript appears after its first prompt, and
              // useTranscriptProbe returns to Chat then when new agents open on Chat.
              setLensOverride(key, "terminal");
              break;
            case "error":
              setOpenError(e);
          }
        });
    },
    [pane, key, setLensOverride],
  );

  // The tail dies with an ssh drop: reopen once the Machine is back.
  useEffect(() => {
    const w = watchMachine(sawDown.current, machineState);
    sawDown.current = w.sawDown;
    if (w.reopen) open(rememberedTranscript(key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineState]);

  useEffect(() => {
    setChosenOpen(new Map());
    setPendingCard(null);
    setPendingJump(null);
    setJumpNotice(null);
    setPicked(null);
    setLocated(null);
    open(rememberedTranscript(key));
    return () => {
      generation.current++;
      handle.current?.close();
      handle.current = null;
      clearTimeout(loadingTimer.current);
      revokeChatImages(key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A new Claude has no transcript until its first prompt: chat with it on the expected path.
  // A fork has no transcript until its first message (Claude writes it then, history included):
  // meanwhile show the original's, up to the fork, from its file.
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => setPreview(null), [key]);
  useEffect(() => {
    if (!forkOf || !located?.pending || preview || state.items.length > 0) return;
    let gone = false;
    const known = located;
    const path = forkOf.path ? Promise.resolve(forkOf.path) : chatLocate(forkOf.of).then((l) => (l.pending ? null : l.path));
    path.then(
      (p) => {
        if (gone || !p) return;
        setPreview(p);
        open(p, known);
      },
      () => {},
    );
    return () => {
      gone = true;
    };
  }, [forkOf, located, preview, state.items.length, open]);
  const items = useMemo(
    () => (preview && forkOf ? state.items.filter((i) => !i.ts || Date.parse(i.ts) <= forkOf.at) : state.items),
    [preview, forkOf, state.items],
  );
  const pending = !!located?.pending && state.items.length === 0 && !preview;
  usePendingTranscript(pane, located, state.items.length === 0 || preview !== null, view.status, () => {
    setPreview(null);
    open(null);
  });

  const choose = (path: string) => {
    rememberTranscript(key, path);
    open(path);
  };

  // Tool results render inside their call; each turn's work folds into one row.
  const { rows, results } = useMemo(() => buildRows(items, state.total - state.items.length), [items, state.total, state.items.length]);
  // Where the paths the Chat names are: asked of its machine as their rows show, once each.
  const itemsNow = useRef(items);
  itemsNow.current = items;
  const paths = useMemo(() => pathResolver(pane.machine_id, () => itemsNow.current), [pane.machine_id]);
  const asked = useMemo(() => pendingQuestions(items), [items]);
  // Badges follow the strip's rule: nothing runs once the agent is gone, and a fork's preview
  // of the original transcript must not claim the original's tasks. The value keeps its identity
  // while its content is unchanged, so an append does not re-render every tool card.
  const bgRef = useRef<BackgroundState>({ running: new Set(), ends: new Map() });
  // An agent waiting on its own background work is done as Claude Code shows it (◯): only its
  // shell runs, and the transcript may never report that shell ending.
  const runningTasks = useMemo(() => state.background.filter((t) => !t.waiting), [state.background]);
  const background = useMemo(() => {
    const running = new Set(view.agent && !preview ? runningTasks.map((t) => t.call_id) : []);
    bgRef.current = stableBackground(bgRef.current, { running, ends: taskEnds(items) });
    return bgRef.current;
  }, [runningTasks, items, view.agent, preview]);
  const sessionPrompts = useMemo(
    () => items.flatMap((i) => (i.kind === "user" && i.text.trim() ? [i.text] : [])),
    [items],
  );
  const toggle = useCallback((id: string, wasOpen: boolean) => {
    setChosenOpen((m) => new Map(m).set(id, !wasOpen));
  }, []);
  const live = view.status === "working" || view.status === "blocked";
  const start = useMemo(() => liveStart(rows), [rows]);

  // Find (Edit › Find…, ⌘F): what the loaded rows show: your messages, the answers, thinking, an open Work block (chatFind).
  const showThinking = view.agent === "claude";
  const [findOpen, setFindOpen] = useState(false);
  const [findFocus, setFindFocus] = useState(0);
  const [findQuery, setFindQuery] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [findSteps, setFindSteps] = useState(0);

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 8,
    getItemKey: (i) => rows[i].key,
  });

  const hits = useMemo(
    () => (findOpen ? chatFindHits(rows, findQuery, findCase, { thinking: showThinking, isOpen: (id) => chosenOpen.get(id) ?? false }) : []),
    [findOpen, rows, findQuery, findCase, showThinking, chosenOpen],
  );
  const hitAt = hits.length ? wrapIndex(0, findSteps, hits.length) : -1;
  // Numbers, not the hit object: rows change as the chat grows, and that must not scroll again.
  const hitRow = hitAt >= 0 ? hits[hitAt].row : -1;
  const hitNth = hitAt >= 0 ? hits[hitAt].nth : -1;
  const findRef = useRef<(what: FindRequest) => void>(() => {});
  findRef.current = (what) => {
    if (what === "open") {
      setFindOpen(true);
      setFindFocus((n) => n + 1);
    } else if (findOpen && hits.length) setFindSteps((n) => n + (what === "prev" ? -1 : 1));
  };
  useEffect(() => onFindRequest((what) => findRef.current(what)), []);
  /** Paints the matches in the rows on screen, and the current one; the list mounts rows as they show. */
  const paintFind = useCallback(() => {
    const root = contentRef.current;
    if (!root || !findOpen || !findQuery) return clearHighlights(FIND_ALL, FIND_CURRENT);
    const all: Range[] = [];
    let current: Range | null = null;
    for (const el of root.querySelectorAll<HTMLElement>(":scope > [data-index]")) {
      const row = rows[Number(el.dataset.index)];
      const ranges = row ? rowFindRanges(el, row.kind, findQuery, findCase, showThinking) : [];
      all.push(...ranges);
      if (Number(el.dataset.index) === hitRow) current = ranges[Math.min(hitNth, ranges.length - 1)] ?? null;
    }
    setHighlight(FIND_ALL, all);
    setHighlight(FIND_CURRENT, current ? [current] : []);
  }, [findOpen, findQuery, findCase, hitRow, hitNth, rows, showThinking]);
  // To the current match's row when the reader moves it (types, steps); not when the matches
  // shift under it (the chat grows, a Work block opens). Paint once it has mounted.
  const hitRowRef = useRef(hitRow);
  hitRowRef.current = hitRow;
  useEffect(() => {
    if (hitRowRef.current >= 0) virtRef.current.scrollToIndex(hitRowRef.current, { align: "center" });
  }, [findQuery, findCase, findSteps]);
  useEffect(() => {
    const f = requestAnimationFrame(paintFind);
    return () => cancelAnimationFrame(f);
  }, [paintFind]);
  useEffect(() => () => clearHighlights(FIND_ALL, FIND_CURRENT), []);

  const virtRef = useRef(virt);
  virtRef.current = virt;
  const prevRows = useRef(0);
  const prevItems = useRef(0);
  useLayoutEffect(() => {
    // Items, not rows: a tool call joining the live work block grows that row, not the count.
    const grew = state.items.length > prevItems.current;
    if (anchor.current !== null) {
      // Older items were prepended: keep the previously-first row in view.
      const added = rows.length - prevRows.current;
      virt.scrollToIndex(Math.max(0, added), { align: "start" });
      anchor.current = null;
    } else if (forceBottom.current || (grew && atBottom.current)) {
      if (rows.length > 0) virt.scrollToIndex(rows.length - 1, { align: "end" });
      forceBottom.current = rows.length === 0;
      atBottom.current = true;
      setUnseen(false);
    } else if (grew) {
      setUnseen(true);
    }
    prevRows.current = rows.length;
    prevItems.current = state.items.length;
  }, [rows.length, state.items.length, virt]);

  // Rows measure taller than their estimate after the jump, and the working indicator
  // shrinks the viewport: neither fires a scroll event, so stay pinned while at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current && anchor.current === null) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 40;
    if (atBottom.current) setUnseen(false);
    if (el.scrollTop <= 0 && !loadingOlder.current) {
      const before = state.total - state.items.length;
      if (before <= 0) return;
      loadingOlder.current = true;
      const gen = generation.current;
      chatPage(pane, before)
        .then((older) => {
          if (gen !== generation.current || older.length === 0) return;
          // A trim or reset since the fetch moved the window: the reducer drops the page, so
          // leave no anchor behind for it.
          const now = latest.current;
          if (now.total - now.items.length !== before) return;
          anchor.current = 0;
          dispatch({ type: "prepend", items: older, before });
        })
        .catch((e) => console.error("chat_page failed", e))
        .finally(() => {
          loadingOlder.current = false;
        });
    }
  };

  const jumpBottom = () => {
    if (rows.length > 0) virt.scrollToIndex(rows.length - 1, { align: "end" });
    atBottom.current = true;
    setUnseen(false);
  };

  // The outline rail follows the first row in view, or the last turn once at the end.
  const entries = useMemo(() => outline(rows), [rows]);
  const scrollTop = virt.scrollOffset ?? 0;
  const topRow = virt.getVirtualItems().find((v) => v.end > scrollTop)?.index ?? 0;
  const atEnd = rows.length > 0 && scrollTop + (virt.scrollRect?.height ?? 0) >= virt.getTotalSize() - 40;
  const pickedAt = picked === null ? -1 : entries.findIndex((e) => e.key === picked);
  const current = pickedAt >= 0 ? pickedAt : currentEntry(entries, topRow, atEnd);
  const unpick = () => setPicked(null);
  // Off the bottom before the scroll lands: an append meanwhile would pull the view back down.
  const jumpTo = (row: number) => {
    atBottom.current = false;
    setPicked(entries.find((e) => e.row === row)?.key ?? null);
    virt.scrollToIndex(row, { align: "start" });
  };
  // A task's card may sit in a folded work block: open it, scroll to its row, then bring the
  // card itself into view once the block has rendered.
  const jumpNow = (callId: string, i: number) => {
    const row = rows[i];
    if (row.kind === "work") setChosenOpen((m) => new Map(m).set(row.block.id, true));
    jumpTo(i);
    setPendingCard(callId);
  };
  const clearPendingCard = useCallback(() => setPendingCard(null), []);
  // The call is older than the loaded window: page back until it appears or the start is reached.
  const loadUntilCall = async (callId: string) => {
    if (loadingOlder.current) {
      setJumpNotice("Still loading older messages; click again in a moment.");
      return;
    }
    loadingOlder.current = true;
    const gen = generation.current;
    const first = latest.current.total - latest.current.items.length;
    const pages: ChatItem[][] = [];
    let before = first;
    let found = false;
    try {
      while (before > 0 && !found) {
        const older = await chatPage(pane, before);
        if (gen !== generation.current) return;
        if (older.length === 0) break;
        pages.unshift(older);
        before -= older.length;
        found = older.some((it) => it.kind === "tool_call" && it.id === callId);
      }
      const now = latest.current;
      if (now.total - now.items.length !== first) {
        setJumpNotice("The transcript changed while loading older messages; click again.");
        return;
      }
      if (pages.length > 0) {
        anchor.current = 0;
        dispatch({ type: "prepend", items: pages.flat(), before: first });
      }
      if (found) setPendingJump(callId);
      else setJumpNotice("Task call not found in the transcript: it started before the part Drover can read.");
    } catch (e) {
      setJumpNotice(`Could not load older messages: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      loadingOlder.current = false;
    }
  };
  const jumpToCall = (callId: string) => {
    setJumpNotice(null);
    const i = rowOfCall(rows, callId);
    if (i >= 0) jumpNow(callId, i);
    else void loadUntilCall(callId);
  };
  useEffect(() => {
    if (!pendingJump) return;
    const i = rowOfCall(rows, pendingJump);
    if (i < 0) return;
    setPendingJump(null);
    // The virtualizer re-adjusts scroll from its pre-jump offset when it measures the
    // rows a prepend just rendered, undoing an immediate jump; wait two frames.
    // No cleanup: setPendingJump(null) re-runs this effect and would cancel the frames.
    const target = pendingJump;
    requestAnimationFrame(() => requestAnimationFrame(() => jumpNow(target, i)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJump, rows]);

  const err = openError ?? state.error;
  // Edit takes the user's last message back through Claude's Rewind: Claude only, a session
  // herdr tracks, and not while the lens previews another session's history (a new fork).
  const editable = view.agent === "claude" && !view.untracked && !preview;
  const btwOpen = useBtw((s) => !!s.open[key] || !!s.asides[key]);
  const lastUser = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === "user") return items[i];
    return null;
  }, [items]);
  const edit = useMemo(
    () =>
      editable
        ? {
            last: lastUser,
            onEdit: (text: string) =>
              void editLast(
                pane,
                text,
                (m, p) => herdrCall(pane.machine_id, pane.session, m, p),
                () => findPane(useApp.getState().machines, pane)?.status,
              ),
          }
        : null,
    [editable, lastUser, pane],
  );

  return (
    <ChatPaneContext.Provider value={pane}>
    <ChatPathsContext.Provider value={paths}>
    <ChatEditContext.Provider value={edit}>
    <ChatOpenContext.Provider value={opened}>
    <BackgroundContext.Provider value={background}>
    <div className="chat-lens" data-width={chatWidth}>
    <div className="chat-main">
      {located && <TranscriptPicker located={located} onChoose={choose} />}
      {err && <div className="chat-notice chat-error">{err.code}: {err.message}</div>}
      {forkOf && (
        <div className="chat-notice neutral chat-fork" role="status" aria-label="Fork">
          <GitBranchIcon className="icon" />
          <span>
            Forked from <b>{forkOf.from}</b> at {new Date(forkOf.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}
            {forkOf.worktree && <> · worktree {forkOf.worktree}</>} · knows nothing the original did after that
          </span>
          <button className="btn btn-xs" onClick={() => useApp.getState().select(forkOf.of)}>Back to original</button>
        </div>
      )}
      {jumpNotice && <div className="chat-notice neutral" role="status">{jumpNotice}</div>}
      {pending && !err && <div className="chat-notice neutral">New conversation: send the first message to start it.</div>}
      {preview && forkOf && !err && (
        <div className="chat-notice neutral">History copied from {forkOf.from} up to the fork. Your first message starts the fork's own transcript.</div>
      )}
      {!loaded && loadingShown && !pending && !err && <div className="chat-notice neutral">Loading transcript…</div>}
      {findOpen && (
        <FindBar
          placeholder="Find in chat"
          focusKey={findFocus}
          query={findQuery}
          matchCase={findCase}
          count={hits.length}
          index={Math.max(hitAt, 0)}
          onQuery={(q) => {
            setFindQuery(q);
            setFindSteps(0);
          }}
          onMatchCase={(on) => {
            setFindCase(on);
            setFindSteps(0);
          }}
          onStep={(d) => setFindSteps((n) => n + d)}
          onClose={() => setFindOpen(false)}
        />
      )}
      <div className="chat-scroll" ref={scrollRef} onScroll={() => {
          onScroll();
          if (findOpen) paintFind();
        }} onWheel={unpick} onPointerDown={unpick} onKeyDown={unpick}>
        <div ref={contentRef} style={{ height: virt.getTotalSize(), position: "relative" }}>
          {virt.getVirtualItems().map((v) => {
            const row = rows[v.index];
            return (
              <div
                key={v.key}
                data-index={v.index}
                ref={virt.measureElement}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}
              >
                {row.kind === "work" ? (
                  <WorkBlockView
                    block={row.block}
                    results={results}
                    // Folded until opened, the latest turn too: the header's summary says what was done.
                    open={chosenOpen.get(row.block.id) ?? false}
                    onToggle={toggle}
                    live={live && row.last}
                    working={view.status === "working" && row.last}
                    focusCall={pendingCard}
                    onFocusHandled={clearPendingCard}
                    thinking={showThinking}
                  />
                ) : (
                  <ChatItemView
                    item={row.item}
                    copy
                    result={row.item.kind === "tool_call" ? results.get(row.item.id) : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {unseen && (
        <button className="chat-new" onClick={jumpBottom}>
          <ArrowDownIcon /> New messages
        </button>
      )}
      {view.agent && <BackgroundTasks tasks={runningTasks} onJump={jumpToCall} />}
      <QueuedMessages texts={state.queued} />
      <EditPanel pane={pane} />
      <WorkingIndicator status={view.status} start={start} />
      {view.status === "blocked" || picker.open ? (
        <PromptPanel pane={pane} view={view} fallback={view.status === "blocked"} asked={asked} />
      ) : (
        <Composer pane={pane} agent={view.agent} status={view.status} untracked={view.untracked} onPiModel={() => setModelFor(key)} meta={meta} sessionPrompts={sessionPrompts} />
      )}
    </div>
    {/* The /btw column takes the outline's place while it is open. */}
    {btwOpen ? <BtwPanel pane={pane} untracked={view.untracked} /> : <ChatOutline entries={entries} current={current} onJump={jumpTo} />}
    </div>
    </BackgroundContext.Provider>
    </ChatOpenContext.Provider>
    </ChatEditContext.Provider>
    </ChatPathsContext.Provider>
    </ChatPaneContext.Provider>
  );
}
