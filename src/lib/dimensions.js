// Dimension utilities. No estimates — real numbers only.
// If a book doesn't have heightCm and spineThicknessCm from a real source
// (Google Books physical_dimensions, OpenLibrary editions, or a measured
// shelf photo), it is treated as "unmeasured" and not rendered on the
// bookshelf canvas.

export function hasRealDimensions(book) {
  return Number.isFinite(book.heightCm) && book.heightCm > 0
      && Number.isFinite(book.spineThicknessCm) && book.spineThicknessCm > 0;
}

// Identity pass-through. Kept so existing callers (layoutAlgorithms.runPreset)
// don't break, but it no longer fills anything.
export function fillDimensions(book) {
  return { ...book };
}
