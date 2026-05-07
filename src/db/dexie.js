// Local mirror of the user's `books` rows.
// Reads happen here; writes are write-through (Supabase first, then put here).
//
// We key by Supabase `id` (uuid). `normalized_key` is indexed for fast dedup
// checks at add-time.

import Dexie from "dexie";

export const idb = new Dexie("mylibrary");

idb.version(1).stores({
  // Primary key id; secondary indexes used for filtering/lookup.
  books: "id, normalized_key, author, series, user_id",
  // Snapshots taken before an import — used to power the 10-min Undo banner.
  snapshots: "++id, taken_at"
});

// Wipe the local mirror. Called on sign-out so the next user doesn't see
// the previous user's books cached in IDB.
export async function clearAll() {
  await idb.books.clear();
  await idb.snapshots.clear();
}
