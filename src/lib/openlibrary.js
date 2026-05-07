// Thin wrapper around OpenLibrary's public API.
// No API key required. All calls return null/[] on failure rather than throwing —
// the v2 add-flow and series-intelligence are best-effort.

const SEARCH_URL = "https://openlibrary.org/search.json";
const WORK_URL = "https://openlibrary.org/works";

// Title-search for the Add modal autocomplete.
//   query: free-text, min 3 chars enforced by caller
//   signal: AbortSignal (for cancellation when the user keeps typing)
// Returns: [{ title, author, series, seriesNumber, workKey }]
export async function searchBooks(query, { signal } = {}) {
  if (!query || query.trim().length < 3) return [];
  const url = `${SEARCH_URL}?q=${encodeURIComponent(query.trim())}` +
              `&fields=title,author_name,key,series&limit=8`;
  try {
    const r = await fetch(url, { signal });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.docs || []).map(d => {
      // OpenLibrary's "series" field is patchy: sometimes "Foo Series, #2",
      // sometimes just "Foo Series", sometimes missing entirely.
      let series = null, seriesNumber = null;
      if (Array.isArray(d.series) && d.series.length) {
        const raw = String(d.series[0]);
        const m = raw.match(/^(.+?)(?:[,;]?\s*#?(\d+(?:\.\d+)?)\s*)?$/);
        if (m) {
          series = m[1].trim().replace(/[,;]\s*$/, "");
          if (m[2]) seriesNumber = parseFloat(m[2]);
        } else {
          series = raw;
        }
      }
      return {
        title: d.title || "",
        author: (d.author_name && d.author_name[0]) || "",
        series,
        seriesNumber,
        workKey: d.key || null // e.g. "/works/OL12345W"
      };
    });
  } catch {
    return [];
  }
}

// Best-effort series total. We try the work page first, then the series subject page.
// Returns: int (count) or null if we genuinely couldn't determine it.
//
// OpenLibrary's series metadata is messy. A pragmatic strategy:
//   1) If we have a work key, fetch the work and look for `series` on it.
//   2) Hit /search.json?q=series:"<name>"&limit=200 and count distinct works.
//      Filter to works whose author overlaps the input author.
//
// This is a heuristic and will sometimes be wrong. Caller should display a
// "Refresh" button so the user can manually retry, and never overwrite a
// number the user typed by hand.
export async function lookupSeriesTotal({ author, series, workKey } = {}) {
  if (!series) return null;
  // Strategy: search by series name and count author-matching results.
  try {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(`series:"${series}"`)}` +
                `&fields=key,title,author_name,series&limit=100`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const docs = j.docs || [];
    if (!docs.length) return null;

    // Count distinct works whose author_name overlaps with our author (case-insensitive)
    // AND whose first series entry contains our series name.
    const norm = (s) => (s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const wantAuthor = norm(author);
    const wantSeries = norm(series);
    const seenKeys = new Set();
    let count = 0;
    for (const d of docs) {
      const k = d.key;
      if (!k || seenKeys.has(k)) continue;
      const ds = Array.isArray(d.series) ? norm(d.series[0]) : "";
      if (!ds.includes(wantSeries)) continue;
      const matchesAuthor = !wantAuthor || (d.author_name || []).some(a => norm(a).includes(wantAuthor));
      if (!matchesAuthor) continue;
      seenKeys.add(k);
      count++;
    }
    return count > 0 ? count : null;
  } catch {
    return null;
  }
}

// Fetch a single work's metadata. Currently only used to (best-effort) refresh
// the openlibrary_work_key resolution after a user edits a row.
export async function fetchWork(workKey) {
  if (!workKey) return null;
  try {
    const url = `${WORK_URL}/${workKey.replace(/^\/works\//, "")}.json`;
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
