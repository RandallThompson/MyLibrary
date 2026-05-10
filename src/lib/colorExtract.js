// Client-side dominant-color extraction. Pure-JS k-means on a downsampled
// image — no third-party dep so we keep the bundle small.
//
// Usage:
//   const hex = await extractDominantColorHex("https://...cover.jpg");
// Returns a hex string like "#a14532" or null on failure.

// Small, fast k-means. We sample at most ~4096 pixels (64x64 downsample),
// run 8 iterations, k=4, then pick the cluster with highest weight.
async function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function downsample(img, max = 64) {
  const ratio = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * ratio));
  const h = Math.max(1, Math.round(img.naturalHeight * ratio));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  } catch {
    // CORS blocked. Caller falls through to a fallback color.
    return null;
  }
}

function dist2(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function kmeans(pixels, k = 4, iters = 8) {
  if (!pixels.length) return null;
  // Initial centers: take k evenly-spaced samples.
  const centers = [];
  const stride = Math.max(1, Math.floor(pixels.length / k));
  for (let i = 0; i < k; i++) centers.push([...pixels[i * stride % pixels.length]]);

  const counts = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0]);
    counts.fill(0);
    for (let p = 0; p < pixels.length; p++) {
      const px = pixels[p];
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(px, centers[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      sums[best][0] += px[0];
      sums[best][1] += px[1];
      sums[best][2] += px[2];
      counts[best]++;
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] > 0) {
        centers[c][0] = Math.round(sums[c][0] / counts[c]);
        centers[c][1] = Math.round(sums[c][1] / counts[c]);
        centers[c][2] = Math.round(sums[c][2] / counts[c]);
      }
    }
  }
  // Pick cluster with most pixels but penalize near-white/near-black (paper / ink).
  let bestIdx = 0, bestScore = -1;
  for (let c = 0; c < k; c++) {
    if (!counts[c]) continue;
    const [r, g, b] = centers[c];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    const distFromMid = Math.abs(luminance - 128);
    // Higher count is better; further from neutral mid is better; exclude very white/black.
    if (luminance > 245 || luminance < 10) continue;
    const score = counts[c] * (1 - distFromMid / 256 * 0.3);
    if (score > bestScore) { bestScore = score; bestIdx = c; }
  }
  return centers[bestIdx];
}

function rgbToHex([r, g, b]) {
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

export async function extractDominantColorHex(url) {
  if (!url) return null;
  const img = await loadImage(url);
  if (!img) return null;
  const data = downsample(img, 64);
  if (!data) return null;
  // Skip transparent pixels and pure-white border pixels.
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r > 248 && g > 248 && b > 248) continue;
    pixels.push([r, g, b]);
  }
  if (!pixels.length) return null;
  const c = kmeans(pixels, 4, 8);
  return c ? rgbToHex(c) : null;
}
