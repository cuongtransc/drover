import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { paneKey, type Located, type MachineView, type PaneView } from "../lib/types";
import { useApp } from "../store/app";
import { useLensSettings } from "../settings/lens";
import { forkBlocked, forkFromMessage, forkSession, useForks, watchForkPrune } from "./forkSession";
import { readDraft } from "../chat/drafts";

const orig = { machine_id: "local", session: "default", pane_id: "w1:p1" };
const claude = (status: PaneView["status"], extra: Partial<PaneView> = {}): PaneView =>
  ({ pane_id: "w1:p1", terminal_id: "t1", title: "Port Files panel", cwd: "/srv/app", agent: "claude", status, ...extra }) as PaneView;

const machine = (forkAgent: string | null): MachineView => ({
  id: "local", label: "local", kind: "local", state: "connected", error: null, version: "0.9.3", status: "idle",
  sessions: [{ name: "default", running: true, status: "idle", error: null, workspaces: [
    { workspace_id: "w1", label: "app", number: 1, status: "idle", tabs: [
      { tab_id: "w1:t1", label: "orch-app", number: 1, status: "idle", panes: [claude("idle")] },
      { tab_id: "w1:t9", label: "fork", number: 2, status: "idle", panes: [
        { pane_id: "w1:p9", terminal_id: "t9", title: "zsh", cwd: "/srv/app", agent: forkAgent, status: "idle" } ] },
    ] },
  ] }],
});
const ws = machine(null).sessions[0].workspaces[0];

const located = (over: Partial<Located> = {}): Located => ({ agent: "claude", path: "/h/.claude/projects/x/sid-1.jsonl", ambiguous: false, candidates: [], pending: false, ...over });

describe("forkBlocked", () => {
  it("allows a Claude pane that is idle or done", () => {
    expect(forkBlocked(claude("idle"))).toBeNull();
    expect(forkBlocked(claude("done"))).toBeNull();
  });

  it("says why a busy pane, another agent or a wrapped Claude cannot be forked", () => {
    expect(forkBlocked(claude("working"))).toBe("Busy: a fork now would run its unfinished command again. Fork once it finishes.");
    expect(forkBlocked(claude("blocked"))).toBe("Waiting for an answer: a fork now would run its unfinished command again. Answer it first.");
    expect(forkBlocked(claude("idle", { agent: "pi" }))).toBe("Only Claude sessions can be forked");
    expect(forkBlocked(claude("idle", { untracked: true }))).toBe("Herdr does not track this Claude session");
  });
});

