/** Where a pane's Chat was scrolled when it was left: the first row on screen (by row key), how far
 *  the view's top was below that row's top, and the transcript's length then. No entry: it was at the
 *  end. In memory only. */
export interface ChatPlace {
  row: string;
  offset: number;
  total: number;
}

const places = new Map<string, ChatPlace>();

export const placeOf = (paneKey: string): ChatPlace | undefined => places.get(paneKey);

export function keepPlace(paneKey: string, place: ChatPlace | null): void {
  if (place) places.set(paneKey, place);
  else places.delete(paneKey);
}

/** The Work blocks the user opened or closed in a pane's Chat, by block id; kept with its place, since
 *  an opened block above the place moves it. */
const chosen = new Map<string, ReadonlyMap<string, boolean>>();

export const chosenOf = (paneKey: string): ReadonlyMap<string, boolean> => chosen.get(paneKey) ?? new Map();

/** Forgets every pane's place and Work blocks (tests: they outlive one test's ChatLens). */
export function forgetChatMemory(): void {
  places.clear();
  chosen.clear();
}

export function keepChosen(paneKey: string, open: ReadonlyMap<string, boolean>): void {
  if (open.size > 0) chosen.set(paneKey, open);
  else chosen.delete(paneKey);
}
