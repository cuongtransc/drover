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
