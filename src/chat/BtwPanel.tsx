import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { herdrCall } from "../lib/ipc";
import { paneKey, type PaneRef } from "../lib/types";
import { useApp } from "../store/app";
import { CloseIcon, SendIcon } from "../ui/icons";
import { closeBtw, useBtw, type Aside } from "./btw";
import { asPaneCall } from "./Composer";
import { CopyButton } from "./CopyButton";
import { BTW_DEFAULT, BTW_MAX, BTW_MIN, clampBtwWidth, loadBtwWidth, saveBtwWidth } from "./outlineWidth";
import { ResizeEdge } from "./ResizeEdge";
import { useFitHeight } from "./useFitHeight";

/**
 * The pane's `/btw` thread, in a column beside the chat with its own box: the Composer below the
 * chat stays for the main session. Claude draws the answers over its terminal and keeps them out
 * of the transcript, so this is the only place the Chat lens shows them.
 */
const NONE: Aside[] = [];

export function BtwPanel({ pane, untracked = false }: { pane: PaneRef; untracked?: boolean }) {
  const key = paneKey(pane);
  const aside = useBtw((s) => s.asides[key]);
  const earlier = useBtw((s) => s.history[key]) ?? NONE;
  const open = useBtw((s) => !!s.open[key]);
  const focus = useBtw((s) => s.focus[key]);
  const text = useBtw((s) => s.drafts[key]) ?? "";
  const setText = (t: string) => useBtw.getState().setDraft(pane, t);
  const [width, setWidth] = useState(loadBtwWidth);
  const resize = (px: number) => {
    const w = clampBtwWidth(px);
    setWidth(w);
    return w;
  };
  const body = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useFitHeight(box, text);
  // A new question or its answer is what to read: bring it into view below the thread.
  useLayoutEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [aside?.question, aside?.phase, earlier.length]);
  // The /btw key asks for the box, also when the column is already open.
  useEffect(() => {
    if (focus) box.current?.focus();
  }, [focus]);
  const setLens = useApp((s) => s.setLens);
  if (!open && !aside) return null;
  const call = (m: string, p: unknown) => {
    const [method, params] = untracked ? asPaneCall(m, p) : [m, p];
    return herdrCall(pane.machine_id, pane.session, method, params);
  };
  const close = () => void closeBtw(pane, call);
  // Claude's own /btw panel takes the pane's keys until the answer is read and the panel closed.
  const asking = aside?.phase === "asking";
  const question = text.trim();
  const canAsk = question !== "" && !asking;
  const ask = () => {
    if (!canAsk) return;
    setText("");
    call("agent.prompt", { target: pane.pane_id, text: `/btw ${question}` }).then(
      () => void useBtw.getState().ask(pane, question, call),
      () => {
        if (!useBtw.getState().drafts[key]) setText(question);
      },
    );
  };

  return (
    <section className="btw-side" role="region" aria-label="Side question" style={{ width }}>
      <ResizeEdge label="Resize side question" width={width} min={BTW_MIN} max={BTW_MAX} fallback={BTW_DEFAULT} resize={resize} save={saveBtwWidth} />
      <header className="btw-head">
        <span className="btw-tag">/btw</span>
        <span className="btw-question" title={aside?.question}>{aside?.question ?? "Ask Claude on the side"}</span>
        {aside?.phase === "done" && aside.answer && <CopyButton text={aside.answer} />}
        {asking ? (
          <button type="button" className="btn btn-xs" onClick={close}>Cancel</button>
        ) : (
          <button type="button" className="chat-copy btw-close" aria-label="Close" title="Close" onClick={close}>
            <CloseIcon />
          </button>
        )}
      </header>
      <div className="btw-body" ref={body}>
      {!aside && (
        <div className="btw-hint">Claude answers from the conversation without stopping its turn; the answer stays out of the transcript.</div>
      )}
      {earlier.map((a, i) => (
        <details key={i} className="btw-earlier">
          <summary>{a.question}</summary>
          {a.phase === "done" ? (
            <pre className="btw-answer">{a.answer || "(empty answer)"}</pre>
          ) : (
            <div className="btw-error">Could not read the answer: {a.error}</div>
          )}
        </details>
      ))}
      {asking && <div className="btw-status" role="status">Answering…</div>}
      {aside?.phase === "done" && <pre className="btw-answer">{aside.answer || "(empty answer)"}</pre>}
      {aside?.phase === "failed" && (
        <div className="btw-error" role="alert">
          <span>Could not read the answer: {aside.error}</span>
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => {
              setLens(key, "terminal");
              close();
            }}
          >
            Open terminal
          </button>
        </div>
      )}
      </div>
      <div className="btw-compose">
        <textarea
          ref={box}
          rows={2}
          autoFocus
          aria-label="Side question"
          placeholder="Ask on the side…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask();
            }
          }}
        />
        <button className="send" aria-label="Ask" title={asking ? "Wait for the /btw answer" : undefined} disabled={!canAsk} onClick={ask}>
          <SendIcon />
        </button>
      </div>
    </section>
  );
}
