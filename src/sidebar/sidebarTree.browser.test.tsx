import "../styles.css";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import type { CtaAccount, CtaQuota, MachineView, PaneView } from "../lib/types";

// The Sidebar's two columns (docs/design/ui-ux-guidelines.md §7.3), measured on the real components:
// header labels and every row's first glyph start at 16 (glyphs centred in a 16px slot, so centres
// at 24), names at 40, each child level +24; the right column ends 17px from the edge.
const M = 60_000, H = 60 * M, D = 24 * H;
const now = Date.now();
const w = (label: string, usedPercent: number, resetIn: number, durationSecs: number | null) => ({ label, usedPercent, resetsAt: now + resetIn, durationSecs });
const ok = (provider: string, account: string, windows: CtaAccount["windows"]): CtaAccount => ({ provider, account, polledAt: now - 2 * M, status: "ok", detail: "", windows });
const board: CtaQuota = { kind: "ok", readAt: now, accounts: [ok("claude", "a1", [w("5h", 40, 2 * H, 18_000)]), ok("codex", "c1", [w("week", 24, 6 * D, 604_800)])] };
vi.mock("../lib/ipc", async (orig) => ({ ...(await orig<typeof import("../lib/ipc")>()), herdrCall: vi.fn(async () => undefined),
  quotaFetch: vi.fn(async () => ({ kind: "notSignedIn" })), quotaCta: vi.fn(async () => board) }));
const { useApp } = await import("../store/app");
const { useLayout, sessionKey, projectKey } = await import("./groups");
const { Sidebar } = await import("./Sidebar");
const { QuotaStrip } = await import("./QuotaStrip");
const { useSessionFilter, useShowDefault } = await import("./activeFilter");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type St = PaneView["status"];
const ws = (id: string, label: string, status: St = "idle") => ({ workspace_id: id, label, number: 1, status, tabs: [{ tab_id: id + ":t", label: "1", number: 1, status, panes: [{ pane_id: id + ":p", terminal_id: "t" + id, title: label, cwd: "/x", agent: "claude", status } as PaneView] }] });
const ses = (name: string, list: ReturnType<typeof ws>[]) => ({ name, running: true, loaded: true, status: "idle" as St, error: null, workspaces: list });
const lan: MachineView = { id: "lan", label: "ct-hms-lan", kind: "ssh", state: "connected", error: null, version: "0.9.3", status: "idle", sessions: [ses("hs-xb", [ws("x1", "xbit-vault-specs")])] };
const local: MachineView = { id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "working", sessions: [
  ses("default", []), ses("ca", [ws("c1", "ca-trader")]), ses("ct", [ws("t1", "ct-dotfiles"), ws("t3", "ct-cli", "blocked")]),
] };

beforeEach(async () => {
  document.body.innerHTML = "";
  document.body.style.margin = "0";
  useApp.setState({ machines: { local, lan }, order: ["local", "lan"], selected: null, viewed: null, expanded: { machines: true }, doneSeen: {} } as never);
  useLayout.setState({ layout: { bookmarks: [projectKey("lan", "hs-xb", "xbit-vault-specs")], tree: [
    { kind: "session", key: sessionKey("local", "default") },
    { kind: "session", key: sessionKey("lan", "hs-xb") },
    { kind: "group", id: "g1", label: "Work", children: [{ kind: "session", key: sessionKey("local", "ca") }, { kind: "session", key: sessionKey("local", "ct") }] },
  ] } as never });
  useSessionFilter.setState({ filter: "all" });
  // The fixture measures rows on a `default` with no agent, which Sessions hides unless shown.
  useShowDefault.setState({ show: true });
  const app = document.createElement("div");
  app.style.cssText = "display:flex;height:100vh";
  app.innerHTML = '<nav class="sidebar"><div class="sidebar-scroll" id="root"></div><div id="foot"></div></nav><main style="flex:1"></main>';
  document.body.appendChild(app);
  await act(async () => createRoot(document.getElementById("root")!).render(<Sidebar />));
  await act(async () => createRoot(document.getElementById("foot")!).render(<QuotaStrip />));
  await act(async () => {});
  await act(async () => {});
});

