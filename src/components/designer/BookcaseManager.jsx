// BookcaseManager — a section in Settings for adding/editing/removing bookcases.
// Each bookcase is a real piece of furniture with name, shelf count, and shelf size.

import { useEffect, useState } from "react";
import { Plus, Trash2, Edit3 } from "lucide-react";
import { listBookcases, createBookcase, updateBookcase, deleteBookcase } from "../../db/dataStore";

const DEFAULTS = { name: "", shelf_count: 5, shelf_width_cm: 80, shelf_height_cm: 30 };

export default function BookcaseManager({ userId }) {
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);  // null | bookcase id | "new"
  const [draft, setDraft] = useState(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = async () => {
    try { setItems(await listBookcases(userId)); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, [userId]);

  const startNew = () => { setEditing("new"); setDraft(DEFAULTS); setErr(""); };
  const startEdit = (b) => {
    setEditing(b.id);
    setDraft({
      name: b.name,
      shelf_count: b.shelf_count,
      shelf_width_cm: b.shelf_width_cm,
      shelf_height_cm: b.shelf_height_cm
    });
    setErr("");
  };
  const cancel = () => { setEditing(null); setErr(""); };

  const save = async () => {
    if (!draft.name.trim()) { setErr("Name is required."); return; }
    setBusy(true); setErr("");
    try {
      if (editing === "new") {
        await createBookcase(userId, {
          name: draft.name.trim(),
          shelf_count: parseInt(draft.shelf_count, 10),
          shelf_width_cm: parseInt(draft.shelf_width_cm, 10),
          shelf_height_cm: parseInt(draft.shelf_height_cm, 10),
          position_order: items.length
        });
      } else {
        await updateBookcase(editing, {
          name: draft.name.trim(),
          shelf_count: parseInt(draft.shelf_count, 10),
          shelf_width_cm: parseInt(draft.shelf_width_cm, 10),
          shelf_height_cm: parseInt(draft.shelf_height_cm, 10)
        });
      }
      setEditing(null);
      await load();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  };

  const remove = async (b) => {
    if (!confirm(`Delete "${b.name}"? Saved arrangements on this bookcase are also deleted.`)) return;
    setBusy(true);
    try { await deleteBookcase(b.id); await load(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <section>
      <h3 className="text-[10px] uppercase tracking-wider text-[#6B5840] mb-2">Bookcases</h3>

      {items.length === 0 && editing !== "new" && (
        <p className="text-xs text-[#6B5840] mb-3 italic">
          Add a real bookcase you own to use the designer.
        </p>
      )}

      <ul className="space-y-2">
        {items.map(b => (
          <li key={b.id} className="bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-lg p-3">
            {editing === b.id ? (
              <BookcaseForm draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} busy={busy} err={err} />
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm display">{b.name}</div>
                  <div className="text-[11px] text-[#6B5840]">
                    {b.shelf_count} shelves · {b.shelf_width_cm}cm wide · {b.shelf_height_cm}cm tall
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => startEdit(b)} className="text-[#6B5840] hover:text-[#8B3A2A]" title="Edit">
                    <Edit3 size={14} />
                  </button>
                  <button onClick={() => remove(b)} className="text-[#6B5840] hover:text-[#8B3A2A]" title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}

        {editing === "new" && (
          <li className="bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-lg p-3">
            <BookcaseForm draft={draft} setDraft={setDraft} onSave={save} onCancel={cancel} busy={busy} err={err} />
          </li>
        )}
      </ul>

      {editing == null && (
        <button
          onClick={startNew}
          className="mt-3 flex items-center gap-1.5 text-xs text-[#6B5840] hover:text-[#8B3A2A]"
        >
          <Plus size={13} /> Add a bookcase
        </button>
      )}
    </section>
  );
}

function BookcaseForm({ draft, setDraft, onSave, onCancel, busy, err }) {
  const set = (k) => (v) => setDraft(d => ({ ...d, [k]: v }));
  return (
    <div className="space-y-2">
      <Input label="Name" value={draft.name} onChange={set("name")} placeholder="IKEA Billy bedroom" />
      <div className="grid grid-cols-3 gap-2">
        <Input label="Shelves" type="number" value={draft.shelf_count} onChange={set("shelf_count")} />
        <Input label="Width cm" type="number" value={draft.shelf_width_cm} onChange={set("shelf_width_cm")} />
        <Input label="Height cm" type="number" value={draft.shelf_height_cm} onChange={set("shelf_height_cm")} />
      </div>
      {err && <p className="text-[11px] text-[#8B3A2A]">{err}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-[#6B5840] hover:text-[#2A1F14]">Cancel</button>
        <button
          onClick={onSave}
          disabled={busy}
          className="bg-[#2A1F14] text-[#F4EBD9] px-3 py-1.5 rounded-full text-xs disabled:opacity-30 hover:bg-[#8B3A2A]"
        >
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function Input({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-[#6B5840]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full mt-0.5 bg-[#F4EBD9] border border-[#2A1F14]/15 rounded-md px-2.5 py-1.5 outline-none focus:border-[#8B3A2A] text-[14px]"
      />
    </label>
  );
}
