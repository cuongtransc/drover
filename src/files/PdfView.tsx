import { useEffect, useRef, useState } from "react";
import { filesPdf } from "../lib/ipc";

/**
 * A PDF from `rel`, shown by WebKit's own PDF viewer in a frame (zoom, text selection, ⌘F).
 * When `mtime` changes (the watch reported the file changed) the version on screen stays, with a
 * banner to reload it: reloading starts the viewer at page 1, and it gives no scroll position to
 * restore.
 */
export function PdfView({ machineId, root, rel, mtime }: { machineId: string; root: string; rel: string; mtime: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // The version on screen; another file starts at its own mtime.
  const file = `${machineId}\u0000${root}\u0000${rel}`;
  const [shown, setShown] = useState({ file, mtime });
  if (shown.file !== file) setShown({ file, mtime });
  const stale = shown.file === file && shown.mtime !== mtime;

  useEffect(() => {
    let made: string | null = null;
    let gone = false;
    setUrl(null);
    setError(null);
    setLoaded(false);
    // `gone` drops the answer of a fetch this effect no longer wants.
    filesPdf(machineId, root, rel).then(
      (buf) => {
        if (gone) return;
        made = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
        setUrl(made);
      },
      (e) => {
        if (!gone) setError(String((e as { message?: string })?.message ?? e));
      },
    );
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [machineId, root, rel, shown.mtime]);

  // The viewer's document is white around the pages whatever the theme; it is same-origin, so
  // its backdrop takes the panel's colour (the pages stay as the PDF draws them). The theme is
  // watched on <html data-theme>, which App sets after this view's effects have run.
  useEffect(() => {
    if (!loaded) return;
    const paint = () => {
      const html = frame.current?.contentDocument?.documentElement;
      if (!html || !wrap.current) return;
      html.style.background = getComputedStyle(wrap.current).backgroundColor;
      html.style.colorScheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    };
    paint();
    const watch = new MutationObserver(paint);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, [loaded]);

  if (error) return <div className="files-notice">{error}</div>;
  return (
    <>
      {stale && (
        <div className="files-banner files-pdf-stale" role="status">
          This PDF changed on disk.
          <button type="button" onClick={() => setShown({ file, mtime })}>
            Reload
          </button>
        </div>
      )}
      <div className="files-pdf-wrap" ref={wrap}>
        {url && <iframe ref={frame} className="files-pdf" src={url} title={rel} onLoad={() => setLoaded(true)} />}
      </div>
    </>
  );
}
