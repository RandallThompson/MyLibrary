// BarcodeScanner — a full-screen modal that activates the rear camera,
// scans an ISBN, looks up Google Books, and emits either:
//   - "duplicate": book is already in the library → onAlreadyOwned(existingBook)
//   - "new":       not in library → onScanned({ title, author, isbn, ... })
//   - close:       user cancels.
//
// Falls back to a manual ISBN entry if BarcodeDetector isn't available.

import { useEffect, useRef, useState } from "react";
import { Camera, X, Keyboard } from "lucide-react";
import { barcodeDetectorAvailable, scanFromVideo, lookupISBN } from "../lib/barcode";
import { normalizedKey } from "../lib/normalize";

export default function BarcodeScanner({ books, onAlreadyOwned, onScanned, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const abortRef = useRef(null);
  const [status, setStatus] = useState("starting"); // starting | scanning | looking | error
  const [manualMode, setManualMode] = useState(!barcodeDetectorAvailable());
  const [manualIsbn, setManualIsbn] = useState("");
  const [error, setError] = useState("");

  // Start the camera + scanner.
  useEffect(() => {
    if (manualMode) return;
    let cancelled = false;
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus("scanning");
        const code = await scanFromVideo(videoRef.current, { signal: ctrl.signal });
        if (cancelled || !code) return;
        await processCode(code);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "Camera unavailable.");
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [manualMode]);

  const processCode = async (isbn) => {
    setStatus("looking");
    const result = await lookupISBN(isbn);
    if (!result || !result.title) {
      // Couldn't resolve. Hand the ISBN back so the user can fill in manually.
      onScanned({ title: "", author: "", isbn });
      return;
    }
    const key = normalizedKey(result.title, result.author);
    const existing = books.find(b => b.normalizedKey === key);
    if (existing) onAlreadyOwned(existing);
    else onScanned(result);
  };

  const submitManual = (e) => {
    e?.preventDefault();
    const cleaned = manualIsbn.replace(/[^\dX]/gi, "");
    if (cleaned.length < 10) { setError("ISBN should be 10 or 13 digits."); return; }
    processCode(cleaned);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#2A1F14] flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 text-[#F4EBD9]">
        <div className="text-[11px] uppercase tracking-[0.22em] opacity-80">Scan a book</div>
        <button onClick={onClose} aria-label="Close" className="hover:opacity-70">
          <X size={22} />
        </button>
      </div>

      {!manualMode ? (
        <>
          <div className="flex-1 relative bg-black overflow-hidden">
            <video
              ref={videoRef}
              playsInline
              muted
              className="absolute inset-0 w-full h-full object-cover"
            />
            {/* Targeting reticle */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[70%] h-[35%] border-2 border-[#F4EBD9]/80 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
            </div>
            <div className="absolute bottom-6 left-0 right-0 text-center text-[#F4EBD9]/80 text-sm">
              {status === "starting" && "Starting camera…"}
              {status === "scanning" && "Point at a book's barcode"}
              {status === "looking" && "Looking it up…"}
              {status === "error" && <span className="text-[#F4EBD9]">{error}</span>}
            </div>
          </div>
          <div className="p-4 flex items-center justify-center bg-[#2A1F14]">
            <button
              onClick={() => setManualMode(true)}
              className="text-[#F4EBD9]/80 hover:text-[#F4EBD9] text-xs uppercase tracking-wider flex items-center gap-1.5"
            >
              <Keyboard size={13} /> Type ISBN instead
            </button>
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-6">
          <div className="bg-[#FBF6E9] border border-[#F4EBD9]/30 rounded-2xl p-6 max-w-sm w-full">
            <h2 className="display text-xl mb-1 text-[#2A1F14]">Enter ISBN</h2>
            <p className="text-xs text-[#6B5840] mb-4">
              {barcodeDetectorAvailable()
                ? "Or scan via the camera instead."
                : "Your browser doesn't support live scanning. Type the ISBN from the back of the book."}
            </p>
            <form onSubmit={submitManual}>
              <input
                type="text"
                inputMode="numeric"
                value={manualIsbn}
                onChange={(e) => setManualIsbn(e.target.value)}
                placeholder="978…"
                autoFocus
                className="w-full bg-[#F4EBD9] border border-[#2A1F14]/15 rounded-md px-3 py-2 outline-none focus:border-[#8B3A2A] text-[15px] text-[#2A1F14]"
              />
              {error && <p className="text-xs text-[#8B3A2A] mt-2">{error}</p>}
              <div className="flex justify-between items-center mt-4">
                {barcodeDetectorAvailable() && (
                  <button
                    type="button"
                    onClick={() => { setManualMode(false); setError(""); }}
                    className="text-[11px] uppercase tracking-wider text-[#6B5840] flex items-center gap-1.5 hover:text-[#8B3A2A]"
                  >
                    <Camera size={13} /> Camera
                  </button>
                )}
                <button
                  type="submit"
                  className="bg-[#2A1F14] text-[#F4EBD9] px-4 py-2 rounded-full text-sm hover:bg-[#8B3A2A] transition ml-auto"
                >
                  Look up
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
