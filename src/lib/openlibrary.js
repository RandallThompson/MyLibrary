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

// =====================================================================
// Edition-level lookup for physical dimensions.
// OpenLibrary's "Books API" returns publisher metadata including
// physical_dimensions when present. Try by title+author as a proxy for the
// edition; if no luck we fall through.
// Docs: https://openlibrary.org/dev/docs/api/books
//
// Returns: { coverUrl, pageCount, binding, heightCm, spineThicknessCm } or null
// =====================================================================

const NUM = /([0-9]+(?:\.[0-9]+)?)/;

function parseDimString(s) {
  if (!s) return null;
  const lower = String(s).toLowerCase();
  const m = lower.match(NUM);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  if (lower.includes("inch") || lower.includes("in")) return Math.round(n * 2.54 * 10) / 10;
  return Math.round(n * 10) / 10;
}

// Try to fetch edition metadata from OpenLibrary for a title+author pair.
// OL doesn't have a "search by title+author and return edition" endpoint;
// the closest is /search.json which returns work-level results. We then look
// at the first work's `edition_key` and fetch /books/{key}.json which has
// physical_format + physical_dimensions + number_of_pages.
export async function fetchOpenLibraryEdition({ title, author }) {
  if (!title) return null;
  try {
    const q = `title:"${title}"${author ? `+author:"${author}"` : ""}`;
    const searchUrl = `${SEARCH_URL}?q=${encodeURIComponent(q)}&fields=edition_key,cover_i&limit=1`;
    const r = await fetch(searchUrl);
    if (!r.ok) return null;
    const j = await r.json();
    const doc = (j.docs || [])[0];
    if (!doc) return null;

    let coverUrl = null;
    if (doc.cover_i) coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;

    const editionKey = (doc.edition_key || [])[0];
    if (!editionKey) return coverUrl ? { coverUrl } : null;

    const eUrl = `https://openlibrary.org/books/${editionKey}.json`;
    const er = await fetch(eUrl);
    if (!er.ok) return coverUrl ? { coverUrl } : null;
    const ed = await er.json();

    // physical_dimensions like "8.4 x 5.4 x 1 inches" or "21 x 14 x 3 centimeters".
    // We treat the largest as height, smallest as thickness.
    let heightCm = null, spineThicknessCm = null;
    if (ed.physical_dimensions) {
      const parts = String(ed.physical_dimensions).split(/x|×/i).map(p => parseDimString(p.trim())).filter(Boolean);
      if (parts.length >= 3) {
        parts.sort((a, b) => b - a);
        heightCm = parts[0];        // tallest
        spineThicknessCm = parts[2]; // smallest = thickness
      } else if (parts.length === 2) {
        parts.sort((a, b) => b - a);
        heightCm = parts[0];
      } else if (parts.length === 1) {
        heightCm = parts[0];
      }
    }

    let binding = null;
    const fmt = (ed.physical_format || "").toLowerCase();
    if (fmt.includes("hard")) binding = "hardcover";
    else if (fmt.includes("paper") || fmt.includes("soft")) binding = "paperback";
    else if (fmt.includes("mass")) binding = "paperback"; // close enough

    return {
      coverUrl,
      pageCount: ed.number_of_pages || null,
      binding,
      heightCm,
      spineThicknessCm
    };
  } catch {
    return null;
  }
}
