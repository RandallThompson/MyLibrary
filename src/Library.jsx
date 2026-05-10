// Library.jsx v2 — main view.
//
// Notable changes vs v1:
//   - All reads come from IDB (via dataStore.getAllBooks). On mount we sync
//     from Supabase (if online) and replace the IDB cache.
//   - Search is delegated to <SearchBar>, which renders a live dropdown.
//     Picking a result scrolls to and expands that book.
//   - Add flow goes through <AddBookModal> (OpenLibrary autocomplete).
//   - Import goes through <ImportModal> (snapshot + fuzzy review + 10-min undo).
//   - Removal triggers a "Removed Title — Undo" snackbar with 5s undo.
//   - Settings reachable from the search bar — sign-out, export, wipe.
//   - Series intelligence: best-effort OpenLibrary lookup on save populates
//     series_known_total; gap detection respects the cached total when present.
//   - Pull-to-refresh on touch devices triggers a re-sync.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus, BookOpen, ChevronDown, ChevronRight, AlertTriangle,
  Library as LibraryIcon, Trash2, RefreshCw, Settings as SettingsIcon, Upload, Pencil, LayoutGrid
} from "lucide-react";
import {
  syncFromServer, getAllBooks, addBook as dsAddBook,
  removeBook as dsRemoveBook, restoreBook, bulkAdd, takeSnapshot,
  getActiveSnapshot, restoreFromSnapshot, updateBook
} from "./db/dataStore";
import { lookupSeriesTotal } from "./lib/openlibrary";
import { buildAuthorView, libraryStats, authorSortKey } from "./lib/series";
import { searchBooks } from "./components/SearchBar";

import SearchBar from "./components/SearchBar";
import AddBookModal from "./components/AddBookModal";
import ImportModal from "./components/ImportModal";
import Settings from "./components/Settings";
import Snackbar from "./components/Snackbar";
import Designer from "./components/designer/Designer";

