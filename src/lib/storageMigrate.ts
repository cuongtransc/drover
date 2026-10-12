const OLD = "herdr-app:";
const NEW = "drover:";

/** Moves the keys Herdr wrote (`herdr-app:…`) to Drover's (`drover:…`); a Drover key already
 *  there wins. Returns how many were copied. */
export function migrateStorageKeys(storage: Storage): number {
  const old: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(OLD)) old.push(key);
  }
  let copied = 0;
  for (const key of old) {
    const to = NEW + key.slice(OLD.length);
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(to) === null) {
      storage.setItem(to, value);
      copied++;
    }
    storage.removeItem(key);
  }
  return copied;
}