const nav = () => document.querySelector(".sidebar")!.getBoundingClientRect();
const left = (el: Element) => Math.round(el.getBoundingClientRect().left - nav().left);
const centre = (el: Element) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2 - nav().left; };
const fromRight = (el: Element) => Math.round(nav().right - el.getBoundingClientRect().right);
const textLeft = (el: Element) => {
  const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent!.trim())!;
  const range = document.createRange();
  range.selectNodeContents(node);
  return Math.round(range.getBoundingClientRect().left - nav().left);
};
const all = (sel: string) => [...document.querySelectorAll(sel)];
const near = (a: number, b: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(1);

it("starts every header label at 16, where the rows' glyphs start", () => {
  const labels = all(".section-toggle");
  expect(labels.map((l) => l.textContent)).toEqual(["Bookmarks", "Sessions", "Machines", "Quota"]);
  for (const l of labels) near(textLeft(l), 16);
});

it("centres every first glyph at 24 and starts every name at 40, children one step of 24 in", () => {
  const sessions = (name: string, region: string) =>
    all(`[aria-label="${region}"] li.session > .row`).find((r) => r.querySelector(".label")!.textContent === name)!;
  for (const row of [document.querySelector('[aria-label="Bookmarks"] .bm-row')!, sessions("default", "Groups"), sessions("hs-xb", "Groups")]) {
    near(centre(row.querySelector(".slot")!), 24);
    near(left(row.querySelector(".label")!), 40);
  }
  for (const icon of all(".machine-icon, .quota-row .agent-tile")) near(centre(icon), 24);
  for (const name of all("li.machine .label, .quota-name")) near(left(name), 40);
  // A Group: its chevron in the slot, then its folder; its Sessions' slots under the folder.
  const group = document.querySelector("li.group > .row")!;
  near(centre(group.querySelector(".slot")!), 24);
  near(left(group.querySelector(".label")!), 64);
  const ca = sessions("ca", "Groups");
  near(centre(ca.querySelector(".slot")!), 48);
  near(left(ca.querySelector(".label")!), 64);
  // Projects: their dot under the Session's first letter.
  const specs = all(".project-row").find((r) => r.textContent === "xbit-vault-specs")!;
  near(centre(specs.querySelector(".project-dot")!), 48);
  near(left(specs.querySelector(".label")!), 64);
  // The fold button lies over its Session's slot.
  for (const b of all(".fold-toggle")) {
    const row = b.parentElement!.querySelector(":scope > .row .slot")!;
    near(centre(b), centre(row));
  }
});

it("ends the right column 17px from the edge and centres the + over the status dots", () => {
  // The Sessions filter's machine chips run from the left, as words do.
  for (const el of all(".active-toggle:not(.machine-chips *), .machine-chip, .project-word, .quota-val")) near(fromRight(el), 17);
  const plus = document.querySelector(".section-action svg")!;
  for (const dot of all("li.machine .dot")) near(centre(plus), centre(dot));
});

it("keeps a header's chevron well apart from the section's controls", () => {
  for (const head of all(".section-head")) {
    const chev = head.querySelector(".section-toggle .chev")!.getBoundingClientRect();
    const ctl = head.querySelector(".active-toggle, .section-action")!.getBoundingClientRect();
    expect(ctl.left - chev.right).toBeGreaterThan(40);
  }
});

it("keeps the Active toggle still when switching it changes whether the list scrolls", async () => {
  // Quiet projects enough to overflow under All, none of them kept by Active.
  const many = ses("many", Array.from({ length: 30 }, (_, i) => ws("q" + i, "quiet-" + i)));
  await act(async () => useApp.setState({ machines: { local: { ...local, sessions: [...local.sessions, many] }, lan } } as never));
  const scroller = document.querySelector(".sidebar-scroll")!;
  const toggle = () => document.querySelector(".sessions-section .active-toggle")!;
  expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
  const before = toggle().getBoundingClientRect().right;
  await act(async () => (toggle() as HTMLElement).click());
  expect(scroller.scrollHeight).toBeLessThanOrEqual(scroller.clientHeight);
  expect(toggle().getBoundingClientRect().right).toBe(before);
});

it("lays the Sessions filter between the columns, three machines' chips on one row", async () => {
  const dev: MachineView = { ...lan, id: "dev", label: "ct-dev", sessions: [] };
  await act(async () => useApp.setState({ machines: { local, lan, dev }, order: ["local", "lan", "dev"] } as never));
  const field = document.querySelector(".session-filter-field")!;
  near(left(field), 16);
  near(fromRight(field), 17);
  const chips = all(".machine-chips .active-toggle");
  expect(chips.map((c) => c.textContent)).toEqual(["local", "ct-hms-lan", "ct-dev"]);
  near(left(chips[0]), 16);
  expect(new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top))).size).toBe(1);
});
