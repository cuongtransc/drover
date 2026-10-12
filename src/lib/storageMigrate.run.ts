import { migrateStorageKeys } from "./storageMigrate";

// Imported first by main.tsx: the stores read their keys as their modules load.
try {
  migrateStorageKeys(localStorage);
} catch (e) {
  console.error("storage key migration failed", e);
}
