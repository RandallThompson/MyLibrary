// Settings page (modal). Contents:
//   - Sign out
//   - Export library (CSV download)
//   - Wipe library (typed "DELETE" confirmation; opens import after)
//   - App version + email
import { useState } from "react";
import { LogOut, Download, AlertTriangle, BookOpen, RefreshCw } from "lucide-react";
import Modal from "./Modal";
import BookcaseManager from "./designer/BookcaseManager";
import { downloadCSV } from "../lib/csvExport";
import { wipeLibrary, clearLocal, syncFromServer } from "../db/dataStore";
import { supabase } from "../supabaseClient";

const APP_VERSION = "v3.0.0";

export default function Settings({
  books,
  userId,
  userEmail,
  onClose,
  onWipeDone,
  onOpenImport
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const signOut = async () => {
    setBusy(true);
    await supabase.auth.signOut();
    await clearLocal();
    setBusy(false);
  };

  const exportCSV = () => {
    downloadCSV(books, "mylibrary_export.csv");
  };

  const refetchMetadata = async () => {
    if (!confirm(`Re-fetch covers and dimensions for all ${books.length} books? Opens the designer when ready.`)) return;
    setBusy(true);
    try {
      // Null out metadata_fetched_at so the prep job picks them up again.
      const { error: e } = await supabase
        .from("books")
        .update({ metadata_fetched_at: null })
        .eq("user_id", userId);
      if (e) throw e;
      setBusy(false);
      onClose();
      // Open the designer; it auto-starts the prep job when it sees pending books.
      window.location.reload();
    } catch (e) {
      setBusy(false);
      setError(e.message || "Couldn't reset.");
    }
  };

  const wipe = async () => {
    setError("");
    if (confirmText !== "DELETE") {
      setError('Type DELETE to confirm.');
      return;
    }
    setBusy(true);
    try {
      await wipeLibrary(userId);
      await syncFromServer({ force: true });
      setBusy(false);
      onWipeDone && onWipeDone();
      onClose();
      onOpenImport && onOpenImport();
    } catch (e) {
      setBusy(false);
      setError(e.message || "Couldn't wipe.");
    }
  };

  return (
    <Modal onClose={onClose} title="Settings" size="md">
      <div className="space-y-5">
        <div className="text-xs text-[#6B5840]">
          Signed in as <span className="text-[#2A1F14] font-medium">{userEmail}</span>
        </div>

        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-[#6B5840] mb-2">Library</h3>
          <button
            onClick={exportCSV}
            disabled={busy || !books.length}
            className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#FBF6E9] border border-[#2A1F14]/15 hover:border-[#8B3A2A] disabled:opacity-50 transition"
          >
            <Download size={16} className="text-[#6B5840]" />
            <div className="flex-1">
              <div className="text-sm">Export library</div>
              <div className="text-xs text-[#6B5840]">Download a Goodreads-format CSV ({books.length} books)</div>
            </div>
          </button>

          <button
            onClick={refetchMetadata}
            disabled={busy || !books.length}
            className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#FBF6E9] border border-[#2A1F14]/15 hover:border-[#8B3A2A] disabled:opacity-50 transition mt-2"
          >
            <RefreshCw size={16} className="text-[#6B5840]" />
            <div className="flex-1">
              <div className="text-sm">Re-fetch covers & dimensions</div>
              <div className="text-xs text-[#6B5840]">Look up every book again with the latest metadata sources</div>
            </div>
          </button>
        </section>

        <BookcaseManager userId={userId} />

        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-[#6B5840] mb-2">Account</h3>
          <button
            onClick={signOut}
            disabled={busy}
            className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#FBF6E9] border border-[#2A1F14]/15 hover:border-[#8B3A2A] disabled:opacity-50 transition"
          >
            <LogOut size={16} className="text-[#6B5840]" />
            <div className="text-sm">Sign out</div>
          </button>
        </section>

        <section>
          <h3 className="text-[10px] uppercase tracking-wider text-[#8B3A2A] mb-2 flex items-center gap-1.5">
            <AlertTriangle size={11} /> Danger zone
          </h3>
          {!confirmWipe ? (
            <button
              onClick={() => setConfirmWipe(true)}
              disabled={busy}
              className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg bg-[#FBF6E9] border border-[#8B3A2A]/30 hover:border-[#8B3A2A] disabled:opacity-50 transition"
            >
              <BookOpen size={16} className="text-[#8B3A2A]" />
              <div className="flex-1">
                <div className="text-sm text-[#8B3A2A]">Wipe library and re-import</div>
                <div className="text-xs text-[#6B5840]">Deletes every book, then opens import.</div>
              </div>
            </button>
          ) : (
            <div className="border border-[#8B3A2A]/40 rounded-lg p-3 bg-[#FBF6E9]">
              <div className="text-xs text-[#6B5840] mb-2">
                This deletes all {books.length} books. Type <span className="font-mono text-[#2A1F14]">DELETE</span> to confirm.
              </div>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="DELETE"
                className="w-full bg-[#F4EBD9] border border-[#2A1F14]/15 rounded-md px-3 py-2 outline-none focus:border-[#8B3A2A] text-[15px] font-mono"
              />
              {error && <p className="text-xs text-[#8B3A2A] mt-2">{error}</p>}
              <div className="flex justify-end gap-2 mt-3">
                <button
                  onClick={() => { setConfirmWipe(false); setConfirmText(""); setError(""); }}
                  className="px-3 py-1.5 text-xs text-[#6B5840] hover:text-[#2A1F14]"
                >
                  Cancel
                </button>
                <button
                  onClick={wipe}
                  disabled={busy || confirmText !== "DELETE"}
                  className="bg-[#8B3A2A] text-[#F4EBD9] px-3 py-1.5 rounded-full text-xs disabled:opacity-30 hover:bg-[#2A1F14] transition"
                >
                  {busy ? "Wiping…" : "Wipe everything"}
                </button>
              </div>
            </div>
          )}
        </section>

        <div className="text-[10px] uppercase tracking-wider text-[#6B5840]/60 text-center pt-2">
          MyLibrary {APP_VERSION}
        </div>
      </div>
    </Modal>
  );
}
