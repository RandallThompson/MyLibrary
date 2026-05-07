// Series-grouping + gap-detection logic.
// Used by Library.jsx; isolated here so it stays unit-testable and out of the JSX.

// Build the series view for one author.
// Input: array of book objects (camelCase shape from dataStore.fromDb)
// Output: { series: [{ name, list, gaps, knownTotal }], standalones: [...] }
//
// Gap rules:
//   - If we have a known total for (author, series) (i.e. seriesKnownTotal on
//     ANY book in this group, take the max), gaps = 1..total minus owned ints.
//   - Else, gaps = ints between min(owned) and max(owned) not in owned set.
//   - Series with only one owned book and no known total → no gaps (we don't
//     know the size; don't fabricate "missing #2").
export function buildAuthorView(authorBooks) {
  const seriesMap = new Map();
  const standalones = [];
  authorBooks.forEach(b => {
    if (b.series) {
      if (!seriesMap.has(b.series)) seriesMap.set(b.series, []);
      seriesMap.get(b.series).push(b);
    } else {
      standalones.push(b);
    }
  });

  const series = Array.from(seriesMap.entries()).map(([name, list]) => {
    const numbered = list.filter(b => b.seriesNumber != null)
      .sort((a, b) => a.seriesNumber - b.seriesNumber);
    const unnumbered = list.filter(b => b.seriesNumber == null);
    // Known total: max of any cached seriesKnownTotal among rows in this series.
    const knownTotals = list.map(b => b.seriesKnownTotal).filter(Boolean);
    const knownTotal = knownTotals.length ? Math.max(...knownTotals) : null;

    let gaps = [];
    if (numbered.length) {
      const have = new Set(numbered.map(b => Math.floor(b.seriesNumber)));
      if (knownTotal && knownTotal > 0) {
        for (let n = 1; n <= knownTotal; n++) if (!have.has(n)) gaps.push(n);
      } else if (numbered.length > 1) {
        const min = Math.floor(numbered[0].seriesNumber);
        const max = Math.ceil(numbered[numbered.length - 1].seriesNumber);
        for (let n = min; n <= max; n++) if (!have.has(n)) gaps.push(n);
      }
    }

    return { name, list: [...numbered, ...unnumbered], gaps, knownTotal };
  });

  // Series alphabetical, standalones alphabetical by title.
  series.sort((a, b) => a.name.localeCompare(b.name));
  standalones.sort((a, b) => a.title.localeCompare(b.title));

  return { series, standalones };
}

// Whole-library stats. Used by SearchBar.
export function libraryStats(books) {
  const titles = books.length;
  const authors = new Set(books.map(b => b.author)).size;
  const seriesSet = new Set(
    books.filter(b => b.series).map(b => b.author + "::" + b.series)
  );
  let gappy = 0;
  // Quick gap count: per (author, series), use buildAuthorView's logic.
  const byAuthor = new Map();
  books.forEach(b => {
    if (!byAuthor.has(b.author)) byAuthor.set(b.author, []);
    byAuthor.get(b.author).push(b);
  });
  byAuthor.forEach(authorBooks => {
    const { series } = buildAuthorView(authorBooks);
    series.forEach(s => { if (s.gaps.length > 0) gappy++; });
  });
  return { titles, authors, series: seriesSet.size, gappy };
}

// Sort authors by last word of name (rough last-name proxy).
export function authorSortKey(name) {
  const parts = (name || "").trim().split(/\s+/);
  return (parts[parts.length - 1] || name || "").toLowerCase();
}
