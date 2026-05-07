// Simple Levenshtein distance + normalized similarity.
// Inlined (no npm dep) so we ship a smaller bundle and don't need a build step.
//
// similarity(a, b) returns a value in [0, 1] where 1 == identical.
// Used by import-fuzzy-dedup at threshold > 0.85 (see ImportModal).

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const al = a.length, bl = b.length;
  // Two-row dynamic programming, O(min(al, bl)) memory.
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    const ac = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ac === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost      // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

export function similarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const d = levenshtein(a, b);
  const m = Math.max(a.length, b.length);
  return m === 0 ? 1 : 1 - d / m;
}
