import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => new ArrayBuffer(4)), Channel: class {} }));
import { invoke } from "@tauri-apps/api/core";
import { PdfView } from "./PdfView";

describe("PdfView", () => {
  // jsdom has no object URLs.
  const { createObjectURL, revokeObjectURL } = URL;
  beforeEach(() => {
    vi.mocked(invoke).mockClear();
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
  it("fetches again when its mtime changes, and frees the old URL", async () => {
    const { rerender, findByTitle } = render(<PdfView machineId="local" root="/r" rel="a.pdf" mtime={1} />);
    await findByTitle("a.pdf");
    rerender(<PdfView machineId="local" root="/r" rel="a.pdf" mtime={2} />);
    await findByTitle("a.pdf");
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });
  it("shows why a PDF could not be read", async () => {
    vi.mocked(invoke).mockRejectedValueOnce({ code: "invalid", message: "PDF larger than 20 MB" });
    const { findByText } = render(<PdfView machineId="local" root="/r" rel="a.pdf" mtime={1} />);
    expect(await findByText("PDF larger than 20 MB")).toBeTruthy();
  });
});
