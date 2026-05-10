// Google Books API client. No API key required for the volumes:search endpoint.
// Returns the first plausible match for a (title, author) pair.

const BASE = "https://www.googleapis.com/books/v1/volumes";

// ?q=intitle:...+inauthor:... — both terms biases toward exact matches.
function buildQuery(title, author) {
  const t = `intitle:"${(title || "").replace(/"/g, "")}"`;
  const a = author ? `+inauthor:"${author.replace(/"/g, "")}"` : "";
  return `${t}${a}`;
}

// Returns:
// {
//   coverUrl: string|null,
//   pageCount: number|null,
//   binding: 'paperback'|'hardcover'|null,
//   heightCm: number|null,
//   spineThicknessCm: number|null
// }
// or null if no usable result.
export async function fetchGoogleBooksMetadata(title, author) {
  if (!title) return null;
  const url = `${BASE}?q=${encodeURIComponent(buildQuery(title, author))}&maxResults=3`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const items = j.items || [];
    if (!items.length) return null;

    // Pick the first item that has either pageCount or imageLinks.
    const pick = items.find(i => i.volumeInfo?.pageCount || i.volumeInfo?.imageLinks) || items[0];
    const v = pick.volumeInfo || {};
    const links = v.imageLinks || {};
    // Prefer the largest image we can get. Google returns them via thumbnail.
    let coverUrl = links.extraLarge || links.large || links.medium || links.thumbnail || links.smallThumbnail || null;
    // Force https.
    if (coverUrl) coverUrl = coverUrl.replace(/^http:/, "https:");

    let binding = null;
    const printType = (v.printType || "").toLowerCase();
    const description = (v.description || "").toLowerCase();
    if (/hardcover|hardback/.test(description)) binding = "hardcover";
    else if (/paperback|softcover/.test(description)) binding = "paperback";
    // Otherwise leave null; caller falls back to paperback default.

    const dims = v.dimensions || {};
    // dimensions.height is like "20.00 cm" or "8 inches".
    const heightCm = parseDim(dims.height);
    const spineThicknessCm = parseDim(dims.thickness);

    return {
      coverUrl,
      pageCount: v.pageCount || null,
      binding,
      heightCm,
      spineThicknessCm
    };
  } catch {
    return null;
  }
}

function parseDim(raw) {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  const num = parseFloat(s);
  if (!Number.isFinite(num)) return null;
  if (s.includes("inch") || s.includes("in")) return Math.round(num * 2.54 * 10) / 10;
  return Math.round(num * 10) / 10; // assume cm
}