describe("forkSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 9, 16, 5));
    localStorage.clear();
    useForks.setState({ forks: {} });
    useApp.setState({ machines: {}, order: [], selected: null, lensOverride: {}, starting: {} });
    useApp.getState().upsertMachine(machine(null));
  });
  afterEach(() => vi.useRealTimers());

  const deps = (over: { session?: unknown; located?: Located } = {}) => {
    const call = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "agent.get") return { agent: { agent: "claude", agent_session: "session" in over ? over.session : { agent: "claude", kind: "id", value: "sid-1" } } };
      if (method === "tab.create") return { root_pane: { pane_id: "w1:p9" } };
      if (method === "agent.start") {
        useApp.getState().upsertMachine(machine("claude"));
        return {};
      }
      return {};
    });
    const locate = vi.fn(async () => over.located ?? located());
    return { call, locate };
  };

  it("opens a tab beside it running claude on a fork of the session, named after it, and records where it came from", async () => {
    const d = deps();
    await forkSession(orig, ws, claude("idle"), { worktree: false }, d);
    expect(d.locate).toHaveBeenCalledWith(orig);
    expect(d.call).toHaveBeenCalledWith("agent.get", { target: "w1:p1" });
    expect(d.call).toHaveBeenCalledWith("tab.create", { workspace_id: "w1", cwd: "/srv/app", label: "fork", focus: false });
    expect(d.call).toHaveBeenCalledWith("agent.start", expect.objectContaining({
      kind: "claude", pane_id: "w1:p9",
      args: ["--resume", "sid-1", "--fork-session", "--name", "Fork · Port Files panel"],
    }));
    const fork = { machine_id: "local", session: "default", pane_id: "w1:p9" };
    expect(useApp.getState().selected).toEqual(fork);
    expect(useForks.getState().forks[paneKey(fork)]).toEqual({ of: orig, from: "Port Files panel", at: new Date(2026, 9, 9, 16, 5).getTime(), worktree: null, path: "/h/.claude/projects/x/sid-1.jsonl" });
  });

  it("forks into a new worktree named for the time", async () => {
    const d = deps();
    await forkSession(orig, ws, claude("done"), { worktree: true }, d);
    expect(d.call).toHaveBeenCalledWith("agent.start", expect.objectContaining({
      args: ["--resume", "sid-1", "--fork-session", "--name", "Fork · Port Files panel", "--worktree", "fork-20261009-160500"],
    }));
    expect(useForks.getState().forks["local/default/w1:p9"].worktree).toBe("fork-20261009-160500");
  });

  it("refuses before opening anything when the session has no transcript yet, is a guess, or herdr reports no id", async () => {
    for (const [over, msg] of [
      [{ located: located({ pending: true }) }, "Nothing to fork yet: send it a first message"],
      [{ located: located({ ambiguous: true }) }, "Herdr is not sure which session this pane runs, so it cannot fork it"],
      [{ session: null }, "Herdr has not reported this pane's session yet"],
    ] as const) {
      const d = deps(over);
      await expect(forkSession(orig, ws, claude("idle"), { worktree: false }, d)).rejects.toThrow(msg);
      expect(d.call).not.toHaveBeenCalledWith("tab.create", expect.anything());
    }
  });

  it("opens the fork on Chat, where its banner is, even when new agents open on the Terminal", async () => {
    useLensSettings.setState({ newAgentLens: "terminal" });
    await forkSession(orig, ws, claude("idle"), { worktree: false }, deps());
    expect(useApp.getState().lensOverride["local/default/w1:p9"]).toBe("chat");
    useLensSettings.setState({ newAgentLens: "terminal" });
  });

  it("names a fork of an untitled pane plainly", async () => {
    const d = deps();
    await forkSession(orig, ws, claude("idle", { title: "  " }), { worktree: false }, d);
    expect(d.call).toHaveBeenCalledWith("agent.start", expect.objectContaining({ args: ["--resume", "sid-1", "--fork-session", "--name", "Fork"] }));
  });

  it("forgets the fork record when claude does not start, leaving the tab to show why", async () => {
    const d = deps();
    d.call.mockImplementation(async (method: string) => {
      if (method === "agent.get") return { agent: { agent: "claude", agent_session: { kind: "id", value: "sid-1" } } };
      if (method === "tab.create") return { root_pane: { pane_id: "w1:p9" } };
      if (method === "agent.start") throw { code: "herdr_error", message: "timed out waiting for agent startup" };
      return {};
    });
    await expect(forkSession(orig, ws, claude("idle"), { worktree: false }, d)).rejects.toBeTruthy();
    expect(useForks.getState().forks).toEqual({});
    expect(JSON.parse(localStorage.getItem("herdr-app:forks") ?? "{}")).toEqual({});
  });

  it("checks the pane again after asking herdr: one that started working meanwhile is not forked", async () => {
    const d = deps();
    const base = d.call.getMockImplementation()!;
    d.call.mockImplementation(async (method: string, params: unknown) => {
      if (method === "agent.get") {
        const m = machine(null);
        m.sessions[0].workspaces[0].tabs[0].panes[0].status = "working";
        useApp.getState().upsertMachine(m);
      }
      return base(method, params);
    });
    await expect(forkSession(orig, ws, claude("idle"), { worktree: false }, d)).rejects.toThrow(/^Busy/);
    expect(d.call).not.toHaveBeenCalledWith("tab.create", expect.anything());
  });

  it("refuses a busy pane even when asked directly", async () => {
    const d = deps();
    await expect(forkSession(orig, ws, claude("working"), { worktree: false }, d)).rejects.toThrow(/^Busy/);
    expect(d.call).not.toHaveBeenCalled();
  });
});

describe("watchForkPrune", () => {
  it("forgets the fork record of a pane gone from its running session", () => {
    useApp.setState({ machines: {} });
    const stale = { of: orig, from: "x", at: 1, worktree: null };
    useForks.setState({ forks: { "local/default/w1:p9": stale, "local/default/w1:p1": stale } });
    const stop = watchForkPrune();
    useApp.getState().upsertMachine(machine(null));
    expect(Object.keys(useForks.getState().forks)).toEqual(["local/default/w1:p9", "local/default/w1:p1"]);
    const gone = machine(null);
    gone.sessions[0].workspaces[0].tabs.pop();
    useApp.getState().upsertMachine(gone);
    expect(Object.keys(useForks.getState().forks)).toEqual(["local/default/w1:p1"]);
    stop();
  });
});

