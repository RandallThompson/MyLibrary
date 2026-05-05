import { useState, useEffect, useMemo, useRef } from "react";
import {
  Search, Plus, Upload, X, Trash2, BookOpen,
  ChevronDown, ChevronRight, AlertTriangle, Library as LibraryIcon, LogOut
} from "lucide-react";
import { supabase } from "./supabaseClient";

// ---------- Helpers ----------

// Goodreads titles often look like: "A Court of Frost and Starlight (A Court of Thorns and Roses, #3.1)"
function parseTitle(raw) {
  const m = raw.match(/^(.+?)\s*\((.+?),\s*#(\d+(?:\.\d+)?)\)\s*$/);
  if (m) return { title: m[1].trim(), series: m[2].trim(), seriesNumber: parseFloat(m[3]) };
  return { title: raw.trim(), series: null, seriesNumber: null };
}

// Robust CSV parser that handles quoted fields, escaped quotes, and embedded newlines
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

// Goodreads CSV → array of book rows ready for Supabase insert (shape uses snake_case)
function importGoodreads(text, userId) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  const ti = headers.indexOf("Title");
  const ai = headers.indexOf("Author");
  const oi = headers.indexOf("Owned Copies");
  const si = headers.indexOf("Exclusive Shelf");
  if (ti < 0 || ai < 0) throw new Error("Not a Goodreads export");
  const books = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[ti]) continue;
    const parsed = parseTitle(r[ti]);
    const owned = oi >= 0 ? parseInt(r[oi]) || 0 : 0;
    const shelf = si >= 0 ? r[si] : "";
    // If user marked Owned Copies, use it. Otherwise default to 1 (they're importing their library).
    const copies = owned > 0 ? owned : 1;
    for (let c = 0; c < copies; c++) {
      books.push({
        user_id: userId,
        title: parsed.title,
        author: r[ai] || "Unknown",
        series: parsed.series,
        series_number: parsed.seriesNumber,
        shelf: shelf || null
      });
    }
  }
  return books;
}

// DB row (snake_case) → JS shape (camelCase) used throughout the UI
const fromDb = (r) => ({
  id: r.id,
  title: r.title,
  author: r.author,
  series: r.series,
  seriesNumber: r.series_number,
  shelf: r.shelf
});

// Sort authors by last word (rough last-name proxy)
function authorSortKey(name) {
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1] || name).toLowerCase();
}

// ---------- Component ----------

