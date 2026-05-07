// Identity normalization for ownership dedup.
// Must match the SQL function `public.mylib_normalize` in supabase/migrations/002_v2_schema.sql.

const SERIES_SUFFIX = /\s*\([^()]+,\s*#\d+(?:\.\d+)?\)\s*$/;

export function normalize(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(SERIES_SUFFIX, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizedKey(title, author) {
  return `${normalize(title)}|${normalize(author)}`;
}

// Strip a "(Series, #N)" suffix from a title; returns { title, series, seriesNumber }.
export function parseTitleSuffix(raw) {
  const m = (raw || "").match(/^(.+?)\s*\((.+?),\s*#(\d+(?:\.\d+)?)\)\s*$/);
  if (m) {
    return {
      title: m[1].trim(),
      series: m[2].trim(),
      seriesNumber: parseFloat(m[3])
    };
  }
  return { title: (raw || "").trim(), series: null, seriesNumber: null };
}
