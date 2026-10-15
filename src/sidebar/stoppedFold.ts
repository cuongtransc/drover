import type { RNode, RSession, SessionKey } from "./groups";

/** A Session herdr reports stopped. One on a machine that is not connected is unknown, not stopped. */
export const isStopped = (n: RNode): n is RSession => n.kind === "session" && n.machine.state === "connected" && !n.session.running;

/** One level of the Sessions tree with its stopped Sessions at the end: two or more go to `folded`, for
 *  one "N stopped" row; a lone one stays a row of its own, last. The viewed Session stays in its place,
 *  so stopping it does not move it from under the user. */
export function foldStopped(nodes: RNode[], viewed: SessionKey | null): { nodes: RNode[]; folded: RSession[] } {
  const stopped = nodes.filter((n): n is RSession => isStopped(n) && n.key !== viewed);
  if (stopped.length === 0) return { nodes, folded: [] };
  const rest = nodes.filter((n) => !stopped.includes(n as RSession));
  return stopped.length === 1 ? { nodes: [...rest, stopped[0]], folded: [] } : { nodes: rest, folded: stopped };
}