export default function Library({ session }) {
  const userId = session.user.id;
  const userEmail = session.user.email;

  const [books, setBooks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [openAuthors, setOpenAuthors] = useState(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef(null);

  const [tT, setT] = useState("");
  const [tA, setA] = useState("");
  const [tS, setS] = useState("");
  const [tN, setN] = useState("");

  // Load all books for the signed-in user. RLS guarantees we only see our own.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("books")
        .select("*")
        .order("created_at", { ascending: true });
      if (!cancelled) {
        if (error) console.error(error);
        setBooks((data || []).map(fromDb));
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const addBook = async () => {
    if (!tT.trim() || !tA.trim()) return;
    const payload = {
      user_id: userId,
      title: tT.trim(),
      author: tA.trim(),
      series: tS.trim() || null,
      series_number: tN ? parseFloat(tN) : null
    };
    const { data, error } = await supabase
      .from("books")
      .insert(payload)
      .select()
      .single();
    if (error) {
      console.error(error);
      alert("Couldn't save: " + error.message);
      return;
    }
    setBooks((prev) => [...prev, fromDb(data)]);
    setT(""); setA(""); setS(""); setN("");
    setShowAdd(false);
  };

  const removeBook = async (id) => {
    const prev = books;
    setBooks(prev.filter(b => b.id !== id)); // optimistic
    const { error } = await supabase.from("books").delete().eq("id", id);
    if (error) {
      console.error(error);
      setBooks(prev); // rollback
      alert("Couldn't delete: " + error.message);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    setImportMsg("Reading…");
    try {
      const text = await file.text();
      const rows = importGoodreads(text, userId);
      if (!rows.length) { setImportMsg("Nothing to import."); return; }

      // Insert in chunks of 500 — Supabase happily accepts bulk inserts.
      const chunkSize = 500;
      const inserted = [];
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        setImportMsg(`Importing ${i + chunk.length} of ${rows.length}…`);
        const { data, error } = await supabase
          .from("books")
          .insert(chunk)
          .select();
        if (error) throw error;
        inserted.push(...(data || []));
      }
      setBooks((prev) => [...prev, ...inserted.map(fromDb)]);
      setImportMsg(`Imported ${inserted.length} entries.`);
      setTimeout(() => { setShowImport(false); setImportMsg(""); }, 1400);
    } catch (e) {
      console.error(e);
      setImportMsg(`Couldn't parse: ${e.message}`);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // Filtered + grouped
  const filtered = useMemo(() => {
    if (!q.trim()) return books;
    const s = q.toLowerCase();
    return books.filter(b =>
      b.title.toLowerCase().includes(s) ||
      b.author.toLowerCase().includes(s) ||
      (b.series && b.series.toLowerCase().includes(s))
    );
  }, [books, q]);

  const grouped = useMemo(() => {
    const map = new Map();
    filtered.forEach(b => {
      if (!map.has(b.author)) map.set(b.author, []);
      map.get(b.author).push(b);
    });
    return Array.from(map.entries())
      .sort((a, b) => authorSortKey(a[0]).localeCompare(authorSortKey(b[0])));
  }, [filtered]);

  // When searching, auto-open all matching authors
  useEffect(() => {
    if (q.trim()) setOpenAuthors(new Set(grouped.map(([a]) => a)));
  }, [q, grouped]);

  const toggleAuthor = (a) => {
    setOpenAuthors(prev => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a); else next.add(a);
      return next;
    });
  };

  // Build series view for one author
  const authorView = (authorBooks) => {
    const seriesMap = new Map();
    const standalones = [];
    authorBooks.forEach(b => {
      if (b.series) {
        if (!seriesMap.has(b.series)) seriesMap.set(b.series, []);
        seriesMap.get(b.series).push(b);
      } else standalones.push(b);
    });
    const series = Array.from(seriesMap.entries()).map(([name, list]) => {
      const numbered = list.filter(b => b.seriesNumber != null).sort((a, b) => a.seriesNumber - b.seriesNumber);
      const unnumbered = list.filter(b => b.seriesNumber == null);
      let gaps = [];
      if (numbered.length > 1) {
        const min = Math.floor(numbered[0].seriesNumber);
        const max = Math.ceil(numbered[numbered.length - 1].seriesNumber);
        const have = new Set(numbered.map(b => Math.floor(b.seriesNumber)));
        for (let n = min; n <= max; n++) if (!have.has(n)) gaps.push(n);
      }
      return { name, list: [...numbered, ...unnumbered], gaps };
    });
    return { series, standalones: standalones.sort((a, b) => a.title.localeCompare(b.title)) };
  };

  // Stats
  const stats = useMemo(() => {
    const titles = books.length;
    const authors = new Set(books.map(b => b.author)).size;
    const seriesSet = new Set(books.filter(b => b.series).map(b => b.author + "::" + b.series));
    let gappy = 0;
    seriesSet.forEach(key => {
      const [au, sr] = key.split("::");
      const list = books.filter(b => b.author === au && b.series === sr && b.seriesNumber != null)
        .sort((a, b) => a.seriesNumber - b.seriesNumber);
      if (list.length > 1) {
        const have = new Set(list.map(b => Math.floor(b.seriesNumber)));
        for (let n = Math.floor(list[0].seriesNumber); n <= Math.ceil(list[list.length - 1].seriesNumber); n++) {
          if (!have.has(n)) { gappy++; break; }
        }
      }
    });
    return { titles, authors, series: seriesSet.size, gappy };
  }, [books]);

  if (!loaded) {
    return <div className="min-h-screen flex items-center justify-center bg-[#F4EBD9] text-[#2A1F14]">Opening the shelf…</div>;
  }

  const empty = books.length === 0;

  return (
    <div className="min-h-screen bg-[#F4EBD9] text-[#2A1F14]" style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,400;9..144,500;9..144,600;9..144,700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        .display { font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 50, 'WONK' 0; letter-spacing: -0.01em; }
        .display-soft { font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'SOFT' 100, 'WONK' 1; }
        .paper { background-image: radial-gradient(circle at 25% 15%, rgba(139,58,42,0.04) 0, transparent 35%), radial-gradient(circle at 80% 80%, rgba(43,31,20,0.05) 0, transparent 40%); }
        .grain::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0.06; mix-blend-mode: multiply; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
        .spine-shadow { box-shadow: 0 1px 0 rgba(43,31,20,0.04), 0 8px 20px -16px rgba(43,31,20,0.18); }
        .gap-card { background: repeating-linear-gradient(45deg, rgba(199,125,63,0.08) 0 6px, transparent 6px 12px); }
      `}</style>

      <div className="paper relative">
        {/* Header */}
        <header className="max-w-3xl mx-auto px-5 pt-10 pb-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <LibraryIcon size={22} className="text-[#8B3A2A]" />
              <span className="text-xs uppercase tracking-[0.22em] text-[#6B5840]">Personal Library</span>
            </div>
            <button
              onClick={signOut}
              className="text-[11px] uppercase tracking-wider text-[#6B5840] hover:text-[#8B3A2A] flex items-center gap-1"
              title={userEmail}
            >
              <LogOut size={12} /> Sign out
            </button>
          </div>
          <h1 className="display text-4xl sm:text-5xl font-semibold">The Shelf</h1>
          <p className="display-soft text-[#6B5840] mt-1 italic">Search before you buy. See what's missing.</p>
        </header>

        {/* Search */}
        <div className="sticky top-0 z-20 bg-[#F4EBD9]/85 backdrop-blur-md border-b border-[#2A1F14]/10">
          <div className="max-w-3xl mx-auto px-5 py-3">
            <div className="flex items-center gap-2 bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-full px-4 py-2.5 spine-shadow">
              <Search size={18} className="text-[#6B5840] shrink-0" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="title, author, or series…"
                className="bg-transparent flex-1 outline-none placeholder:text-[#6B5840]/60 text-[15px]"
              />
              {q && <button onClick={() => setQ("")} className="text-[#6B5840] hover:text-[#8B3A2A]"><X size={16} /></button>}
            </div>
            <div className="flex items-center justify-between mt-2 text-xs text-[#6B5840]">
              <div className="flex gap-3">
                <span><span className="font-semibold text-[#2A1F14]">{stats.titles}</span> books</span>
                <span><span className="font-semibold text-[#2A1F14]">{stats.authors}</span> authors</span>
                <span><span className="font-semibold text-[#2A1F14]">{stats.series}</span> series</span>
                {stats.gappy > 0 && (
                  <span className="text-[#8B3A2A] flex items-center gap-1">
                    <AlertTriangle size={12} /> {stats.gappy} with gaps
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowImport(true)} className="hover:text-[#8B3A2A] flex items-center gap-1">
                  <Upload size={12} /> Import
                </button>
                <button onClick={() => setShowAdd(true)} className="hover:text-[#8B3A2A] flex items-center gap-1">
                  <Plus size={12} /> Add
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <main className="max-w-3xl mx-auto px-5 py-6 pb-32">
          {empty ? (
            <div className="text-center py-16">
              <BookOpen size={36} className="mx-auto text-[#8B3A2A]/60 mb-3" />
              <p className="display text-2xl mb-2">An empty shelf.</p>
              <p className="text-sm text-[#6B5840] mb-6">Import your Goodreads export, or add the first book by hand.</p>
              <div className="flex gap-2 justify-center">
                <button onClick={() => setShowImport(true)} className="bg-[#2A1F14] text-[#F4EBD9] px-4 py-2 rounded-full text-sm flex items-center gap-2 hover:bg-[#8B3A2A] transition">
                  <Upload size={14} /> Import Goodreads
                </button>
                <button onClick={() => setShowAdd(true)} className="border border-[#2A1F14] px-4 py-2 rounded-full text-sm flex items-center gap-2 hover:bg-[#2A1F14] hover:text-[#F4EBD9] transition">
                  <Plus size={14} /> Add a book
                </button>
              </div>
            </div>
          ) : grouped.length === 0 ? (
            <p className="text-center text-[#6B5840] italic py-12">Nothing matches "{q}".</p>
          ) : (
            <div className="divide-y divide-[#2A1F14]/10">
              {grouped.map(([author, list]) => {
                const open = openAuthors.has(author);
                const view = authorView(list);
                const hasGaps = view.series.some(s => s.gaps.length > 0);
                return (
                  <section key={author} className="py-4">
                    <button
                      onClick={() => toggleAuthor(author)}
                      className="w-full flex items-center justify-between gap-3 group text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {open ? <ChevronDown size={16} className="text-[#6B5840] shrink-0" /> : <ChevronRight size={16} className="text-[#6B5840] shrink-0" />}
                        <h2 className="display text-xl sm:text-2xl font-medium truncate group-hover:text-[#8B3A2A] transition">
                          {author}
                        </h2>
                        {hasGaps && <AlertTriangle size={13} className="text-[#8B3A2A] shrink-0" />}
                      </div>
                      <span className="text-xs text-[#6B5840] shrink-0">{list.length}</span>
                    </button>
                    {open && (
                      <div className="mt-4 space-y-5 pl-6">
                        {view.series.map(s => (
                          <div key={s.name}>
                            <div className="flex items-baseline justify-between mb-2">
                              <h3 className="display-soft italic text-[#6B5840]">{s.name}</h3>
                              {s.gaps.length > 0 && (
                                <span className="text-[10px] uppercase tracking-wider text-[#8B3A2A]">
                                  missing #{s.gaps.join(", ")}
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {s.list.map(b => <BookCard key={b.id} book={b} onRemove={removeBook} />)}
                              {s.gaps.map(n => (
                                <div key={`gap-${s.name}-${n}`} className="gap-card border border-dashed border-[#8B3A2A]/40 rounded-lg p-3 text-[#8B3A2A]/80">
                                  <div className="text-[10px] uppercase tracking-wider mb-1">missing</div>
                                  <div className="display italic">Book #{n}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                        {view.standalones.length > 0 && (
                          <div>
                            {view.series.length > 0 && <h3 className="display-soft italic text-[#6B5840] mb-2">Standalone</h3>}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {view.standalones.map(b => <BookCard key={b.id} book={b} onRemove={removeBook} />)}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </main>

        {/* Floating actions */}
        {!empty && (
          <div className="fixed bottom-5 right-5 flex flex-col gap-2 z-30">
            <button
              onClick={() => setShowAdd(true)}
              className="bg-[#2A1F14] text-[#F4EBD9] w-12 h-12 rounded-full flex items-center justify-center spine-shadow hover:bg-[#8B3A2A] transition"
              aria-label="Add book"
            >
              <Plus size={20} />
            </button>
          </div>
        )}

        {/* Add modal */}
        {showAdd && (
          <Modal onClose={() => setShowAdd(false)} title="Add a book">
            <div className="space-y-3">
              <Field label="Title" value={tT} onChange={setT} autoFocus />
              <Field label="Author" value={tA} onChange={setA} />
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2"><Field label="Series (optional)" value={tS} onChange={setS} /></div>
                <Field label="#" value={tN} onChange={setN} type="number" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-[#6B5840] hover:text-[#2A1F14]">Cancel</button>
                <button onClick={addBook} disabled={!tT.trim() || !tA.trim()} className="bg-[#2A1F14] text-[#F4EBD9] px-4 py-2 rounded-full text-sm disabled:opacity-30 hover:bg-[#8B3A2A] transition">
                  Add to shelf
                </button>
              </div>
            </div>
          </Modal>
        )}

        {/* Import modal */}
        {showImport && (
          <Modal onClose={() => setShowImport(false)} title="Import from Goodreads">
            <p className="text-sm text-[#6B5840] mb-4">
              On Goodreads: <span className="display-soft italic">My Books → Import and export → Export Library</span>. Drop the CSV here.
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
            {importMsg && <p className="text-sm mt-3 text-center text-[#8B3A2A]">{importMsg}</p>}
            <p className="text-xs text-[#6B5840] mt-4">
              Series names are pulled from titles like <em>Title (Series, #2)</em>. Owned Copies count is honored — three copies of <em>Frost and Starlight</em> stay as three.
            </p>
          </Modal>
        )}
      </div>
    </div>
  );
}

function BookCard({ book, onRemove }) {
  return (
    <div className="group relative bg-[#FBF6E9] border border-[#2A1F14]/10 rounded-lg p-3 spine-shadow hover:border-[#8B3A2A]/40 transition">
      <div className="display text-[15px] leading-snug pr-6">{book.title}</div>
      {book.seriesNumber != null && (
        <div className="text-[10px] uppercase tracking-wider text-[#6B5840] mt-1">#{book.seriesNumber}</div>
      )}
      <button
        onClick={() => onRemove(book.id)}
        className="absolute top-2 right-2 text-[#6B5840]/30 hover:text-[#8B3A2A] opacity-0 group-hover:opacity-100 transition"
        aria-label="Remove"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", autoFocus }) {
  return (
    <label className="block">
      <span className="text-[11px] uppercase tracking-wider text-[#6B5840]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        className="w-full mt-1 bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-md px-3 py-2 outline-none focus:border-[#8B3A2A] text-[15px]"
      />
    </label>
  );
}

function Modal({ onClose, title, children }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[#2A1F14]/40 backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[#F4EBD9] border border-[#2A1F14]/15 rounded-2xl max-w-md w-full p-6 spine-shadow">
        <div className="flex items-center justify-between mb-4">
          <h2 className="display text-xl">{title}</h2>
          <button onClick={onClose} className="text-[#6B5840] hover:text-[#2A1F14]"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
