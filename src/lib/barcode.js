// Barcode scanning + ISBN lookup.
//
// Uses the browser's native BarcodeDetector API where available
// (Chrome desktop, Chrome Android, Edge — broad coverage in 2025).
// Falls back gracefully when missing: caller shows a manual-ISBN input.

export function barcodeDetectorAvailable() {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

let detector = null;
async function getDetector() {
  if (detector) return detector;
  if (!barcodeDetectorAvailable()) return null;
  // ean_13 covers ISBN-13. upc_a / ean_8 for older barcodes too.
  detector = new window.BarcodeDetector({ formats: ["ean_13", "upc_a", "ean_8"] });
  return detector;
}

// Continuously scan frames from a <video> element until a barcode appears,
// then stop. Returns the recognized value or null on abort.
//   videoEl: HTMLVideoElement with an active stream
//   signal:  AbortSignal to cancel
export async function scanFromVideo(videoEl, { signal } = {}) {
  const det = await getDetector();
  if (!det) return null;
  while (!signal?.aborted) {
    try {
      const codes = await det.detect(videoEl);
      if (codes && codes.length) {
        // ISBN-13s are 13 digits, all numeric.
        for (const c of codes) {
          const raw = String(c.rawValue || "").replace(/[^\d]/g, "");
          if (raw.length >= 10) return raw;
        }
      }
    } catch {
      // detect() sometimes throws transient errors mid-stream; ignore + retry.
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

// ISBN-10 → ISBN-13 (used as a fallback if a scanner emits the older code).
export function isbn10to13(isbn10) {
  const s = (isbn10 || "").replace(/[^0-9X]/gi, "");
  if (s.length !== 10) return isbn10;
  const core = "978" + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (i % 2 === 0 ? 1 : 3) * parseInt(core[i], 10);
  const check = (10 - (sum % 10)) % 10;
  return core + check;
}

// Google Books lookup by ISBN. Returns { title, author, series, seriesNumber, coverUrl } or null.
export async function lookupISBN(isbn) {
  if (!isbn) return null;
  const normalized = isbn.length === 10 ? isbn10to13(isbn) : isbn;
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(normalized)}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const item = (j.items || [])[0];
    if (!item) return null;
    const v = item.volumeInfo || {};
    let coverUrl = (v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null);
    if (coverUrl) coverUrl = coverUrl.replace(/^http:/, "https:");
    return {
      title: v.title || "",
      author: (v.authors && v.authors[0]) || "",
      series: null,
      seriesNumber: null,
      coverUrl,
      isbn: normalized
    };
  } catch {
    return null;
  }
}
