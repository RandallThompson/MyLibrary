// Layout algorithms for the bookshelf designer.
//
// All algorithms accept:
//   books      - array of book objects with { id, title, heightCm, spineThicknessCm, dominantColorHex, ... }
//   bookcase   - { shelfCount, shelfWidthCm, shelfHeightCm }
//   options    - algorithm-specific options
//
// All return a layout plan:
//   {
//     shelves: [
//       { books: [ { bookId, orientation: 'vertical'|'horizontal', xCm, stackHeightCm? } ] }
//     ],
//     overflow: [ bookId, ... ]   // books that didn't fit
//   }
//
// xCm is the left edge of the book's spine on its shelf, in cm from the left.

import { fillDimensions } from "./dimensions";

// ---------- color helpers (hex → HSL) ----------

function hexToRgb(hex) {
  if (!hex) return null;
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m || m.length !== 3) return null;
  return m.map(s => parseInt(s, 16));
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hueOf(book) {
  const rgb = hexToRgb(book.dominantColorHex);
  if (!rgb) return -1; // bookless of color goes to the end
  return rgbToHsl(rgb).h;
}

// ---------- placement engine ----------

// Greedy left-to-right placer for a list of vertical-only books.
// Returns layout. Books that don't fit anywhere go in `overflow`.
function placeVerticalGreedy(books, bookcase) {
  const shelves = Array.from({ length: bookcase.shelfCount }, () => ({ books: [], usedCm: 0 }));
  const overflow = [];
  for (const b of books) {
    const w = b.spineThicknessCm;
    const h = b.heightCm;
    let placed = false;
    for (const s of shelves) {
      if (h <= bookcase.shelfHeightCm && s.usedCm + w <= bookcase.shelfWidthCm) {
        s.books.push({ bookId: b.id, orientation: "vertical", xCm: s.usedCm });
        s.usedCm += w;
        placed = true;
        break;
      }
    }
    if (!placed) overflow.push(b.id);
  }
  return { shelves: shelves.map(s => ({ books: s.books })), overflow };
}

// ---------- presets ----------

// Rainbow: books sorted by hue across the entire library, then placed.
export function rainbowLayout(books, bookcase) {
  const filled = books.map(fillDimensions);
  const sorted = [...filled].sort((a, b) => {
    const ha = hueOf(a), hb = hueOf(b);
    // Put colorless books at the end.
    if (ha < 0 && hb < 0) return 0;
    if (ha < 0) return 1;
    if (hb < 0) return -1;
    return ha - hb;
  });
  return placeVerticalGreedy(sorted, bookcase);
}

// Monochrome blocks: cluster by hue bucket (red/orange/yellow/green/blue/purple/neutral).
export function monoBlockLayout(books, bookcase) {
  const filled = books.map(fillDimensions);
  const bucketOf = (b) => {
    const h = hueOf(b);
    if (h < 0) return 7; // neutrals last
    if (h < 30 || h >= 330) return 0;  // red
    if (h < 60)  return 1;             // orange
    if (h < 90)  return 2;             // yellow
    if (h < 170) return 3;             // green
    if (h < 230) return 4;             // blue
    if (h < 290) return 5;             // purple
    return 6;                          // pink
  };
  const buckets = new Map();
  for (const b of filled) {
    const k = bucketOf(b);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(b);
  }
  const ordered = [];
  for (let k = 0; k <= 7; k++) {
    if (buckets.has(k)) {
      const list = buckets.get(k);
      // Within bucket: by lightness (dark to light).
      list.sort((a, b) => {
        const la = hexToRgb(a.dominantColorHex), lb = hexToRgb(b.dominantColorHex);
        const al = la ? rgbToHsl(la).l : 0.5, bl = lb ? rgbToHsl(lb).l : 0.5;
        return al - bl;
      });
      ordered.push(...list);
    }
  }
  return placeVerticalGreedy(ordered, bookcase);
}

// Height rhythm: tall, short, tall, short. Pleasing visual zigzag.
export function heightRhythmLayout(books, bookcase) {
  const filled = books.map(fillDimensions);
  const sorted = [...filled].sort((a, b) => b.heightCm - a.heightCm);
  // Split halves; weave.
  const tall = sorted.slice(0, Math.ceil(sorted.length / 2));
  const short = sorted.slice(Math.ceil(sorted.length / 2));
  const woven = [];
  while (tall.length || short.length) {
    if (tall.length) woven.push(tall.shift());
    if (short.length) woven.push(short.shift());
  }
  return placeVerticalGreedy(woven, bookcase);
}

