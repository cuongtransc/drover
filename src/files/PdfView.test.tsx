import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => new ArrayBuffer(4)), Channel: class {} }));
import { invoke } from "@tauri-apps/api/core";
import { PdfView } from "./PdfView";
import conf from "../../src-tauri/tauri.conf.json";

describe("PdfView", () => {
  // jsdom has no object URLs.
  const { createObjectURL, revokeObjectURL } = URL;
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
    document.documentElement.dataset.theme = "dark";
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  });
  it("shows the PDF bytes, typed as a PDF, in a frame", async () => {
    const { findByTitle } = render(<PdfView machineId="local" root="/r" rel="d/a.pdf" mtime={1} />);
    const frame = (await findByTitle("d/a.pdf")) as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("src")).toBe("blob:x");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("files_pdf", { machineId: "local", root: "/r", rel: "d/a.pdf" });
    expect((vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob).type).toBe("application/pdf");
  });
  // Reloading a PDF loses the reader's place (WebKit's viewer gives no scroll position), so a
  // change on disk is said, and the reader reloads when ready.
  it("keeps the page when the file changes, says so, and reloads on request", async () => {
    const { rerender, findByTitle, findByRole, queryByRole } = render(<PdfView machineId="local" root="/r" rel="a.pdf" mtime={1} />);
    await findByTitle("a.pdf");
    rerender(<PdfView machineId="local" root="/r" rel="a.pdf" mtime={2} />);
    const reload = await findByRole("button", { name: "Reload" });
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    fireEvent.click(reload);
    await waitFor(() => expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
    await findByTitle("a.pdf");
    expect(queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("opens another file fresh, without a banner", async () => {
    const { rerender, findByTitle, queryByRole } = render(<PdfView machineId="local" root="/r" rel="a.pdf" mtime={1} />);
    await findByTitle("a.pdf");
    rerender(<PdfView machineId="local" root="/r" rel="b.pdf" mtime={5} />);
    await findByTitle("b.pdf");
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2);
    expect(queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("paints the frame's backdrop with the panel's colour, again when the theme changes", async () => {
    const { container, findByTitle } = render(<PdfView machineId="local" root="/r" rel="a.pdf" mtime={1} />);
    const frame = (await findByTitle("a.pdf")) as HTMLIFrameElement;
    const wrap = container.querySelector(".files-pdf-wrap") as HTMLElement;
    wrap.style.backgroundColor = "rgb(30, 30, 30)";
    // jsdom leaves a blob: frame's document empty; WebKit's holds the viewer.
    const doc = frame.contentDocument!;
    if (!doc.documentElement) doc.appendChild(doc.createElement("html"));
    fireEvent.load(frame);
    const html = () => frame.contentDocument!.documentElement.style;
    expect(html().background).toBe("rgb(30, 30, 30)");
    expect(html().colorScheme).toBe("dark");
    // App puts the theme on <html data-theme> in its own effect, after this view's effects ran.
    wrap.style.backgroundColor = "rgb(245, 245, 247)";
    document.documentElement.dataset.theme = "light";
    await waitFor(() => expect(html().background).toBe("rgb(245, 245, 247)"));
    expect(html().colorScheme).toBe("light");
  });
  it("shows why a PDF could not be read", async () => {
    vi.mocked(invoke).mockRejectedValueOnce({ code: "invalid", message: "PDF larger than 20 MB" });
    const { findByText } = render(<PdfView machineId="local" root="/r" rel="a.pdf" mtime={1} />);
    expect(await findByText("PDF larger than 20 MB")).toBeTruthy();
  });
});

// The PDF frame is a blob: document, which inherits the page's CSP. From a header (as Tauri sends
// it) `frame-ancestors 'none'` or `'self'` blanks that frame; only the page's own origin, named,
// lets it draw (checked in a WKWebView, 2026-10-15).
describe("CSP for the PDF frame", () => {
  const directive = (csp: string, name: string) =>
    csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
  it.each([
    ["csp", "tauri://localhost"],
    ["devCsp", "http://localhost:1420"],
  ] as const)("%s allows blob: frames and names its origin as the only ancestor", (key, origin) => {
    const csp = conf.app.security[key];
    expect(directive(csp, "frame-src")).toBe("frame-src blob:");
    expect(directive(csp, "frame-ancestors")).toBe(`frame-ancestors ${origin}`);
  });
});
