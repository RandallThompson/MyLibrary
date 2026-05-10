// Library prep job — fetch metadata for every book that doesn't have it yet.
//
// Strategy:
//   - Run on the client (no Edge Function required for the heavy work).
//   - Process books in chunks of CHUNK_SIZE in parallel.
//   - For each book: Google Books → OpenLibrary → page-count estimate → defaults.
//   - Color extraction happens client-side (downsample + k-means) when the
//     designer first renders a book — not here, to keep prep fast.
//   - Persist progress to the prep_jobs row so leaving and coming back resumes.
//   - When complete, ask the Edge Function to send a "your library is ready"
//     email and mark email_sent on the row.

import { supabase } from "../supabaseClient";
import { fetchGoogleBooksMetadata } from "./googleBooks";
import { searchBooks as olSearch } from "./openlibrary";
import { estimateHeightCm, estimateSpineThicknessCm } from "./dimensions";

const CHUNK_SIZE = 6;       // parallel fetches per chunk; APIs are tolerant
const SLEEP_BETWEEN_CHUNKS_MS = 100;

// Returns metadata for a single book by trying APIs in order.
async function fetchBookMetadata(title, author) {
  let g = await fetchGoogleBooksMetadata(title, author);
  if (g && (g.coverUrl || g.pageCount)) {
    return finalize(g);
  }
  // OpenLibrary fallback: it returns title/author/series for a search result;
  // we use it primarily for the cover URL via the covers.openlibrary.org pattern.
  const ol = await olSearch(`${title} ${author || ""}`).catch(() => []);
  const olHit = ol[0];
  let coverUrl = null;
  if (olHit && olHit.workKey) {
    // Cover image URL pattern: https://covers.openlibrary.org/b/olid/<workKey>-L.jpg
    // Work-level covers exist via /b/id/{cover_id}-L.jpg but the search API doesn't
    // give us cover_id reliably. Skip in favor of just no-cover.
  }
  return finalize({ coverUrl, pageCount: null, binding: null, heightCm: null, spineThicknessCm: null });
}

function finalize(m) {
  const binding = m.binding || "paperback";
  return {
    coverUrl: m.coverUrl || null,
    pageCount: m.pageCount || null,
    binding,
    heightCm: m.heightCm || estimateHeightCm({ binding }),
    spineThicknessCm: m.spineThicknessCm || estimateSpineThicknessCm({ pageCount: m.pageCount, binding })
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Idempotent: if a prep job is already running for this user, returns it.
// Otherwise creates a new one. The caller drives the job.
export async function getOrStartPrepJob(userId) {
  const { data: existing } = await supabase
    .from("prep_jobs")
    .select("*")
    .eq("user_id", userId)
    .in("status", ["pending", "running"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;

  // Count books needing metadata.
  const { data: books } = await supabase
    .from("books")
    .select("id")
    .is("metadata_fetched_at", null);
  const total = (books || []).length;

  const { data: created, error } = await supabase
    .from("prep_jobs")
    .insert({ user_id: userId, status: "pending", total_books: total, done_books: 0 })
    .select()
    .single();
  if (error) throw error;
  return created;
}

// Run the prep job to completion (or until aborted).
// onProgress(done, total) is called after each chunk.
export async function runPrepJob(jobId, userId, { onProgress, signal } = {}) {
  await supabase.from("prep_jobs").update({ status: "running" }).eq("id", jobId);

  // Pull books that still need metadata.
  let { data: pending } = await supabase
    .from("books")
    .select("id, title, author")
    .is("metadata_fetched_at", null);
  pending = pending || [];

  let done = 0;
  const total = pending.length;
  await supabase.from("prep_jobs").update({ total_books: total }).eq("id", jobId);

  for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
    if (signal?.aborted) {
      await supabase.from("prep_jobs").update({ status: "pending" }).eq("id", jobId);
      return { aborted: true };
    }
    const chunk = pending.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(
      chunk.map(async (b) => {
        try {
          const meta = await fetchBookMetadata(b.title, b.author);
          return { id: b.id, meta };
        } catch {
          return { id: b.id, meta: finalize({}) };
        }
      })
    );
    // Persist updates one by one (Supabase JS doesn't have bulk-update by id).
    for (const r of results) {
      await supabase
        .from("books")
        .update({
          cover_url: r.meta.coverUrl,
          page_count: r.meta.pageCount,
          binding: r.meta.binding,
          height_cm: r.meta.heightCm,
          spine_thickness_cm: r.meta.spineThicknessCm,
          metadata_fetched_at: new Date().toISOString()
        })
        .eq("id", r.id);
    }
    done += results.length;
    await supabase.from("prep_jobs").update({ done_books: done }).eq("id", jobId);
    if (onProgress) onProgress(done, total);
    await sleep(SLEEP_BETWEEN_CHUNKS_MS);
  }

  // Mark complete + trigger email.
  await supabase
    .from("prep_jobs")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("id", jobId);

  // Fire the email Edge Function. Best-effort: we don't fail the job if it errors.
  try {
    await supabase.functions.invoke("library-ready-email", {
      body: { jobId }
    });
  } catch (e) {
    console.error("email function failed", e);
  }

  return { done, total };
}
