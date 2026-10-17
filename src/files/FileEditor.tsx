import type { LanguageSupport } from "@codemirror/language";
import { findNext, findPrevious, openSearchPanel } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { onFindRequest } from "./findBus";
import { useEffect, useRef } from "react";
import { useDrafts } from "./drafts";
import { languageFor, languageSlot, wrapSlot } from "./editorSetup";

const isEmpty = (v: EditorView) => {
  const ext = languageSlot.get(v.state);
  return Array.isArray(ext) && ext.length === 0;
};

const wrapping = (on: boolean) => (on ? EditorView.lineWrapping : []);

/** Puts the wrap setting into the view's state, which `open` and `rebase` build without it. */
function setWrap(view: EditorView, on: boolean) {
  if ((wrapSlot.get(view.state) === EditorView.lineWrapping) !== on) view.dispatch({ effects: wrapSlot.reconfigure(wrapping(on)) });
}

/** One CodeMirror view over the Draft stored under `draftKey`; the store holds the state, the view shows it. */
export function FileEditor({ draftKey, wrap = false }: { draftKey: string; wrap?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const wrapRef = useRef(wrap);
  wrapRef.current = wrap;

  useEffect(() => {
    const draft = useDrafts.getState().drafts[draftKey];
    if (!host.current || !draft) return;
    const rel = draft.rel;
    let alive = true;
    // undefined = not asked yet; null = the file has no language. Kept per mount so a refill is synchronous.
    let support: LanguageSupport | null | undefined;

    const view = new EditorView({
      state: draft.state,
      parent: host.current,
      dispatchTransactions(trs, v) {
        v.update(trs);
        useDrafts.getState().update(draftKey, v.state);
      },
    });

    // `open` and `rebase` build states with an empty language slot; this puts the language back.
    const fillLanguage = () => {
      if (!alive || !isEmpty(view)) return;
      if (support) view.dispatch({ effects: languageSlot.reconfigure(support) });
      else if (support === undefined)
        void languageFor(rel).then(
          (s) => {
            support = s;
            fillLanguage();
          },
          () => {
            support = null;
          },
        );
    };

    const unsubscribe = useDrafts.subscribe((s) => {
      const next = s.drafts[draftKey]?.state;
      if (!next || next === view.state) return;
      view.setState(next);
      fillLanguage();
      setWrap(view, wrapRef.current);
    });

    viewRef.current = view;
    setWrap(view, wrapRef.current);
    view.focus();
    fillLanguage();
    // Edit › Find…, Find Next, Find Previous: the menu bar takes ⌘F/⌘G before this editor's keymap.
    const offFind = onFindRequest((what) => {
      if (what === "open") openSearchPanel(view);
      else if (what === "next") findNext(view);
      else findPrevious(view);
    });

    return () => {
      alive = false;
      viewRef.current = null;
      unsubscribe();
      offFind();
      view.destroy();
    };
  }, [draftKey]);

  useEffect(() => {
    if (viewRef.current) setWrap(viewRef.current, wrap);
  }, [wrap]);

  return <div className="files-editor" ref={host} />;
}
