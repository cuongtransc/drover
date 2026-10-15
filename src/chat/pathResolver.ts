import { createContext } from "react";
import { filesFirstFiles } from "../lib/ipc";
import type { ChatItem } from "../lib/types";
import { pathCandidates, pathHints, type PathHint } from "./pathHints";

/** Where a path is: the file found, null when no place has it, undefined when the machine cannot say. */
export type Found = string | null | undefined;

/** The most places one click tries for a path, and one call for a screen (`files::first::MAX_PLACES`). */
const PER_PATH = 64;
const PER_CALL = 1024;
/** How long paths named by rows mounting together wait to go in one call. */
const WAIT_MS = 30;

/**
 * Where the paths a Chat names are, asked of its machine: the rows on screen together in one call
 * (the list is virtual, so a row mounts as it shows), each answer kept for its message.
 */
export interface PathResolver {
  resolve(item: ChatItem | null, path: string, ctx: { root: string | null; home: string | null }): Promise<Found>;
  /** The answer already in, or "pending". */
  known(item: ChatItem | null, path: string): Found | "pending";
}

type Ask = (machineId: string, groups: string[][]) => Promise<(string | null)[]>;

export function pathResolver(
  machineId: string,
  items: () => readonly ChatItem[],
  // Looked up when asking, so a Chat that names no path never touches it.
  ask: Ask = (m, groups) => filesFirstFiles(m, groups),
): PathResolver {
  // The hints of the whole Chat, made again only when its items change.
  let hintsOf: { items: readonly ChatItem[]; hints: PathHint[] } | null = null;
  const hints = (all: readonly ChatItem[]) => {
    if (hintsOf?.items !== all) hintsOf = { items: all, hints: pathHints(all) };
    return hintsOf.hints;
  };
  const NONE = {} as ChatItem; // the key for a path outside any held item
  const asked = new WeakMap<ChatItem, Map<string, Promise<Found>>>();
  const answers = new WeakMap<ChatItem, Map<string, Found>>();
  let queue: { places: string[]; done: (f: Found) => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const all = queue;
    queue = [];
    while (all.length) {
      const batch: typeof all = [];
      let size = 0;
      while (all.length && (batch.length === 0 || size + all[0].places.length <= PER_CALL)) {
        size += all[0].places.length;
        batch.push(all.shift()!);
      }
      ask(machineId, batch.map((q) => q.places)).then(
        (found) => batch.forEach((q, i) => q.done(found[i] ?? null)),
        () => batch.forEach((q) => q.done(undefined)),
      );
    }
  };

  const placesOf = (item: ChatItem | null, path: string, ctx: { root: string | null; home: string | null }): string[] | null => {
    if (path.startsWith("/")) return [path];
    if (path.startsWith("~/")) return ctx.home ? [ctx.home.replace(/\/$/, "") + path.slice(1)] : null;
    const all = items();
    const at = item ? all.indexOf(item) : -1;
    return pathCandidates(path, hints(all), at < 0 ? all.length : at, ctx, PER_PATH);
  };

  return {
    resolve(item, path, ctx) {
      const key = item ?? NONE;
      let mine = asked.get(key);
      if (!mine) asked.set(key, (mine = new Map()));
      const had = mine.get(path);
      if (had) return had;
      const places = placesOf(item, path, ctx);
      if (!places?.length) return Promise.resolve(undefined);
      const p = new Promise<Found>((resolve) => {
        queue.push({
          places,
          done: (f) => {
            // The machine could not say: forget the question, so the next row asks again.
            if (f === undefined) mine.delete(path);
            else {
              let got = answers.get(key);
              if (!got) answers.set(key, (got = new Map()));
              got.set(path, f);
            }
            resolve(f);
          },
        });
        timer ??= setTimeout(flush, WAIT_MS);
      });
      mine.set(path, p);
      return p;
    },
    known(item, path) {
      const got = answers.get(item ?? NONE);
      return got?.has(path) ? got.get(path) : "pending";
    },
  };
}

/** The Chat's resolver; none outside a Chat lens, where a path links as written. */
export const ChatPathsContext = createContext<PathResolver | null>(null);
/** The item a path is written in, so only the tool calls before it say where it is. */
export const ChatItemContext = createContext<ChatItem | null>(null);
