import { useEffect, useState } from "react";
import { filesPdf } from "../lib/ipc";

/**
 * A PDF from `rel`, shown by WebKit's own PDF viewer in a frame (zoom, text selection, ⌘F).
 * `mtime` changing (the watch reported the file changed) fetches it again.
 */
export function PdfView({ machineId, root, rel, mtime }: { machineId: string; root: string; rel: string; mtime: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let made: string | null = null;
    let gone = false;
    setUrl(null);
    setError(null);
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

  if (error) return <div className="files-notice">{error}</div>;
  return <div className="files-pdf-wrap">{url && <iframe className="files-pdf" src={url} title={rel} />}</div>;
}
