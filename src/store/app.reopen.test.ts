import { beforeEach, describe, expect, it, vi } from "vitest";
import { itemKey, type OpenItem } from "./openItems";

const agent: OpenItem = { kind: "agent", ref: { machine_id: "local", session: "s", pane_id: "p1" } };
const file: OpenItem = { kind: "file", ws: { machine_id: "local", session: "s", workspace_id: "w1" }, root: "/r", rel: "a.ts" };
const saved = (active: OpenItem) =>
  localStorage.setItem("drover:open-items", JSON.stringify({ items: [agent, file], preview: itemKey(file), active: itemKey(active) }));
const launch = async () => {
  vi.resetModules();
  return (await import("./app")).useApp;
};

describe("open items across launches", () => {
  beforeEach(() => localStorage.clear());

  it("reopen at launch, selecting the active agent's pane", async () => {
    saved(agent);
    const s = (await launch()).getState();
    expect(s.openItems).toEqual({ items: [agent, file], preview: itemKey(file), active: itemKey(agent) });
    expect(s.selected).toEqual(agent.kind === "agent" && agent.ref);
  });

  it("reopen with a file active and no pane selected", async () => {
    saved(file);
    const s = (await launch()).getState();
    expect(s.openItems.active).toBe(itemKey(file));
    expect(s.selected).toBeNull();
  });

  it("start empty when Reopen open items is off, and the session is still saved", async () => {
    saved(agent);
    localStorage.setItem("drover:settings", JSON.stringify({ reopenItems: false }));
    const app = await launch();
    expect(app.getState().openItems.items).toEqual([]);
    expect(app.getState().selected).toBeNull();
    app.getState().openFile(file.kind === "file" ? file.ws : (null as never), "/r", "b.ts", { pin: true });
    expect(JSON.parse(localStorage.getItem("drover:open-items")!).items).toHaveLength(1);
  });

  it("drop reopened items of a machine no longer configured, once the machine list is known", async () => {
    const remote: OpenItem = { kind: "agent", ref: { machine_id: "devtuf", session: "s", pane_id: "p9" } };
    localStorage.setItem(
      "drover:open-items",
      JSON.stringify({ items: [agent, remote, file], preview: null, active: itemKey(remote) }),
    );
    const app = await launch();
    expect(app.getState().openItems.items).toHaveLength(3);
    app.getState().keepMachines([]);
    expect(app.getState().openItems.items).toHaveLength(3);
    app.getState().keepMachines(["local"]);
    expect(app.getState().openItems).toEqual({ items: [agent, file], preview: null, active: null });
    // The reopened active item had selected its pane; that machine is gone too.
    expect(app.getState().selected).toBeNull();
  });

  it("save every change to the open items", async () => {
    const app = await launch();
    app.getState().openFile(file.kind === "file" ? file.ws : (null as never), "/r", "a.ts", { pin: false });
    expect(JSON.parse(localStorage.getItem("drover:open-items")!)).toEqual({ items: [file], preview: itemKey(file), active: itemKey(file) });
    app.getState().closeItems(itemKey(file), "one");
    expect(JSON.parse(localStorage.getItem("drover:open-items")!).items).toEqual([]);
  });
});