describe("forkFromMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 10, 9, 0));
    localStorage.clear();
    useForks.setState({ forks: {} });
    useApp.setState({ machines: {}, order: [], selected: null, lensOverride: {}, starting: {} });
    useApp.getState().upsertMachine(machine(null));
  });
  afterEach(() => vi.useRealTimers());

  const message = { id: "u4", text: "try it with a smaller batch", ts: "2026-10-10T01:30:00.000Z" };
  const deps = (over: { located?: Located; cut?: { id: string | null; path: string | null; cwd: string | null } } = {}) => {
    const call = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "tab.create") return { root_pane: { pane_id: "w1:p9" } };
      if (method === "agent.start") {
        useApp.getState().upsertMachine(machine("claude"));
        return {};
      }
      return {};
    });
    const locate = vi.fn(async () => over.located ?? located());
    const cut = vi.fn(async () => over.cut ?? { id: "cut-1", path: "/h/.claude/projects/x/cut-1.jsonl", cwd: "/srv/app/sub" });
    return { call, locate, cut };
  };

  it("cuts the transcript before the message and opens claude on the copy, with the message waiting in its Composer", async () => {
    const d = deps();
    await forkFromMessage(orig, ws, claude("idle"), message, d);
    expect(d.cut).toHaveBeenCalledWith("/h/.claude/projects/x/sid-1.jsonl", "u4");
    expect(d.call).toHaveBeenCalledWith("tab.create", { workspace_id: "w1", cwd: "/srv/app/sub", label: "fork", focus: false });
    expect(d.call).toHaveBeenCalledWith("agent.start", expect.objectContaining({
      kind: "claude", pane_id: "w1:p9", args: ["--resume", "cut-1", "--name", "Fork · Port Files panel"],
    }));
    const fork = { machine_id: "local", session: "default", pane_id: "w1:p9" };
    expect(readDraft(paneKey(fork))).toBe("try it with a smaller batch");
    expect(useApp.getState().selected).toEqual(fork);
    expect(useApp.getState().lensOverride[paneKey(fork)]).toBe("chat");
    expect(useForks.getState().forks[paneKey(fork)]).toEqual({ of: orig, from: "Port Files panel", at: Date.parse(message.ts), worktree: null });
  });

  it("works while the original is busy: the cut ends before a message, never inside a tool call", async () => {
    const d = deps();
    await forkFromMessage(orig, ws, claude("working"), message, d);
    expect(d.call).toHaveBeenCalledWith("agent.start", expect.anything());
  });

  it("refuses the first message, which has nothing before it, without opening a tab", async () => {
    const d = deps({ cut: { id: null, path: null, cwd: null } });
    await expect(forkFromMessage(orig, ws, claude("idle"), message, d)).rejects.toThrow("Nothing comes before the first message to fork from");
    expect(d.call).not.toHaveBeenCalledWith("tab.create", expect.anything());
  });

  it("refuses another agent, a wrapped Claude, and a transcript that is missing or a guess", async () => {
    await expect(forkFromMessage(orig, ws, claude("idle", { agent: "pi" }), message, deps())).rejects.toThrow("Only Claude sessions can be forked");
    await expect(forkFromMessage(orig, ws, claude("idle", { untracked: true }), message, deps())).rejects.toThrow("Herdr does not track this Claude session");
    for (const over of [{ pending: true }, { ambiguous: true }]) {
      const d = deps({ located: located(over) });
      await expect(forkFromMessage(orig, ws, claude("idle"), message, d)).rejects.toThrow();
      expect(d.cut).not.toHaveBeenCalled();
    }
  });

  it("forgets the fork record when claude does not start", async () => {
    const d = deps();
    d.call.mockImplementation(async (method: string) => {
      if (method === "tab.create") return { root_pane: { pane_id: "w1:p9" } };
      if (method === "agent.start") throw { code: "herdr_error", message: "timed out" };
      return {};
    });
    await expect(forkFromMessage(orig, ws, claude("idle"), message, d)).rejects.toBeTruthy();
    expect(useForks.getState().forks).toEqual({});
  });
});