export default function Library({ session }) {
  const userId = session.user.id;
  const userEmail = session.user.email;

  const [books, setBooks] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [q, setQ] = useState("");
  const [openAuthors, setOpenAuthors] = useState(new Set());
  const [highlightedId, setHighlightedId] = useState(null);

  const [showAdd, setShowAdd] = useState(false);
  const [editingBook, setEditingBook] = useState(null); // book object or null
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbbyNote, setShowAbbyNote] = useState(false);
  const [showDesigner, setShowDesigner] = useState(false);

  const [snackbar, setSnackbar] = useState(null); // { message, action, durationMs, kind, payload }
  const [refreshing, setRefreshing] = useState(false);

  const bookRefs = useRef(new Map());

  // ---------- Loading: sync from Supabase, then read IDB ----------
  const loadAll = useCallback(async ({ remote = true } = {}) => {
    if (remote && navigator.onLine) {
      const r = await syncFromServer({ force: true });
      if (!r.ok && r.reason !== "offline") {
        console.error("sync failed:", r.reason);
      }
    }
    const all = await getAllBooks();
    setBooks(all);
    setLoaded(true);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // online/offline listeners
  useEffect(() => {
    const goOn = () => { setOnline(true); loadAll({ remote: true }); };
    const goOff = () => setOnline(false);
    window.addEventListener("online", goOn);
    window.addEventListener("offline", goOff);
    return () => {
      window.removeEventListener("online", goOn);
      window.removeEventListener("offline", goOff);
    };
  }, [loadAll]);

  // ---------- Pull-to-refresh ----------
  // Lightweight: detect touchstart at scrollTop 0, drag down >70px, release → sync.
  useEffect(() => {
    let startY = null;
    const onStart = (e) => {
      if (window.scrollY > 0) return;
      startY = e.touches[0].clientY;
    };
    const onEnd = (e) => {
      if (startY == null) return;
      const dy = (e.changedTouches[0].clientY) - startY;
      startY = null;
      if (dy > 70) doRefresh();
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, []);

  const doRefresh = async () => {
    setRefreshing(true);
    await loadAll({ remote: true });
    setRefreshing(false);
  };

  // ---------- Add ----------
  const handleAdd = async (input) => {
    const saved = await dsAddBook(input, userId);
    setBooks(prev => [...prev, saved]);
    setShowAdd(false);
    // Best-effort series total in the background.
    if (saved.series && online) {
      lookupSeriesTotal({ author: saved.author, series: saved.series })
        .then(total => {
          if (total) {
            updateBook(saved.id, {
              ...saved,
              seriesKnownTotal: total,
              seriesKnownTotalRefreshedAt: new Date().toISOString()
            }).then(updated => {
              setBooks(prev => prev.map(b => b.id === updated.id ? updated : b));
            }).catch(() => {});
          }
        })
        .catch(() => {});
    }
  };

  // ---------- Edit ----------
  const handleEdit = async (input) => {
    // input has { id, title, author, series, seriesNumber }
    const existing = books.find(b => b.id === input.id);
    if (!existing) return;
    const updated = await updateBook(input.id, { ...existing, ...input });
    setBooks(prev => prev.map(b => b.id === updated.id ? updated : b));
    setEditingBook(null);
    // If series changed (new series, or had no total cached), re-fetch.
    if (online && updated.series && (existing.series !== updated.series || !updated.seriesKnownTotal)) {
      lookupSeriesTotal({ author: updated.author, series: updated.series })
        .then(total => {
          if (total) {
            updateBook(updated.id, {
              ...updated,
              seriesKnownTotal: total,
              seriesKnownTotalRefreshedAt: new Date().toISOString()
            }).then(u2 => {
              setBooks(prev => prev.map(b => b.id === u2.id ? u2 : b));
            }).catch(() => {});
          }
        })
        .catch(() => {});
    }
  };

  // ---------- Remove (with undo) ----------
  const handleRemove = async (id) => {
    const removed = await dsRemoveBook(id);
    setBooks(prev => prev.filter(b => b.id !== id));
    setSnackbar({
      message: `Removed ${removed.title}`,
      action: "Undo",
      durationMs: 5000,
      kind: "delete-undo",
      payload: removed
    });
  };

  // ---------- Snackbar action handlers ----------
  const onSnackbarAction = async (sb) => {
    if (sb.kind === "delete-undo" && sb.payload) {
      try {
        const restored = await restoreBook(sb.payload);
        setBooks(prev => [...prev, restored]);
      } catch (e) {
        console.error(e);
      }
    } else if (sb.kind === "import-undo") {
      try {
        const snap = await getActiveSnapshot();
        if (!snap) {
          alert("Snapshot expired (older than 10 minutes).");
        } else {
          await restoreFromSnapshot(snap.id, userId);
          await loadAll({ remote: false });
        }
      } catch (e) {
        console.error(e);
        alert("Couldn't undo: " + (e.message || "unknown error"));
      }
    }
    setSnackbar(null);
  };

  // ---------- Import ----------
  const handleImport = async (rows) => {
    await takeSnapshot("import"); // for undo
    const inserted = await bulkAdd(rows, userId);
    setBooks(prev => [...prev, ...inserted]);
    return inserted.length;
  };

  // ---------- Search → scroll to result ----------
  const onSelectFromSearch = (book) => {
    // Make sure the author is open.
    setOpenAuthors(prev => {
      const next = new Set(prev);
      next.add(book.author);
      return next;
    });
    setHighlightedId(book.id);
    // Wait a tick so the section can mount/expand.
    setTimeout(() => {
      const el = bookRefs.current.get(book.id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => setHighlightedId(null), 1800);
    }, 50);
  };

  // ---------- Filtered + grouped (uses same search routine for parity) ----------
  const filtered = useMemo(() => {
    if (!q.trim()) return books;
    const matches = searchBooks(books, q);
    return matches;
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

  useEffect(() => {
    if (q.trim()) setOpenAuthors(new Set(grouped.map(([a]) => a)));
  }, [q, grouped]);

  const stats = useMemo(() => libraryStats(books), [books]);

  const toggleAuthor = (a) => {
    setOpenAuthors(prev => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a); else next.add(a);
      return next;
    });
  };

  const refreshSeriesTotal = async (book) => {
    const total = await lookupSeriesTotal({
      author: book.author, series: book.series, workKey: book.openlibraryWorkKey
    });
    if (total) {
      // Update every owned book in this (author, series).
      const sibs = books.filter(b => b.author === book.author && b.series === book.series);
      for (const s of sibs) {
        try {
          const updated = await updateBook(s.id, {
            ...s,
            seriesKnownTotal: total,
            seriesKnownTotalRefreshedAt: new Date().toISOString()
          });
          setBooks(prev => prev.map(b => b.id === updated.id ? updated : b));
        } catch (e) { /* ignore individual failures */ }
      }
    } else {
      alert("OpenLibrary couldn't determine the size of this series.");
    }
  };

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
        .spine-shadow { box-shadow: 0 1px 0 rgba(43,31,20,0.04), 0 8px 20px -16px rgba(43,31,20,0.18); }
        .gap-card { background: repeating-linear-gradient(45deg, rgba(199,125,63,0.08) 0 6px, transparent 6px 12px); }
        @keyframes mlhighlight {
          0% { box-shadow: 0 0 0 0 rgba(139,58,42, 0.0); }
          30% { box-shadow: 0 0 0 4px rgba(139,58,42, 0.45); }
          100% { box-shadow: 0 0 0 0 rgba(139,58,42, 0.0); }
        }
        .ml-highlight { animation: mlhighlight 1.6s ease-out; }
        @keyframes wave {
          0%, 60%, 100% { transform: rotate(0deg); }
          10% { transform: rotate(14deg); }
          20% { transform: rotate(-8deg); }
          30% { transform: rotate(14deg); }
          40% { transform: rotate(-4deg); }
          50% { transform: rotate(10deg); }
        }
        .wave-emoji {
          animation: wave 3s ease-in-out infinite;
          transform-origin: 70% 70%;
        }
        @keyframes abbyFade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes abbyPop  { from { opacity: 0; transform: scale(0.94); } to { opacity: 1; transform: scale(1); } }
        .abby-fade { animation: abbyFade 250ms ease-out; }
        .abby-pop  { animation: abbyPop 320ms cubic-bezier(0.34, 1.3, 0.64, 1); }
      `}</style>

      <div className="paper relative">
        {/* Header */}
        <header className="max-w-3xl mx-auto px-5 pt-10 pb-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <LibraryIcon size={22} className="text-[#8B3A2A]" />
              <span className="text-xs uppercase tracking-[0.22em] text-[#6B5840]">Personal Library</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-[#6B5840]">
              <button
                onClick={() => setShowAbbyNote(true)}
                className="flex items-center gap-1.5 hover:text-[#8B3A2A] transition normal-case tracking-normal"
                aria-label="A note for Abby"
              >
                <span className="wave-emoji inline-block text-base leading-none">👋</span>
                <span className="text-[11px] uppercase tracking-wider">For Abby</span>
              </button>
              {!online && <span className="text-[#8B3A2A]">offline</span>}
              <button
                onClick={doRefresh}
                disabled={refreshing}
                className="hover:text-[#8B3A2A] flex items-center gap-1 disabled:opacity-40"
                title="Refresh from server"
              >
                <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
              </button>
              <button onClick={() => setShowDesigner(true)} className="hover:text-[#8B3A2A]" title="Bookshelf designer">
                <LayoutGrid size={14} />
              </button>
              <button onClick={() => setShowSettings(true)} className="hover:text-[#8B3A2A]">
                <SettingsIcon size={14} />
              </button>
            </div>
          </div>
          <h1 className="display text-4xl sm:text-5xl font-semibold">MyLibrary</h1>
          <p className="display-soft text-[#6B5840] mt-1 italic">Search before you buy. See what's missing.</p>
        </header>

        {/* Search */}
        <SearchBar
          books={books}
          q={q}
          setQ={setQ}
          onSelect={onSelectFromSearch}
          stats={stats}
          onOpenImport={() => setShowImport(true)}
          onOpenAdd={() => setShowAdd(true)}
          onOpenSettings={() => setShowSettings(true)}
        />

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
                const view = buildAuthorView(list);
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
                            <div className="flex items-baseline justify-between mb-2 gap-2">
                              <h3 className="display-soft italic text-[#6B5840]">
                                {s.name}
                                {s.knownTotal ? <span className="text-[10px] uppercase tracking-wider ml-2 text-[#6B5840]/70">of {s.knownTotal}</span> : null}
                              </h3>
                              <div className="flex items-baseline gap-2">
                                {s.gaps.length > 0 && (
                                  <span className="text-[10px] uppercase tracking-wider text-[#8B3A2A]">
                                    missing #{s.gaps.join(", ")}
                                  </span>
                                )}
                                <button
                                  onClick={() => refreshSeriesTotal(s.list[0])}
                                  className="text-[10px] uppercase tracking-wider text-[#6B5840]/70 hover:text-[#8B3A2A]"
                                  title="Re-check OpenLibrary for series size"
                                >
                                  refresh
                                </button>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {s.list.map(b => (
                                <BookCard
                                  key={b.id}
                                  book={b}
                                  onRemove={handleRemove}
                                  onEdit={setEditingBook}
                                  highlight={highlightedId === b.id}
                                  registerRef={(el) => {
                                    if (el) bookRefs.current.set(b.id, el);
                                    else bookRefs.current.delete(b.id);
                                  }}
                                />
                              ))}
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
                              {view.standalones.map(b => (
                                <BookCard
                                  key={b.id}
                                  book={b}
                                  onRemove={handleRemove}
                                  onEdit={setEditingBook}
                                  highlight={highlightedId === b.id}
                                  registerRef={(el) => {
                                    if (el) bookRefs.current.set(b.id, el);
                                    else bookRefs.current.delete(b.id);
                                  }}
                                />
                              ))}
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

        {/* Floating action */}
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

        {showAdd && (
          <AddBookModal
            books={books}
            onClose={() => setShowAdd(false)}
            onSave={handleAdd}
          />
        )}

        {editingBook && (
          <AddBookModal
            books={books}
            editing={editingBook}
            onClose={() => setEditingBook(null)}
            onSave={handleEdit}
          />
        )}

        {showImport && (
          <ImportModal
            books={books}
            onClose={() => setShowImport(false)}
            onImport={handleImport}
            onSnackbar={setSnackbar}
          />
        )}


        {showSettings && (
          <Settings
            books={books}
            userId={userId}
            userEmail={userEmail}
            onClose={() => setShowSettings(false)}
            onWipeDone={() => loadAll({ remote: false })}
            onOpenImport={() => setShowImport(true)}
          />
        )}

        {showAbbyNote && <AbbyNote onClose={() => setShowAbbyNote(false)} />}

        {showDesigner && (
          <Designer
            userId={userId}
            userEmail={userEmail}
            onClose={() => setShowDesigner(false)}
          />
        )}
      </div>

      <Snackbar
        snackbar={snackbar}
        onAction={onSnackbarAction}
        onDismiss={() => setSnackbar(null)}
      />
    </div>
  );
}

// A small, hidden surprise. No DB writes, no analytics — a private moment.
function AbbyNote({ onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A1F14]/40 backdrop-blur-sm abby-fade"
      onClick={onClose}
      role="dialog"
      aria-label="A note for Abby"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative bg-[#F4EBD9] border border-[#2A1F14]/15 rounded-2xl max-w-sm w-full p-10 spine-shadow text-center abby-pop"
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-[#6B5840]/50 hover:text-[#2A1F14] transition"
          aria-label="Close"
        >
          <X size={18} />
        </button>
        <div className="display text-3xl sm:text-4xl text-[#2A1F14] leading-tight">
          I love you, Beautiful!
        </div>
        <div className="text-2xl text-[#8B3A2A]/70 mt-5" aria-hidden="true">♡</div>
      </div>
    </div>
  );
}

function BookCard({ book, onRemove, onEdit, highlight, registerRef }) {
  return (
    <div
      ref={registerRef}
      className={`group relative bg-[#FBF6E9] border border-[#2A1F14]/10 rounded-lg p-3 spine-shadow hover:border-[#8B3A2A]/40 transition ${highlight ? "ml-highlight" : ""}`}
    >
      <div className="display text-[15px] leading-snug pr-12">{book.title}</div>
      {book.seriesNumber != null && (
        <div className="text-[10px] uppercase tracking-wider text-[#6B5840] mt-1">#{book.seriesNumber}</div>
      )}
      {book.additionalAuthors && book.additionalAuthors.length > 0 && (
        <div className="text-[10px] text-[#6B5840] mt-1 italic truncate">
          with {book.additionalAuthors.join(", ")}
        </div>
      )}
      <div className="absolute top-2 right-2 flex items-center gap-2 opacity-40 group-hover:opacity-100 transition">
        {onEdit && (
          <button
            onClick={() => onEdit(book)}
            className="text-[#6B5840]/40 hover:text-[#8B3A2A]"
            aria-label="Edit"
            title="Edit"
          >
            <Pencil size={13} />
          </button>
        )}
        <button
          onClick={() => onRemove(book.id)}
          className="text-[#6B5840]/40 hover:text-[#8B3A2A]"
          aria-label="Remove"
          title="Remove"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
