// `mise run docs:ui-map`: the real App, rendered from its components with sample data, screenshotted
// in light and dark with each named surface measured. scripts/ui-map.mjs turns the result into
// docs/design/ui-map.html. It also takes the README's three screenshots (docs/screenshots/). Not a
// test: it writes those files.
import "../styles.css";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { commands, page } from "vitest/browser";
import type { ChatItem, MachineView, PaneView } from "../lib/types";
import { SURFACES } from "./uiMap.surfaces";

const W = 1440, H = 900;
const pane = (id: string, title: string, agent: string | null, status: PaneView["status"], cwd = "/Users/me/drover"): PaneView =>
  ({ pane_id: id, terminal_id: "t" + id, title, cwd, agent, status });
const local: MachineView = {
  id: "local", label: "MacBook Pro", kind: "local", state: "connected", error: null, version: "0.9.3", status: "working",
  sessions: [
    { name: "ct", running: true, loaded: true, status: "working", error: null, workspaces: [
      { workspace_id: "w1", label: "drover", number: 1, status: "working", tabs: [
        { tab_id: "w1:t1", label: "orch-ui", number: 1, status: "working", panes: [pane("p1", "Compact tab bar", "claude", "working")] },
        { tab_id: "w1:t2", label: "lane-docs", number: 2, status: "blocked", panes: [pane("p2", "UI map doc", "pi", "blocked")] },
        { tab_id: "w1:t3", label: "dev", number: 3, status: "idle", panes: [pane("p3", "zsh", null, "idle")] } ] },
      { workspace_id: "w2", label: "ct-cli", number: 2, status: "done", tabs: [
        { tab_id: "w2:t1", label: "1", number: 1, status: "done", panes: [pane("p4", "ct mr edit", "claude", "done", "/Users/me/ct-cli")] } ] } ] },
    { name: "ca", running: true, loaded: true, status: "idle", error: null, workspaces: [
      { workspace_id: "w9", label: "ca-trader", number: 1, status: "idle", tabs: [
        { tab_id: "w9:t1", label: "1", number: 1, status: "idle", panes: [pane("p9", "Backtest", "codex", "idle", "/Users/me/ca-trader")] } ] } ] },
  ],
};
const ssh: MachineView = { id: "lan", label: "build-server", kind: "ssh", state: "connected", error: null, version: "0.9.3", status: "idle", sessions: [] };
// Relative to the capture, so the Working line reads about 1m 23s whatever the day.
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const chat: ChatItem[] = [
  { kind: "user", text: "Make the tab bar compact: I want more room for the content." },
  { kind: "assistant_text", markdown: "Measuring the Header and the Open strip.", ts: ago(146) },
  { kind: "tool_call", id: "c1", name: "Bash", input_summary: "grep -n titlebar src/styles.css", input: { command: "grep" }, ts: ago(144) },
  { kind: "tool_result", call_id: "c1", output: "80:  --titlebar: 46px;", is_error: false },
  { kind: "assistant_text", markdown: "One **Top bar** of 46px instead of two bars: the content gains 33px.\n\n| Bar | Height |\n|---|---|\n| Before | 79px |\n| After | 46px |", ts: ago(137) },
  { kind: "user", text: "OK, go ahead", ts: ago(83) },
];

vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  Channel: class { onmessage: (e: unknown) => void = () => {}; },
  invoke: vi.fn(async (cmd: string) => {
    switch (cmd) {
      case "machines_list": return [local, ssh];
      case "chat_locate": return { agent: "claude", path: "/h/s.jsonl", ambiguous: false, candidates: ["/h/s.jsonl"], pending: false };
      case "chat_git_status": return { folder: "drover", path: "/Users/me/drover", branch: "feat/compact-tabs", dirty: true, upstream: null, ahead: 0, behind: 0,
        staged: 0, modified: 2, untracked: 0, changed: 2, changes: [{ code: " M", path: "src/styles.css" }, { code: " M", path: "src/App.tsx" }] };
      // The lane store names the orchestrator that owns lane-docs, so its row shows the Lane toggle.
      case "lanes_list": return [{ lane_id: "docs", herdr_session: "ct", pane_id: "p2", owner: "ct/p1" }];
      case "herdr_call": return {};
      case "files_list_all": return { paths: ["src/App.tsx", "src/styles.css", "CONTEXT.md"], capped: false, refused: false };
      case "files_list_dir": return [{ name: "docs", kind: "dir" }, { name: "src", kind: "dir" }, { name: "CONTEXT.md", kind: "file" }, { name: "package.json", kind: "file" }];
      case "files_changed": return { repo: true, total: 0, changes: [] };
      case "files_watch": return 1;
      default: return [];
    }
  }),
}));
vi.mock("@tauri-apps/api/event", async (orig) => ({ ...(await orig<object>()), listen: vi.fn(async () => () => {}) }));
// A shell's sample output in a real xterm with the app's terminal theme and font, for the README's
// Terminal lens; the lens itself attaches to a live herdr terminal, which a capture has none of.
const SHELL = [
  "\x1b[1;32m~/drover\x1b[0m \x1b[2mfeat/compact-tabs\x1b[0m $ git log --oneline -4",
  "\x1b[33m6e6815c\x1b[0m Merge pull request #75 from cuongtransc/fix/composer-narrow",
  "\x1b[33m80ff029\x1b[0m fix(chat): the Composer fits the smallest window",
  "\x1b[33m5028def\x1b[0m fix(ui): Top bar tabs as 28px outlined pills, not 45px blocks",
  "\x1b[33mabfbef7\x1b[0m feat(ui): one Top bar over the main area, 33px more for the content",
  "\x1b[1;32m~/drover\x1b[0m \x1b[2mfeat/compact-tabs\x1b[0m $ mise run ci",
  "[typecheck] $ tsc --noEmit",
  "[test:frontend]  \x1b[32m✓\x1b[0m src/main/topBar.browser.test.tsx (4 tests) 412ms",
  "[test:frontend]  Test Files  \x1b[1;32m139 passed\x1b[0m (139)",
  "[test:frontend]       Tests  \x1b[1;32m1265 passed\x1b[0m (1265)",
  "[test:backend] test result: \x1b[32mok\x1b[0m. 416 passed; 0 failed",
  "[ci] Finished in 102.4s",
  "\x1b[1;32m~/drover\x1b[0m \x1b[2mfeat/compact-tabs\x1b[0m $ ",
].join("\r\n");
vi.mock("../terminal/TerminalLens", async () => {
  const { useEffect, useRef } = await import("react");
  const { Terminal } = await import("@xterm/xterm");
  await import("@xterm/xterm/css/xterm.css");
  const { FitAddon } = await import("@xterm/addon-fit");
  const { watchTermFont } = await import("../settings/store");
  const { watchTermTheme } = await import("../settings/theme");
  const { TERM_MIN_CONTRAST } = await import("../terminal/theme");
  function TerminalLens() {
    const host = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const term = new Terminal({ allowProposedApi: true, minimumContrastRatio: TERM_MIN_CONTRAST });
      const fit = new FitAddon();
      term.loadAddon(fit);
      const unwatchFont = watchTermFont(term, fit);
      const unwatchTheme = watchTermTheme(term);
      term.open(host.current!);
      fit.fit();
      term.write(SHELL);
      return () => { unwatchFont(); unwatchTheme(); term.dispose(); };
    }, []);
    return <div className="term-lens"><div className="term-host" ref={host} /></div>;
  }
  return { TerminalLens };
});
vi.mock("../chat/chatSession", async (orig) => ({
  ...(await orig<typeof import("../chat/chatSession")>()),
  openChat: (_p: unknown, _path: unknown, ch: { onmessage: (e: unknown) => void }) => {
    setTimeout(() => {
      ch.onmessage({ type: "reset", items: chat, total: chat.length });
      ch.onmessage({ type: "meta", model: "claude-opus-5-5", effort: "high", context_tokens: 84200, queued: ["and rename the Header too"], background: [] });
    }, 0);
    return { opened: Promise.resolve({ agent: "claude", path: "/h/s.jsonl", ambiguous: false, candidates: [], pending: false }), close: () => {} };
  },
}));
const { default: App } = await import("../App");
const { useApp } = await import("../store/app");
const { useLayout, projectKey, setKept } = await import("../sidebar/groups");
const { useFilesPanel } = await import("../files/panelStore");

const settle = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

it("captures the UI map", async () => {
  await page.viewport(W, H);
  document.body.style.margin = "0";
  const root = document.createElement("div");
  root.style.height = `${H}px`;
  document.body.appendChild(root);
  await act(async () => createRoot(root).render(<App />));
  await settle(300);
  await act(async () => {
    const at = (pane_id: string) => ({ machine_id: "local", session: "ct", pane_id });
    useApp.getState().select(at("p1"));
    useApp.getState().view({ machine_id: "local", session: "ct" });
    useApp.getState().pinAgent(at("p2"));
    useApp.getState().pinAgent(at("p1"));
    useApp.setState((s) => ({ expanded: { ...s.expanded, machines: true } }));
    // a closed workspace for Session ct, so the Closed section is on screen
    useLayout.setState((s) => ({ layout: setKept({ ...s.layout, bookmarks: [projectKey("local", "ca", "ca-trader")] }, projectKey("local", "ct", "ct-cli-old"), "/Users/me/ct-cli-old") }));
    // the Files panel starts collapsed: open it, for Go to file and the tree
    useFilesPanel.getState().setCollapsed(false);
  });
  await settle(800);

  const parts = SURFACES.map((s) => {
    const r = document.querySelector(s.selector)?.getBoundingClientRect();
    if (!r || r.width === 0) return { ...s, missing: true as const };
    const rect = { x: r.x, y: r.y, w: r.width, h: r.height };
    const [dx, dy] = s.d ?? [0, 0];
    return { ...s, rect, badge: { x: rect.x + s.at[0] * rect.w + dx, y: rect.y + s.at[1] * rect.h + dy } };
  });
  // a part the App no longer draws, or draws elsewhere, fails the run instead of leaving the map wrong
  expect(parts.filter((p) => "missing" in p).map((p) => `${p.name} (${p.selector})`)).toEqual([]);

  for (const theme of ["light", "dark"]) {
    if (theme === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    await settle(200);
    await page.screenshot({ path: `../../docs/design/assets/ui-map-${theme}.png`, element: root });
  }
  // The README's screenshots, in dark as they always were: the Chat lens as mapped, a shell in the
  // Terminal lens, and the Agent Board.
  const shot = async (name: string) => { await settle(400); await page.screenshot({ path: `../../docs/screenshots/${name}.png`, element: root }); };
  delete document.documentElement.dataset.theme;
  await shot("chat");
  await act(async () => useApp.getState().select({ machine_id: "local", session: "ct", pane_id: "p3" }));
  await shot("terminal");
  await act(async () => {
    useApp.getState().select({ machine_id: "local", session: "ct", pane_id: "p1" });
    useApp.getState().setDashboardOpen(true);
  });
  await shot("dashboard");
  await act(async () => useApp.getState().setDashboardOpen(false));
  await commands.writeFile("docs/design/assets/ui-map.json", JSON.stringify({ captured: new Date().toLocaleDateString("sv"), width: W, height: H, parts }, null, 1) + "\n");
});
