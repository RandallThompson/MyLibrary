// AddBookModal — v2 add/edit flow with OpenLibrary autocomplete.
//
// Pass `editing` to switch into edit mode. In edit mode:
//   - Title shows "Edit book" instead of "Add a book".
//   - Save button reads "Save changes".
//   - Duplicate check skips the book being edited.
//   - onSave receives { ...fields, id } so the caller can call updateBook.

import { useEffect, useMemo, useRef, useState } from "react";
import Modal from "./Modal";
import Combobox from "./Combobox";
import { searchBooks as olSearch } from "../lib/openlibrary";
import { normalizedKey } from "../lib/normalize";

export default function AddBookModal({
  books,
  onClose,
  onSave,           // async (book) => savedBook
  initial = {},     // { title, author, series, seriesNumber } — for prefill
  editing = null    // null | book object — switches to edit mode when set
}) {
  const seed = editing || initial;
  const [title, setTitle] = useState(seed.title || "");
  const [author, setAuthor] = useState(seed.author || "");
  const [series, setSeries] = useState(seed.series || "");
  const [seriesNumber, setSeriesNumber] = useState(
    seed.seriesNumber == null ? "" : String(seed.seriesNumber)
  );

  const [olResults, setOlResults] = useState([]);
  const [olLoading, setOlLoading] = useState(false);
  const [olOpen, setOlOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState(null);

  const olAbortRef = useRef(null);
  const olTimerRef = useRef(null);

  const isEdit = !!editing;

  const authorOptions = useMemo(
    () => Array.from(new Set(books.map(b => b.author).filter(Boolean))).sort(),
    [books]
  );
  const seriesOptions = useMemo(
    () => Array.from(new Set(books.map(b => b.series).filter(Boolean))).sort(),
    [books]
  );

  // Debounced OpenLibrary lookup. Skipped in edit mode — autocomplete on
  // already-saved books would be confusing.
  useEffect(() => {
    if (isEdit) return;
    if (olAbortRef.current) olAbortRef.current.abort();
    if (olTimerRef.current) clearTimeout(olTimerRef.current);
    if (!title.trim() || title.trim().length < 3) {
      setOlResults([]);
      setOlOpen(false);
      return;
    }
    olTimerRef.current = setTimeout(() => {
      const ctrl = new AbortController();
      olAbortRef.current = ctrl;
      setOlLoading(true);
      olSearch(title, { signal: ctrl.signal })
        .then(rs => {
          if (!ctrl.signal.aborted) {
            setOlResults(rs);
            setOlOpen(rs.length > 0);
          }
        })
        .finally(() => { if (!ctrl.signal.aborted) setOlLoading(false); });
    }, 300);
    return () => { if (olTimerRef.current) clearTimeout(olTimerRef.current); };
  }, [title, isEdit]);

  // Live duplicate detection — skip the book being edited.
  useEffect(() => {
    setDuplicate(null);
    if (!title.trim() || !author.trim()) return;
    const key = normalizedKey(title, author);
    const hit = books.find(b => b.normalizedKey === key && (!editing || b.id !== editing.id));
    if (hit) setDuplicate(hit);
  }, [title, author, books, editing]);

  const pickSuggestion = (s) => {
    setTitle(s.title || title);
    if (s.author) setAuthor(s.author);
    if (s.series) setSeries(s.series);
    if (s.seriesNumber != null) setSeriesNumber(String(s.seriesNumber));
    setOlOpen(false);
  };

  const save = async () => {
    setError("");
    if (!title.trim() || !author.trim()) {
      setError("Title and Author are required.");
      return;
    }
    if (duplicate) {
      setError(`You already own "${duplicate.title}".`);
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        author: author.trim(),
        series: series.trim() || null,
        seriesNumber: seriesNumber === "" ? null : parseFloat(seriesNumber)
      };
      if (isEdit) payload.id = editing.id;
      await onSave(payload);
    } catch (e) {
      if (e.code === "duplicate") setError("You already own this book.");
      else if (e.code === "offline") setError("You're offline. Connect and try again.");
      else setError(e.message || "Couldn't save.");
      setBusy(false);
      return;
    }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} title={isEdit ? "Edit book" : "Add a book"} size="md">
      <div className="space-y-3">
        {/* Title with OL autocomplete (add mode only) */}
        <label className="block relative">
          <span className="text-[11px] uppercase tracking-wider text-[#6B5840]">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => !isEdit && olResults.length && setOlOpen(true)}
            autoFocus
            className="w-full mt-1 bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-md px-3 py-2 outline-none focus:border-[#8B3A2A] text-[15px]"
          />
          {!isEdit && olOpen && olResults.length > 0 && (
            <div className="absolute left-0 right-0 mt-1 bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-md max-h-72 overflow-y-auto z-50 spine-shadow">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[#6B5840] border-b border-[#2A1F14]/10">
                OpenLibrary {olLoading ? "..." : ""}
              </div>
              <ul>
                {olResults.map((r, i) => (
                  <li key={`${r.workKey || i}`}>
                    <button
                      type="button"
                      onClick={() => pickSuggestion(r)}
                      className="w-full text-left px-3 py-2 hover:bg-[#F4EBD9] block"
                    >
                      <div className="text-sm display">{r.title}</div>
                      <div className="text-xs text-[#6B5840]">
                        {r.author}
                        {r.series ? ` — ${r.series}${r.seriesNumber != null ? ` #${r.seriesNumber}` : ""}` : ""}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </label>

        <Combobox
          label="Author"
          value={author}
          onChange={setAuthor}
          options={authorOptions}
        />

        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <Combobox
              label="Series (optional)"
              value={series}
              onChange={setSeries}
              options={seriesOptions}
            />
          </div>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wider text-[#6B5840]">#</span>
            <input
              type="number"
              step="0.1"
              value={seriesNumber}
              onChange={(e) => setSeriesNumber(e.target.value)}
              className="w-full mt-1 bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-md px-3 py-2 outline-none focus:border-[#8B3A2A] text-[15px]"
            />
          </label>
        </div>

        {duplicate && !error && (
          <p className="text-xs text-[#8B3A2A]">
            You already own <em className="display-soft">{duplicate.title}</em> by {duplicate.author}.
          </p>
        )}
        {error && <p className="text-xs text-[#8B3A2A]">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[#6B5840] hover:text-[#2A1F14]">Cancel</button>
          <button
            onClick={save}
            disabled={busy || !title.trim() || !author.trim() || !!duplicate}
            className="bg-[#2A1F14] text-[#F4EBD9] px-4 py-2 rounded-full text-sm disabled:opacity-30 hover:bg-[#8B3A2A] transition"
          >
            {busy ? "Saving..." : isEdit ? "Save changes" : "Add to shelf"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
