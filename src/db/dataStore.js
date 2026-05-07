// IDB-first data layer.
//
// Reads:  always from IDB (instant, offline-capable).
// Writes: always through to Supabase first; on success, mirror to IDB.
// Sync:   on app load (and on demand) we fetch the user's full library
//         from Supabase and replace IDB's books table.
//
// All UI components consume this module — they should never call
// `supabase.from('books')` directly.

import { supabase } from "../supabaseClient";
import { idb, clearAll } from "./dexie";
import { normalizedKey } from "../lib/normalize";

// ---------- shape conversion ----------

// Supabase row (snake_case) → JS object the UI uses.
export const fromDb = (r) => ({
  id: r.id,
  userId: r.user_id,
  title: r.title,
  author: r.author,
  additionalAuthors: r.additional_authors || [],
  series: r.series,
  seriesNumber: r.series_number,
  notes: r.notes || null,
  openlibraryWorkKey: r.openlibrary_work_key || null,
  seriesKnownTotal: r.series_known_total || null,
  seriesKnownTotalRefreshedAt: r.series_known_total_refreshed_at || null,
  normalizedKey: r.normalized_key,
  createdAt: r.created_at
});

// JS object → Supabase row payload (snake_case) for insert/update.
export const toDb = (b) => ({
  id: b.id,
  user_id: b.userId,
  title: b.title,
  author: b.author,
  additional_authors: b.additionalAuthors && b.additionalAuthors.length ? b.additionalAuthors : null,
  series: b.series || null,
  series_number: b.seriesNumber == null ? null : Number(b.seriesNumber),
  notes: b.notes || null,
  openlibrary_work_key: b.openlibraryWorkKey || null,
  series_known_total: b.seriesKnownTotal == null ? null : Number(b.seriesKnownTotal),
  series_known_total_refreshed_at: b.seriesKnownTotalRefreshedAt || null,
  // normalized_key is auto-set by the DB trigger; we still send it to keep IDB in sync.
  normalized_key: normalizedKey(b.title, b.author),
  created_at: b.createdAt
});

// ---------- sync ----------

let lastSyncedAt = null;

export async function syncFromServer({ force = false } = {}) {
  if (!navigator.onLine) {
    return { ok: false, reason: "offline" };
  }
  // Avoid hammering: skip if we synced in the last 2s unless force=true.
  if (!force && lastSyncedAt && Date.now() - lastSyncedAt < 2000) {
    return { ok: true, skipped: true };
  }
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) return { ok: false, reason: error.message };
  const mapped = (data || []).map(fromDb);
  await idb.transaction("rw", idb.books, async () => {
    await idb.books.clear();
    if (mapped.length) {
      // Dexie wants the raw shape it'll store; we store the mapped JS shape.
      await idb.books.bulkPut(mapped);
    }
  });
  lastSyncedAt = Date.now();
  return { ok: true, count: mapped.length };
}

// ---------- reads ----------

export async function getAllBooks() {
  return idb.books.toArray();
}

export async function findByNormalizedKey(key) {
  return idb.books.where("normalized_key").equals(key).first();
}

// ---------- writes (always go through Supabase first) ----------

function requireOnline() {
  if (!navigator.onLine) {
    const e = new Error("You're offline. Connect and try again.");
    e.code = "offline";
    throw e;
  }
}

export async function addBook(book, userId) {
  requireOnline();
  const payload = toDb({ ...book, userId });
  delete payload.id; // let Supabase assign uuid
  delete payload.created_at;
  const { data, error } = await supabase
    .from("books")
    .insert(payload)
    .select()
    .single();
  if (error) {
    // Postgres unique-violation → tell the caller it's a dup.
    if (error.code === "23505") {
      const e = new Error("You already own this book.");
      e.code = "duplicate";
      throw e;
    }
    throw error;
  }
  const mapped = fromDb(data);
  await idb.books.put(mapped);
  return mapped;
}

export async function bulkAdd(books, userId) {
  requireOnline();
  if (!books.length) return [];
  const payload = books.map(b => {
    const row = toDb({ ...b, userId });
    delete row.id;
    delete row.created_at;
    return row;
  });
  // Insert in chunks of 500.
  const chunkSize = 500;
  const inserted = [];
  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    const { data, error } = await supabase.from("books").insert(chunk).select();
    if (error) throw error;
    inserted.push(...(data || []));
  }
  const mapped = inserted.map(fromDb);
  await idb.books.bulkPut(mapped);
  return mapped;
}

export async function updateBook(id, patch) {
  requireOnline();
  const payload = toDb(patch);
  delete payload.id;
  delete payload.created_at;
  delete payload.user_id;
  const { data, error } = await supabase
    .from("books")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  const mapped = fromDb(data);
  await idb.books.put(mapped);
  return mapped;
}

export async function removeBook(id) {
  requireOnline();
  const existing = await idb.books.get(id);
  const { error } = await supabase.from("books").delete().eq("id", id);
  if (error) throw error;
  await idb.books.delete(id);
  return existing; // so callers can implement undo
}

// Used by undo-after-delete.
export async function restoreBook(book) {
  requireOnline();
  // We re-insert the original row (without id, so Supabase assigns a new one).
  const payload = toDb(book);
  delete payload.id;
  delete payload.created_at;
  const { data, error } = await supabase
    .from("books")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  const mapped = fromDb(data);
  await idb.books.put(mapped);
  return mapped;
}

// Wipe all books for the signed-in user. Used by Settings → "Wipe library".
export async function wipeLibrary(userId) {
  requireOnline();
  const { error } = await supabase.from("books").delete().eq("user_id", userId);
  if (error) throw error;
  await idb.books.clear();
}

// Used by sign-out so the next user (or same user on a different account)
// doesn't see the previous user's library cached.
export async function clearLocal() {
  await clearAll();
}

// ---------- import snapshots (for 10-minute Undo banner) ----------

const SNAPSHOT_TTL_MS = 10 * 60 * 1000;

export async function takeSnapshot(label) {
  const all = await idb.books.toArray();
  const id = await idb.snapshots.add({
    label: label || "import",
    taken_at: Date.now(),
    rows: all
  });
  return id;
}

export async function getActiveSnapshot() {
  const cutoff = Date.now() - SNAPSHOT_TTL_MS;
  // Most-recent first.
  const rows = await idb.snapshots.orderBy("taken_at").reverse().toArray();
  // Drop any that are stale.
  const stale = rows.filter(r => r.taken_at < cutoff);
  if (stale.length) await idb.snapshots.bulkDelete(stale.map(r => r.id));
  return rows.find(r => r.taken_at >= cutoff) || null;
}

export async function clearSnapshots() {
  await idb.snapshots.clear();
}

// Restore from a snapshot: wipe current library, reinsert snapshot rows.
// Done as a server-side delete + bulk insert.
export async function restoreFromSnapshot(snapshotId, userId) {
  requireOnline();
  const snap = await idb.snapshots.get(snapshotId);
  if (!snap) throw new Error("Snapshot expired.");
  // Wipe current.
  await wipeLibrary(userId);
  // Re-insert. We discard the original ids so Supabase assigns new uuids
  // (avoids any conflict if rows got recreated with the same uuid elsewhere).
  if (snap.rows.length) {
    await bulkAdd(snap.rows, userId);
  }
  await idb.snapshots.delete(snapshotId);
}

// Convenience: refresh from server unless we just synced.
export async function ensureFresh() {
  const all = await idb.books.toArray();
  if (!all.length || !lastSyncedAt) return syncFromServer();
  return { ok: true, skipped: true };
}
