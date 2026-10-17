import { beforeEach, describe, expect, it } from "vitest";
import { itemKey, type OpenItem } from "./openItems";
import { loadOpenItems, saveOpenItems } from "./openItemsSaved";

const agent: OpenItem = { kind: "agent", ref: { machine_id: "local", session: "s", pane_id: "p1" } };
const file: OpenItem = { kind: "file", ws: { machine_id: "devtuf", session: "s", workspace_id: "w1" }, root: "/r", rel: "a.ts" };

describe("saved open items", () => {
  beforeEach(() => localStorage.clear());

  it("are empty when nothing was saved", () => {
    expect(loadOpenItems()).toEqual({ items: [], preview: null, active: null });
  });

  it("come back as saved: items in order, the preview and the active one", () => {
    const s = { items: [agent, file], preview: itemKey(file), active: itemKey(agent) };
    saveOpenItems(s);
    expect(loadOpenItems()).toEqual(s);
  });

  it("drop malformed items, and a preview or active that is no longer among them", () => {
    localStorage.setItem(
      "drover:open-items",
      JSON.stringify({
        items: [agent, { kind: "agent", ref: { machine_id: "local" } }, { kind: "file", ws: file.kind === "file" && file.ws, root: 1, rel: "b" }, "x", null],
        preview: "file:gone",
        active: itemKey(agent),
      }),
    );
    expect(loadOpenItems()).toEqual({ items: [agent], preview: null, active: itemKey(agent) });
  });

  it("are empty when the stored value is not JSON or not an object", () => {
    localStorage.setItem("drover:open-items", "{nope");
    expect(loadOpenItems().items).toEqual([]);
    localStorage.setItem("drover:open-items", "[1]");
    expect(loadOpenItems().items).toEqual([]);
  });
});
