// SearchBar v2 — the bookstore moment.
//
// Behavior:
//   - Always visible at top of main view.
//   - Live dropdown of top ~10 matches under the input.
//   - Single character: title OR author starts-with.
//   - Two+ characters: substring match against (title + author + series);
//                       if zero results, fall back to token-AND-match.
//   - Clicking a result calls onSelect(book) so the Library can scroll to it.
//   - All match work happens in-memory on the books prop. No network.

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";

const MAX_RESULTS = 10;

function searchableString(b) {
  return [b.title, b.author, ...(b.additionalAuthors || []), b.series || ""]
    .join(" ")
    .toLowerCase();
}

export function searchBooks(books, q) {
  const query = (q || "").trim();
  if (!query) return [];
  const lc = query.toLowerCase();

  // Single-char browse-by-first-letter
  if (query.length === 1) {
    return books.filter(b =>
      (b.title || "").toLowerCase().startsWith(lc) ||
      (b.author || "").toLowerCase().startsWith(lc)
    );
  }

  // 2+ chars: substring on the searchable string
  const annotated = books.map(b => ({ b, s: searchableString(b) }));
  const sub = annotated.filter(({ s }) => s.includes(lc));
  if (sub.length) return sub.map(({ b }) => b);

  // Fallback: token-AND match
  const tokens = lc.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return annotated
    .filter(({ s }) => tokens.every(t => s.includes(t)))
    .map(({ b }) => b);
}

export default function SearchBar({
  books,
  q,
  setQ,
  onSelect, // (book) => void
  stats,
  onOpenImport,
  onOpenAdd,
  onOpenSettings
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const matches = useMemo(() => searchBooks(books, q).slice(0, MAX_RESULTS), [books, q]);

  // Close the dropdown on outside click.
  useEffect(() => {
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="sticky top-0 z-20 bg-[#F4EBD9]/85 backdrop-blur-md border-b border-[#2A1F14]/10">
      <div className="max-w-3xl mx-auto px-5 py-3" ref={wrapRef}>
        <div className="relative">
          <div className="flex items-center gap-2 bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-full px-4 py-2.5 spine-shadow">
            <Search size={18} className="text-[#6B5840] shrink-0" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder="title, author, or series…"
              className="bg-transparent flex-1 outline-none placeholder:text-[#6B5840]/60 text-[15px]"
            />
            {q && (
              <button onClick={() => { setQ(""); setOpen(false); }} className="text-[#6B5840] hover:text-[#8B3A2A]">
                <X size={16} />
              </button>
            )}
          </div>

          {/* Dropdown */}
          {open && q.trim() && (
            <div className="absolute left-0 right-0 mt-1 bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-xl spine-shadow overflow-hidden z-30">
              {matches.length === 0 ? (
                <div className="px-4 py-3 text-sm text-[#6B5840] italic">
                  Nothing matches "{q}".
                </div>
              ) : (
                <ul className="max-h-80 overflow-y-auto divide-y divide-[#2A1F14]/5">
                  {matches.map((b) => (
                    <li key={b.id}>
                      <button
                        onClick={() => { onSelect && onSelect(b); setOpen(false); }}
                        className="w-full text-left px-4 py-2.5 hover:bg-[#F4EBD9] transition flex items-baseline justify-between gap-3"
                      >
                        <span className="display text-[15px] truncate">{b.title}</span>
                        <span className="text-xs text-[#6B5840] truncate flex-shrink-0">{b.author}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mt-2 text-xs text-[#6B5840]">
          <div className="flex gap-3">
            <span><span className="font-semibold text-[#2A1F14]">{stats.titles}</span> books</span>
            <span><span className="font-semibold text-[#2A1F14]">{stats.authors}</span> authors</span>
            <span><span className="font-semibold text-[#2A1F14]">{stats.series}</span> series</span>
            {stats.gappy > 0 && (
              <span className="text-[#8B3A2A]">{stats.gappy} with gaps</span>
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onOpenImport} className="hover:text-[#8B3A2A]">Import</button>
            <button onClick={onOpenAdd} className="hover:text-[#8B3A2A]">Add</button>
            <button onClick={onOpenSettings} className="hover:text-[#8B3A2A]">Settings</button>
          </div>
        </div>
      </div>
    </div>
  );
}
