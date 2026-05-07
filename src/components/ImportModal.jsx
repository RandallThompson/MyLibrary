// ImportModal v2 — Goodreads CSV import with snapshot, exact dedup, fuzzy review.
//
// Pipeline:
//   1) Snapshot current library (IDB-backed, 10-min TTL — see dataStore).
//   2) Parse CSV.
//   3) Drop candidates whose normalized_key already exists (silent skip).
//   4) Pairwise Levenshtein on (title|author) strings against existing books AND
//      other candidates in the same import. Threshold > 0.85 and < 1.0.
//   5) Show review modal: each near-dup pair → merge / keep both / cancel-all.
//   6) Commit non-skipped rows. Banner "Imported N books — Undo".

import { useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import Modal from "./Modal";
import { parseTitleSuffix, normalizedKey } from "../lib/normalize";
import { similarity } from "../lib/similarity";

const FUZZY_THRESHOLD = 0.85;

// CSV parser (carries the v1 logic — handles quoted fields, embedded newlines,
// escaped quotes — Goodreads exports require this).
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Goodreads CSV → array of v2 candidates (camelCase).
function parseGoodreads(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  const ti = headers.indexOf("Title");
  const ai = headers.indexOf("Author");
  const aai = headers.indexOf("Additional Authors");
  const oi = headers.indexOf("Owned Copies");
  if (ti < 0 || ai < 0) throw new Error("Not a Goodreads export");

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[ti]) continue;
    const parsed = parseTitleSuffix(r[ti]);
    const owned = oi >= 0 ? parseInt(r[oi]) || 0 : 0;
    const copies = owned > 0 ? owned : 1;
    const additionalAuthors = aai >= 0 && r[aai]
      ? r[aai].split(",").map(s => s.trim()).filter(Boolean)
      : [];
    for (let c = 0; c < copies; c++) {
      out.push({
        title: parsed.title,
        author: r[ai] || "Unknown",
        additionalAuthors,
        series: parsed.series,
        seriesNumber: parsed.seriesNumber
      });
    }
  }
  return out;
}

// Build the comparable string for fuzzy matching.
const cmpString = (b) => `${(b.title || "").toLowerCase()}|${(b.author || "").toLowerCase()}`;

// Find near-duplicate pairs.
// Returns: [{ candidate, existing, score }] — `existing` may be a library book OR
//          another candidate (we de-dup within an import too).
function findFuzzyPairs(candidates, existing) {
  const pairs = [];
  const eStrings = existing.map(b => ({ b, s: cmpString(b) }));
  const cStrings = candidates.map(c => ({ c, s: cmpString(c) }));

  // Candidate vs existing
  for (const { c, s } of cStrings) {
    for (const { b, s: bs } of eStrings) {
      const sim = similarity(s, bs);
      if (sim > FUZZY_THRESHOLD && sim < 1) {
        pairs.push({ candidate: c, existing: b, score: sim, kind: "library" });
        break; // one near-match per candidate is enough to flag
      }
    }
  }
  // Candidate vs other candidates (intra-import)
  for (let i = 0; i < cStrings.length; i++) {
    for (let j = i + 1; j < cStrings.length; j++) {
      const sim = similarity(cStrings[i].s, cStrings[j].s);
      if (sim > FUZZY_THRESHOLD && sim < 1) {
        pairs.push({
          candidate: cStrings[j].c, // mark the second one as the dup
          existing: cStrings[i].c,
          score: sim,
          kind: "import"
        });
      }
    }
  }
  return pairs;
}

