import { useState } from "react";
import { useSecondClock } from "../dashboard/QuotaColumn";
import type { BackgroundTask } from "../lib/types";
import { formatWorkDuration } from "./workBlocks";

// Shells, Monitors, sub-Agents and Workflows Claude started in the background and has not finished: they outlive the
// turn, so they sit above the Composer until their end lands in the transcript. Folded to one
// line by default, as Claude Code's status line says "3 shells": the list opens on a click.
export function BackgroundTasks({ tasks, onJump }: { tasks: BackgroundTask[]; onJump: (callId: string) => void }) {
  if (tasks.length === 0) return null;
  return <Strip tasks={tasks} onJump={onJump} />;
}

const KIND: Record<BackgroundTask["kind"], string> = { bash: "Shell", agent: "Agent", monitor: "Monitor", workflow: "Workflow" };

/** "2 shells · 1 agent": only the kinds running. A Monitor counts as a shell, as Claude Code's does;
 *  a Workflow, which runs agents, as an agent. */
function counts(tasks: BackgroundTask[]): string {
  const agents = tasks.filter((t) => t.kind === "agent" || t.kind === "workflow").length;
  const shells = tasks.length - agents;
  const parts: string[] = [];
  if (shells > 0) parts.push(`${shells} shell${shells === 1 ? "" : "s"}`);
  if (agents > 0) parts.push(`${agents} agent${agents === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** Split out so the second clock ticks, and the open state lives, only while there are tasks. */
function Strip({ tasks, onJump }: { tasks: BackgroundTask[]; onJump: (callId: string) => void }) {
  const [open, setOpen] = useState(false);
  const now = new Date(useSecondClock()).toISOString();
  let oldest: string | null = null;
  for (const t of tasks) {
    if (t.started && (oldest === null || t.started < oldest)) oldest = t.started;
  }
  return (
    <div className="chat-background">
      <button type="button" className="chat-background-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="spin" aria-hidden="true" />
        <span className="chat-background-count">
          {counts(tasks)} in background<span className="chat-background-chev" aria-hidden="true">›</span>
        </span>
        <span className="chat-background-time">{formatWorkDuration(oldest, now)}</span>
      </button>
      {open && (
        <ul role="list" aria-label="Background tasks">
          {tasks.map((t) => (
            <li key={t.call_id}>
              <button type="button" className="chat-background-row" onClick={() => onJump(t.call_id)}>
                <span aria-hidden="true" />
                <span className="chat-background-kind">{KIND[t.kind]}</span>
                <span className="chat-background-desc">{t.description}</span>
                <span className="chat-background-time">
                  {t.waiting ? "waiting · " : ""}
                  {formatWorkDuration(t.started, now)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
