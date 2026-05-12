// Library prep job — fetch metadata for every book that doesn't have it yet.

import { supabase } from "../supabaseClient";
import { fetchGoogleBooksMetadata } from "./googleBooks";
import { searchBooks as olSearch, fetchOpenLibraryEdition } from "./openlibrary";


const CHUNK_SIZE = 6;
const SLEEP_BETWEEN_CHUNKS_MS = 100;

async function fetchBookMetadata(title, author) {
  const [g, ol] = await Promise.all([
    fetchGoogleBooksMetadata(title, author).catch(() => null),
    fetchOpenLibraryEdition({ title, author }).catch(() => null)
  ]);

  const merged = {
    coverUrl: pick(g && g.coverUrl, ol && ol.coverUrl),
    pageCount: pick(g && g.pageCount, ol && ol.pageCount),
    binding: pick(g && g.binding, ol && ol.binding),
    heightCm: pick(ol && ol.heightCm, g && g.heightCm),
    spineThicknessCm: pick(ol && ol.spineThicknessCm, g && g.spineThicknessCm)
  };

  if (!merged.coverUrl) {
    const search = await olSearch(`${title} ${author || ""}`).catch(() => []);
    const olHit = (search || [])[0];
    if (olHit && olHit.workKey) {
      merged.coverUrl = `https://covers.openlibrary.org/b/olid/${olHit.workKey.replace(/^\/works\//, "")}-L.jpg`;
    }
  }
  return finalize(merged);
}

function pick(...vals) {
  for (const v of vals) {
    if (v != null && v !== "") return v;
  }
  return null;
}

function finalize(m) {
  return {
    coverUrl: m.coverUrl || null,
    pageCount: m.pageCount || null,
    binding: m.binding || null,
    // Real numbers only. Null when both APIs returned nothing — book will
    // show as "unmeasured" until the photo measurer fills it in.
    heightCm: m.heightCm || null,
    spineThicknessCm: m.spineThicknessCm || null
  };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function getOrStartPrepJob(userId) {
  const { data: existing } = await supabase
    .from("prep_jobs").select("*").eq("user_id", userId)
    .in("status", ["pending", "running"])
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) return existing;

  const { data: books } = await supabase
    .from("books").select("id").is("metadata_fetched_at", null);
  const total = (books || []).length;

  const { data: created, error } = await supabase
    .from("prep_jobs")
    .insert({ user_id: userId, status: "pending", total_books: total, done_books: 0 })
    .select().single();
  if (error) throw error;
  return created;
}

export async function runPrepJob(jobId, userId, { onProgress, signal } = {}) {
  await supabase.from("prep_jobs").update({ status: "running" }).eq("id", jobId);

  let { data: pending } = await supabase
    .from("books").select("id, title, author").is("metadata_fetched_at", null);
  pending = pending || [];

  let done = 0;
  const total = pending.length;
  await supabase.from("prep_jobs").update({ total_books: total }).eq("id", jobId);

  for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
    if (signal && signal.aborted) {
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
    for (const r of results) {
      await supabase.from("books").update({
        cover_url: r.meta.coverUrl,
        page_count: r.meta.pageCount,
        binding: r.meta.binding,
        height_cm: r.meta.heightCm,
        spine_thickness_cm: r.meta.spineThicknessCm,
        metadata_fetched_at: new Date().toISOString()
      }).eq("id", r.id);
    }
    done += results.length;
    await supabase.from("prep_jobs").update({ done_books: done }).eq("id", jobId);
    if (onProgress) onProgress(done, total);
    await sleep(SLEEP_BETWEEN_CHUNKS_MS);
  }

  await supabase.from("prep_jobs")
    .update({ status: "complete", completed_at: new Date().toISOString() })
    .eq("id", jobId);

  try {
    await supabase.functions.invoke("library-ready-email", { body: { jobId } });
  } catch (e) {
    console.error("email function failed", e);
  }
  return { done, total };
}