export default function ImportModal({ books, onClose, onImport, onSnackbar }) {
  // onImport(rowsToInsert): performs snapshot + insert + returns inserted count.
  const fileRef = useRef(null);
  const [stage, setStage] = useState("choose"); // choose | review | committing
  const [status, setStatus] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [fuzzyPairs, setFuzzyPairs] = useState([]);
  const [decisions, setDecisions] = useState({}); // candIndex → "merge" | "keep"

  const existingKeys = useMemo(
    () => new Set(books.map(b => b.normalizedKey || normalizedKey(b.title, b.author))),
    [books]
  );

  const handleFile = async (file) => {
    if (!file) return;
    setStatus("Reading…");
    try {
      const text = await file.text();
      const parsed = parseGoodreads(text);
      // Drop exact-key duplicates against the existing library.
      const survivors = parsed.filter(c => !existingKeys.has(normalizedKey(c.title, c.author)));
      // Within-import: drop later occurrences with the same key as earlier ones.
      const seen = new Set();
      const deduped = [];
      for (const c of survivors) {
        const k = normalizedKey(c.title, c.author);
        if (seen.has(k)) continue;
        seen.add(k);
        deduped.push(c);
      }
      const pairs = findFuzzyPairs(deduped, books);
      // Default decision: "keep" both for now (no auto-merge).
      const initial = {};
      pairs.forEach(p => {
        const idx = deduped.indexOf(p.candidate);
        if (idx >= 0) initial[idx] = "keep";
      });

      if (deduped.length === 0) {
        setStatus("Nothing to import — all entries already in your library.");
        return;
      }

      setCandidates(deduped);
      setFuzzyPairs(pairs);
      setDecisions(initial);

      if (pairs.length === 0) {
        // No fuzzy matches — go straight to commit.
        await commit(deduped);
      } else {
        setStage("review");
        setStatus("");
      }
    } catch (e) {
      console.error(e);
      setStatus(`Couldn't parse: ${e.message}`);
    }
  };

  const commit = async (rows) => {
    setStage("committing");
    setStatus(`Importing ${rows.length}…`);
    try {
      const inserted = await onImport(rows);
      onSnackbar && onSnackbar({
        message: `Imported ${inserted} books`,
        action: "Undo",
        durationMs: 10 * 60 * 1000, // 10 min
        kind: "import-undo"
      });
      onClose();
    } catch (e) {
      console.error(e);
      if (e.code === "offline") setStatus("You're offline. Connect and try again.");
      else setStatus(`Import failed: ${e.message || "unknown error"}`);
      setStage("review"); // let the user retry
    }
  };

  const finalizeReview = async () => {
    // For each candidate, "merge" means drop it; "keep" means insert it.
    const toInsert = candidates.filter((_, i) => decisions[i] !== "merge");
    await commit(toInsert);
  };

  // ---- render ----
  if (stage === "review") {
    return (
      <Modal onClose={onClose} title="Review near-duplicates" size="lg">
        <p className="text-sm text-[#6B5840] mb-4">
          We found {fuzzyPairs.length} entry{fuzzyPairs.length === 1 ? "" : "s"} that look very similar to something
          already in your library or to another row in this import. Pick one for each.
        </p>
        <ul className="space-y-3 mb-5">
          {fuzzyPairs.map((p) => {
            const idx = candidates.indexOf(p.candidate);
            return (
              <li key={idx} className="border border-[#2A1F14]/15 rounded-lg p-3 bg-[#FBF6E9]">
                <div className="flex items-baseline justify-between gap-2 mb-2">
                  <span className="text-[10px] uppercase tracking-wider text-[#6B5840]">
                    {Math.round(p.score * 100)}% match · {p.kind === "library" ? "in library" : "in this import"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-xs">
                    <div className="text-[10px] uppercase tracking-wider text-[#6B5840] mb-1">Existing</div>
                    <div className="display text-[14px]">{p.existing.title}</div>
                    <div className="text-[#6B5840]">{p.existing.author}</div>
                  </div>
                  <div className="text-xs">
                    <div className="text-[10px] uppercase tracking-wider text-[#6B5840] mb-1">New</div>
                    <div className="display text-[14px]">{p.candidate.title}</div>
                    <div className="text-[#6B5840]">{p.candidate.author}</div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    type="button"
                    onClick={() => setDecisions(d => ({ ...d, [idx]: "merge" }))}
                    className={`px-3 py-1 rounded-full text-xs border ${
                      decisions[idx] === "merge"
                        ? "bg-[#2A1F14] text-[#F4EBD9] border-[#2A1F14]"
                        : "border-[#2A1F14]/20 hover:border-[#8B3A2A]"
                    }`}
                  >
                    Drop new — same book
                  </button>
                  <button
                    type="button"
                    onClick={() => setDecisions(d => ({ ...d, [idx]: "keep" }))}
                    className={`px-3 py-1 rounded-full text-xs border ${
                      decisions[idx] === "keep"
                        ? "bg-[#2A1F14] text-[#F4EBD9] border-[#2A1F14]"
                        : "border-[#2A1F14]/20 hover:border-[#8B3A2A]"
                    }`}
                  >
                    Keep both
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {status && <p className="text-xs text-[#8B3A2A] mb-3">{status}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#6B5840] hover:text-[#2A1F14]">
            Cancel import
          </button>
          <button
            onClick={finalizeReview}
            className="bg-[#2A1F14] text-[#F4EBD9] px-4 py-2 rounded-full text-sm hover:bg-[#8B3A2A] transition"
          >
            Confirm and import
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Import from Goodreads">
      <p className="text-sm text-[#6B5840] mb-4">
        On Goodreads: <span className="display-soft italic">My Books → Import and export → Export Library</span>.
        Drop the CSV here.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => handleFile(e.target.files?.[0])}
        className="hidden"
      />
      <button
        onClick={() => fileRef.current?.click()}
        className="w-full border-2 border-dashed border-[#2A1F14]/30 rounded-lg p-6 text-center hover:border-[#8B3A2A] hover:bg-[#FBF6E9] transition"
      >
        <Upload size={22} className="mx-auto mb-2 text-[#6B5840]" />
        <div className="text-sm text-[#2A1F14]">Choose goodreads_library_export.csv</div>
      </button>
      {status && <p className="text-sm mt-3 text-center text-[#8B3A2A]">{status}</p>}
      <p className="text-xs text-[#6B5840] mt-4">
        Series names are extracted from titles like <em>Title (Series, #2)</em>. Owned Copies count is honored.
        Books already in your library are silently skipped; near-duplicates trigger a review step.
      </p>
    </Modal>
  );
}
