import type { ThreadFilterStore } from "@t3tools/client-runtime/state/thread-filters";
import Storage from "expo-sqlite/kv-store";

/**
 * Where the title-rule hang guard keeps its pass marker. The write must land before the matching
 * starts, so it is synchronous; the key-value store is the one synchronous storage the app has.
 */
export const threadFilterGuardStore: ThreadFilterStore = {
  getItem: (key) => Storage.getItemSync(key),
  setItem: (key, value) => Storage.setItemSync(key, value),
  removeItem: (key) => {
    Storage.removeItemSync(key);
  },
};
