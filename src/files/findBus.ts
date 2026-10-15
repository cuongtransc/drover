/** What Edit's Find…, Find Next and Find Previous ask of the open file (the menu takes ⌘F/⌘G, ADR 0010). */
export type FindRequest = "open" | "next" | "prev";

const FIND_EVENT = "drover:find";

export function requestFind(what: FindRequest): void {
  window.dispatchEvent(new CustomEvent<FindRequest>(FIND_EVENT, { detail: what }));
}

/** Calls `cb` on each request; returns the unsubscribe. */
export function onFindRequest(cb: (what: FindRequest) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<FindRequest>).detail);
  window.addEventListener(FIND_EVENT, h);
  return () => window.removeEventListener(FIND_EVENT, h);
}
