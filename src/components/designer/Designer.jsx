// Designer — full-screen overlay.
//
// Flow:
//   1) On mount, check if metadata prep is done. If not, kick it off and show
//      a progress card. User can leave; on return, we resume.
//   2) Once prep is done (or we detect existing metadata for most books),
//      show: bookcase selector, preset picker, canvas, save button.
//   3) Layout is recomputed in-memory whenever preset/bookcase changes.
//   4) Drag-rearrange is supported. Saving stores the layout_json on
//      arrangements row.
//
// Color extraction happens lazily on canvas mount for any book missing
// dominant_color_hex (the prep job leaves it null on purpose; this is fast
// enough to do client-side as covers are visible).

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Save, RefreshCw } from "lucide-react";
import {
  listBookcases, listArrangements, saveArrangement, deleteArrangement,
  getActivePrepJob, getAllBooks
} from "../../db/dataStore";
import { supabase } from "../../supabaseClient";
import { runPreset, PRESETS } from "../../lib/layoutAlgorithms";
import { extractDominantColorHex } from "../../lib/colorExtract";
import { fillDimensions } from "../../lib/dimensions";
import { getOrStartPrepJob, runPrepJob } from "../../lib/prepJob";
import BookshelfCanvas from "./BookshelfCanvas";

export default function Designer({ userId, userEmail, onClose }) {
  const [phase, setPhase] = useState("loading"); // loading | prep | ready
  const [job, setJob] = useState(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [bookcases, setBookcases] = useState([]);
  const [activeBookcase, setActiveBookcase] = useState(null);
  const [books, setBooks] = useState([]);          // raw books with metadata
  const [presetId, setPresetId] = useState("rainbow");
  const [layout, setLayout] = useState({ shelves: [], overflow: [] });
  const [arrangements, setArrangements] = useState([]);
  const [saving, setSaving] = useState(false);
  const [arrangementName, setArrangementName] = useState("");
  const abortRef = useRef(null);

  // ---------- bootstrap ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [bcs, allBooks, activeJob] = await Promise.all([
        listBookcases(userId),
        getAllBooks(),
        getActivePrepJob(userId)
      ]);
      if (cancelled) return;
      setBookcases(bcs);
      setActiveBookcase(bcs[0] || null);

      // Resync from server to get any metadata columns added by prep.
      const { data: serverBooks } = await supabase.from("books").select("*");
      const serverMap = new Map((serverBooks || []).map(b => [b.id, b]));
      const merged = allBooks.map(b => {
        const s = serverMap.get(b.id) || {};
        return {
          ...b,
          coverUrl: s.cover_url || null,
          pageCount: s.page_count || null,
          binding: s.binding || null,
          heightCm: s.height_cm || null,
          spineThicknessCm: s.spine_thickness_cm || null,
          dominantColorHex: s.dominant_color_hex || null,
          metadataFetchedAt: s.metadata_fetched_at || null
        };
      });
      setBooks(merged);

      const ready = merged.length > 0 && merged.every(b => b.metadataFetchedAt);
      if (ready) {
        setPhase("ready");
      } else {
        // Kick off (or resume) prep.
        const newJob = activeJob || await getOrStartPrepJob(userId);
        setJob(newJob);
        setProgress({ done: newJob.done_books || 0, total: newJob.total_books || merged.filter(b => !b.metadataFetchedAt).length });
        setPhase("prep");
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        runPrepJob(newJob.id, userId, {
          signal: ctrl.signal,
          onProgress: (done, total) => setProgress({ done, total })
        }).then(async () => {
          if (cancelled) return;
          // Reload books with metadata.
          const { data: refreshed } = await supabase.from("books").select("*");
          const refreshedMap = new Map((refreshed || []).map(b => [b.id, b]));
          setBooks(prev => prev.map(b => {
            const s = refreshedMap.get(b.id) || {};
            return {
              ...b,
              coverUrl: s.cover_url || null,
              pageCount: s.page_count || null,
              binding: s.binding || null,
              heightCm: s.height_cm || null,
              spineThicknessCm: s.spine_thickness_cm || null,
              metadataFetchedAt: s.metadata_fetched_at || null
            };
          }));
          setPhase("ready");
        }).catch(e => { if (!cancelled) console.error(e); });
      }
    })();
    return () => { cancelled = true; if (abortRef.current) abortRef.current.abort(); };
  }, [userId]);

  // ---------- color extraction once books arrive with covers ----------
  useEffect(() => {
    if (phase !== "ready") return;
    const need = books.filter(b => b.coverUrl && !b.dominantColorHex);
    if (!need.length) return;
    let cancelled = false;
    (async () => {
      // Throttle: 4 in flight at once.
      const queue = [...need];
      const inflight = new Set();
      const updates = [];
      const launch = async () => {
        if (!queue.length) return;
        const b = queue.shift();
        const p = (async () => {
          const hex = await extractDominantColorHex(b.coverUrl);
          if (hex) updates.push({ id: b.id, hex });
        })();
        inflight.add(p);
        p.finally(() => { inflight.delete(p); if (!cancelled) launch(); });
      };
      for (let i = 0; i < 4; i++) launch();
      // Wait until queue drains.
      while ((queue.length || inflight.size) && !cancelled) {
        await Promise.race([...inflight, new Promise(r => setTimeout(r, 300))]);
      }
      if (cancelled || !updates.length) return;
      // Persist + update local.
      for (const u of updates) {
        await supabase.from("books").update({ dominant_color_hex: u.hex }).eq("id", u.id);
      }
      setBooks(prev => prev.map(b => {
        const u = updates.find(x => x.id === b.id);
        return u ? { ...b, dominantColorHex: u.hex } : b;
      }));
    })();
    return () => { cancelled = true; };
  }, [phase, books]);

  // ---------- arrangements list when bookcase changes ----------
  useEffect(() => {
    if (!activeBookcase) { setArrangements([]); return; }
    listArrangements(userId, activeBookcase.id).then(setArrangements).catch(() => {});
  }, [activeBookcase, userId]);

  // ---------- recompute layout on bookcase or preset change ----------
  useEffect(() => {
    if (phase !== "ready" || !activeBookcase) return;
    const filled = books.map(fillDimensions);
    const next = runPreset(presetId, filled, {
      shelfCount: activeBookcase.shelf_count,
      shelfWidthCm: activeBookcase.shelf_width_cm,
      shelfHeightCm: activeBookcase.shelf_height_cm
    });
    setLayout(next);
  }, [phase, activeBookcase, presetId, books]);

  const booksMap = useMemo(() => {
    const m = {};
    for (const b of books.map(fillDimensions)) m[b.id] = b;
    return m;
  }, [books]);

  // ---------- save arrangement ----------
  const save = async () => {
    if (!arrangementName.trim() || !activeBookcase) return;
    setSaving(true);
    try {
      const saved = await saveArrangement(userId, {
        bookcase_id: activeBookcase.id,
        name: arrangementName.trim(),
        preset: presetId,
        layout_json: layout
      });
      setArrangements(prev => [saved, ...prev]);
      setArrangementName("");
    } catch (e) {
      alert("Couldn't save: " + e.message);
    }
    setSaving(false);
  };

  const loadArrangement = (a) => {
    setLayout(a.layout_json);
    setPresetId(a.preset || "manual");
  };

  const removeArrangement = async (a) => {
    if (!confirm(`Delete arrangement "${a.name}"?`)) return;
    await deleteArrangement(a.id);
    setArrangements(prev => prev.filter(x => x.id !== a.id));
  };

  // ---------- render ----------
  return (
    <div className="fixed inset-0 z-40 bg-[#F4EBD9] overflow-auto">
      <header className="max-w-5xl mx-auto px-5 pt-6 pb-4 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-[#6B5840]">Bookshelf Designer</div>
          <h1 className="display text-3xl">Arrange the shelf.</h1>
        </div>
        <button onClick={onClose} className="text-[#6B5840] hover:text-[#2A1F14]" aria-label="Close">
          <X size={22} />
        </button>
      </header>

      <main className="max-w-5xl mx-auto px-5 pb-32">
        {phase === "loading" && <p className="text-[#6B5840] italic">Loading…</p>}

        {phase === "prep" && (
          <PrepCard progress={progress} userEmail={userEmail} />
        )}

        {phase === "ready" && bookcases.length === 0 && (
          <NoBookcases />
        )}

        {phase === "ready" && bookcases.length > 0 && activeBookcase && (
          <>
            <Toolbar
              bookcases={bookcases}
              activeBookcase={activeBookcase}
              onChangeBookcase={setActiveBookcase}
              presetId={presetId}
              onChangePreset={setPresetId}
            />

            <div className="my-6">
              <BookshelfCanvas
                bookcase={activeBookcase}
                books={booksMap}
                layout={layout}
                onLayoutChange={setLayout}
              />
            </div>

            {layout.overflow && layout.overflow.length > 0 && (
              <p className="text-xs text-[#8B3A2A] italic mb-4">
                {layout.overflow.length} {layout.overflow.length === 1 ? "book doesn't" : "books don't"} fit on this bookcase.
                Try a wider shelf or fewer books.
              </p>
            )}

            <SaveBar
              arrangementName={arrangementName}
              setArrangementName={setArrangementName}
              onSave={save}
              saving={saving}
              arrangements={arrangements}
              onLoad={loadArrangement}
              onRemove={removeArrangement}
            />
          </>
        )}
      </main>
    </div>
  );
}

