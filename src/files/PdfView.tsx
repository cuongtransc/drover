import { useEffect, useRef, useState } from "react";
import { filesPdf } from "../lib/ipc";

/**
 * A PDF from `rel`, shown by WebKit's own PDF viewer in a frame (zoom, text selection, ⌘F).
 * `mtime` changing (the watch reported the file changed) fetches it again.
 */
export function PdfView({ machineId, root, rel, mtime }: { machineId: string; root: string; rel: string; mtime: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

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
  }, [machineId, root, rel, mtime]);

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
    <div className="files-pdf-wrap" ref={wrap}>
      {url && <iframe ref={frame} className="files-pdf" src={url} title={rel} onLoad={() => setLoaded(true)} />}
    </div>
  );
}
