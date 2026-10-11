import { paneKey, type PaneRef } from "../lib/types";
import { useApp } from "../store/app";
import { CloseIcon } from "../ui/icons";
import { dismissEdit, useRewind } from "./rewind";

/**
 * An edit of the user's last message in flight, above the Composer: going back through Claude's
 * Rewind screen, the question Claude asks when the message changed files, or why it failed.
 */
export function EditPanel({ pane }: { pane: PaneRef }) {
  const key = paneKey(pane);
  const edit = useRewind((s) => s.edits[key]);
  const setLens = useApp((s) => s.setLens);
  if (!edit) return null;

  return (
    <section className="btw-panel" role="region" aria-label="Edit last message">
      <header className="btw-head">
        <span className="btw-tag">Edit</span>
        <span className="btw-question">Your last message</span>
        {edit.phase === "failed" && (
          <button type="button" className="chat-copy btw-close" aria-label="Close" title="Close" onClick={() => dismissEdit(pane)}>
            <CloseIcon />
          </button>
        )}
      </header>
      {edit.phase === "running" && (
        <div className="btw-status" role="status">
          Going back to before your last message…
        </div>
      )}
      {edit.phase === "choose" && (
        <div className="edit-choose">
          <p>This message changed files. {edit.code}</p>
          <div className="edit-actions">
            <button type="button" className="btn btn-xs" onClick={() => edit.answer?.("conversation")}>
              Conversation only
            </button>
            <button type="button" className="btn btn-xs" onClick={() => edit.answer?.("both")}>
              Restore code and conversation
            </button>
            <button type="button" className="btn btn-xs" onClick={() => edit.answer?.(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {edit.phase === "failed" && (
        <div className="btw-error" role="alert">
          <span>Could not edit: {edit.error}</span>
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => {
              setLens(key, "terminal");
              dismissEdit(pane);
            }}
          >
            Open terminal
          </button>
        </div>
      )}
    </section>
  );
}