function PrepCard({ progress, userEmail }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-2xl p-6 spine-shadow max-w-md">
      <div className="flex items-center gap-2 mb-2">
        <RefreshCw size={16} className="text-[#8B3A2A] animate-spin" />
        <h2 className="display text-xl">Getting your library ready.</h2>
      </div>
      <p className="text-sm text-[#6B5840] mb-4">
        Looking up covers and dimensions for each book. You can leave this page —
        when prep is done we'll email <span className="text-[#2A1F14] font-medium">{userEmail}</span>.
      </p>
      <div className="bg-[#F4EBD9] rounded-full h-2 overflow-hidden">
        <div className="h-full bg-[#8B3A2A] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-[#6B5840] mt-2">
        {progress.done} of {progress.total} ({pct}%)
      </p>
    </div>
  );
}

function NoBookcases() {
  return (
    <div className="bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-2xl p-6 spine-shadow max-w-md">
      <h2 className="display text-xl mb-2">Add a bookcase first.</h2>
      <p className="text-sm text-[#6B5840]">
        Open Settings → Bookcases and add the dimensions of a real bookcase you own.
        Then come back here to design how to arrange it.
      </p>
    </div>
  );
}

function Toolbar({ bookcases, activeBookcase, onChangeBookcase, presetId, onChangePreset }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[#6B5840] mb-1.5">Bookcase</div>
        <div className="flex flex-wrap gap-2">
          {bookcases.map(b => (
            <button
              key={b.id}
              onClick={() => onChangeBookcase(b)}
              className={`px-3 py-1.5 rounded-full text-xs border transition ${
                activeBookcase.id === b.id
                  ? "bg-[#2A1F14] text-[#F4EBD9] border-[#2A1F14]"
                  : "border-[#2A1F14]/20 hover:border-[#8B3A2A]"
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-wider text-[#6B5840] mb-1.5">Layout</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => onChangePreset(p.id)}
              title={p.hint}
              className={`px-3 py-1.5 rounded-full text-xs border transition ${
                presetId === p.id
                  ? "bg-[#2A1F14] text-[#F4EBD9] border-[#2A1F14]"
                  : "border-[#2A1F14]/20 hover:border-[#8B3A2A]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SaveBar({ arrangementName, setArrangementName, onSave, saving, arrangements, onLoad, onRemove }) {
  return (
    <div className="space-y-4">
      <div className="bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-lg p-3">
        <div className="text-[10px] uppercase tracking-wider text-[#6B5840] mb-1.5">Save this arrangement</div>
        <div className="flex gap-2">
          <input
            type="text"
            value={arrangementName}
            onChange={(e) => setArrangementName(e.target.value)}
            placeholder='e.g. "Rainbow living room"'
            className="flex-1 bg-[#F4EBD9] border border-[#2A1F14]/15 rounded-md px-3 py-2 outline-none focus:border-[#8B3A2A] text-sm"
          />
          <button
            onClick={onSave}
            disabled={saving || !arrangementName.trim()}
            className="bg-[#2A1F14] text-[#F4EBD9] px-4 py-2 rounded-full text-sm flex items-center gap-2 disabled:opacity-30 hover:bg-[#8B3A2A] transition"
          >
            <Save size={14} /> {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {arrangements.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#6B5840] mb-2">Saved arrangements</div>
          <ul className="space-y-1">
            {arrangements.map(a => (
              <li key={a.id} className="flex items-center justify-between gap-3 bg-[#FBF6E9] border border-[#2A1F14]/10 rounded-md px-3 py-2">
                <button onClick={() => onLoad(a)} className="display text-sm hover:text-[#8B3A2A] truncate text-left flex-1">
                  {a.name}
                </button>
                <span className="text-[10px] uppercase tracking-wider text-[#6B5840]">{a.preset || "manual"}</span>
                <button onClick={() => onRemove(a)} className="text-[#6B5840] hover:text-[#8B3A2A]">×</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