// Mix vert/horiz: every Nth shelf-position becomes a horizontal stack of 3 books.
// We emulate by placing groups vertically, then converting roughly 1-in-12 books
// into horizontal stacks (laid flat, height = sum of spine thicknesses).
export function mixVertHorizLayout(books, bookcase) {
  const filled = books.map(fillDimensions);
  // Sort by series-friendliness first (keep series together when possible),
  // then weave in occasional stacks of 3 books laid horizontally.
  const ordered = [...filled].sort((a, b) => {
    const sa = a.series || "~~~", sb = b.series || "~~~";
    if (sa !== sb) return sa.localeCompare(sb);
    if ((a.seriesNumber || 0) !== (b.seriesNumber || 0)) return (a.seriesNumber || 0) - (b.seriesNumber || 0);
    return a.title.localeCompare(b.title);
  });

  const shelves = Array.from({ length: bookcase.shelfCount }, () => ({ books: [], usedCm: 0 }));
  const overflow = [];
  let placedSinceLastStack = 0;
  let i = 0;
  while (i < ordered.length) {
    const b = ordered[i];
    // Every ~12 placements, try to lay 3 books horizontally if there's room.
    const tryStack = placedSinceLastStack >= 11 && i + 2 < ordered.length;
    if (tryStack) {
      const trio = ordered.slice(i, i + 3);
      // Width of horizontal stack = max heightCm of the three (since they're rotated).
      const stackWidth = Math.max(...trio.map(t => t.heightCm));
      const stackTotalThicknessCm = trio.reduce((acc, t) => acc + t.spineThicknessCm, 0);
      // Horizontal stack fits a shelf if stackTotalThicknessCm < shelfHeightCm.
      const fitter = shelves.find(s => stackTotalThicknessCm <= bookcase.shelfHeightCm
                                    && s.usedCm + stackWidth <= bookcase.shelfWidthCm);
      if (fitter) {
        let yCm = 0;
        for (const t of trio) {
          fitter.books.push({
            bookId: t.id,
            orientation: "horizontal",
            xCm: fitter.usedCm,
            stackIndex: yCm
          });
          yCm += t.spineThicknessCm;
        }
        fitter.usedCm += stackWidth;
        i += 3;
        placedSinceLastStack = 0;
        continue;
      }
    }
    // Vertical placement for this book.
    let placed = false;
    for (const s of shelves) {
      if (b.heightCm <= bookcase.shelfHeightCm && s.usedCm + b.spineThicknessCm <= bookcase.shelfWidthCm) {
        s.books.push({ bookId: b.id, orientation: "vertical", xCm: s.usedCm });
        s.usedCm += b.spineThicknessCm;
        placed = true;
        placedSinceLastStack++;
        break;
      }
    }
    if (!placed) overflow.push(b.id);
    i++;
  }
  return { shelves: shelves.map(s => ({ books: s.books })), overflow };
}

// Shuffle: random order. Deterministic per seed for re-rendering stability.
export function shuffleLayout(books, bookcase, { seed = Date.now() } = {}) {
  const filled = books.map(fillDimensions);
  // Fisher-Yates with seeded PRNG.
  const rand = mulberry32(seed);
  const arr = [...filled];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return placeVerticalGreedy(arr, bookcase);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Registry — the UI iterates this.
export const PRESETS = [
  { id: "rainbow", label: "Rainbow",         run: rainbowLayout,      hint: "By color, smooth gradient." },
  { id: "mono",    label: "Monochrome blocks", run: monoBlockLayout,  hint: "Clusters: reds, blues, neutrals." },
  { id: "rhythm",  label: "Height rhythm",   run: heightRhythmLayout, hint: "Tall–short–tall zigzag." },
  { id: "mix",     label: "Vertical + stacks", run: mixVertHorizLayout, hint: "Mostly upright, occasional flat stacks." },
  { id: "shuffle", label: "Shuffle",         run: shuffleLayout,      hint: "Random for inspiration." }
];

export function runPreset(presetId, books, bookcase, options) {
  const preset = PRESETS.find(p => p.id === presetId);
  if (!preset) throw new Error(`Unknown preset ${presetId}`);
  return preset.run(books, bookcase, options);
}
