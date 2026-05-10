// Estimates physical book dimensions from page count + binding.
//
// Spine thickness rules of thumb:
//   - trade paperback: pages * 0.0127 cm/page  (≈ 0.005 in)
//   - hardcover:       pages * 0.01016 cm/page (≈ 0.004 in)
//   - mass-market PB:  pages * 0.0152 cm/page  (slightly thicker stock)
//
// Default heights when unknown:
//   - trade paperback: 20.0 cm
//   - hardcover:       23.0 cm
//   - mass-market:     17.5 cm
//
// All functions accept partial input. They never throw.

const SPINE_PER_PAGE = {
  paperback: 0.0127,
  hardcover: 0.01016,
  massmarket: 0.0152
};

const DEFAULT_HEIGHT = {
  paperback: 20.0,
  hardcover: 23.0,
  massmarket: 17.5
};

const DEFAULT_SPINE = {
  paperback: 2.4,   // ~average trade paperback (~190 pages)
  hardcover: 3.2,   // ~average hardcover (~315 pages)
  massmarket: 2.1
};

function bindingKey(binding) {
  if (!binding) return "paperback";
  const b = binding.toLowerCase();
  if (b.includes("hard")) return "hardcover";
  if (b.includes("mass")) return "massmarket";
  return "paperback";
}

export function estimateSpineThicknessCm({ pageCount, binding }) {
  const key = bindingKey(binding);
  if (Number.isFinite(pageCount) && pageCount > 0) {
    const cm = pageCount * SPINE_PER_PAGE[key];
    // Clamp to a plausible range (0.5 cm to 8 cm).
    return Math.max(0.5, Math.min(8, Math.round(cm * 10) / 10));
  }
  return DEFAULT_SPINE[key];
}

export function estimateHeightCm({ binding }) {
  return DEFAULT_HEIGHT[bindingKey(binding)];
}

// Fill missing dimensions on a book object based on what's available.
// Mutates and returns a new object.
export function fillDimensions(book) {
  const out = { ...book };
  if (!Number.isFinite(out.heightCm) || out.heightCm == null) {
    out.heightCm = estimateHeightCm({ binding: out.binding });
  }
  if (!Number.isFinite(out.spineThicknessCm) || out.spineThicknessCm == null) {
    out.spineThicknessCm = estimateSpineThicknessCm({ pageCount: out.pageCount, binding: out.binding });
  }
  return out;
}
