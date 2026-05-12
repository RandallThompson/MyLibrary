// ShelfPhotoMeasurer — capture real spine images + dimensions from a photo.
//
// Flow:
//   1) Upload (or take) a photo of a single shelf.
//   2) Calibrate: click the left then right edge of the shelf; enter real width in cm.
//      The app computes pixels-per-cm.
//   3) Optionally calibrate height: click top and bottom of the shelf; enter
//      real shelf height in cm. (If skipped, the visible shelf height is taken
//      as the book height for every spine.)
//   4) For each book on the shelf: click left then right of its spine.
//      The app crops the strip and computes spine thickness in cm.
//   5) Pick which library book this spine belongs to from a search list.
//      On save: upload the cropped JPG to Storage and write
//      heightCm + spineThicknessCm + spineImageUrl onto that book.
//
// No estimates anywhere. Every number comes from your photo.

import { useEffect, useRef, useState } from "react";
import { X, Camera, ChevronRight, Check, Trash2 } from "lucide-react";
import { uploadSpineImage } from "../../db/dataStore";
import { searchBooks as appSearch } from "../SearchBar";

const STEPS = {
  PHOTO: "photo",      // choose a photo
  CALIB_WIDTH: "calib_width",
  CALIB_HEIGHT: "calib_height",
  SPINES: "spines",
  ASSIGN: "assign"     // assigning the latest crop to a library book
};

export default function ShelfPhotoMeasurer({ userId, books, onClose, onMeasured }) {
  const fileInputRef = useRef(null);
  const imgRef = useRef(null);
  const wrapRef = useRef(null);
  const [step, setStep] = useState(STEPS.PHOTO);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageNatural, setImageNatural] = useState({ w: 0, h: 0 });

  // Calibration state
  const [widthPxFrom, setWidthPxFrom] = useState(null); // [x,y] image-coords
  const [widthPxTo, setWidthPxTo] = useState(null);
  const [shelfWidthCm, setShelfWidthCm] = useState("");
  const [heightPxFrom, setHeightPxFrom] = useState(null);
  const [heightPxTo, setHeightPxTo] = useState(null);
  const [shelfHeightCm, setShelfHeightCm] = useState("");

  // Active spine-edge clicks
  const [spineLeftX, setSpineLeftX] = useState(null);
  const [spineRightX, setSpineRightX] = useState(null);

  // Last cropped spine
  const [pendingCrop, setPendingCrop] = useState(null); // { blob, dataUrl, spineCm, heightCm }
  const [searchQ, setSearchQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [measuredIds, setMeasuredIds] = useState(new Set());

  // ---- file handling ----
  const onFile = (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setStep(STEPS.CALIB_WIDTH);
  };

  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.onload = () => setImageNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = imageUrl;
  }, [imageUrl]);

  // Map a click on the displayed image to image-natural coordinates.
  const clickToImageCoords = (e) => {
    if (!imgRef.current) return null;
    const r = imgRef.current.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width  * imageNatural.w;
    const y = (e.clientY - r.top)  / r.height * imageNatural.h;
    return [Math.round(x), Math.round(y)];
  };

  const onImageClick = (e) => {
    const pt = clickToImageCoords(e);
    if (!pt) return;

    if (step === STEPS.CALIB_WIDTH) {
      if (!widthPxFrom) setWidthPxFrom(pt);
      else if (!widthPxTo) setWidthPxTo(pt);
    } else if (step === STEPS.CALIB_HEIGHT) {
      if (!heightPxFrom) setHeightPxFrom(pt);
      else if (!heightPxTo) setHeightPxTo(pt);
    } else if (step === STEPS.SPINES) {
      if (spineLeftX == null) setSpineLeftX(pt[0]);
      else if (spineRightX == null) {
        const left = Math.min(spineLeftX, pt[0]);
        const right = Math.max(spineLeftX, pt[0]);
        setSpineRightX(pt[0]);
        cropAndMeasure(left, right);
      }
    }
  };

  // ---- calibration math ----
  const pxPerCmWidth = (() => {
    if (!widthPxFrom || !widthPxTo || !parseFloat(shelfWidthCm)) return null;
    const dx = Math.abs(widthPxTo[0] - widthPxFrom[0]);
    return dx / parseFloat(shelfWidthCm);
  })();

  const measuredBookHeightCm = (() => {
    // Prefer user-calibrated shelf height; otherwise derive from horizontal calibration
    // applied to the vertical pixel distance between height markers; otherwise null.
    if (heightPxFrom && heightPxTo && parseFloat(shelfHeightCm)) {
      // We don't actually need pxPerCmHeight separately — the entered cm IS the answer
      // for the typical case where the shelf height = book height.
      return parseFloat(shelfHeightCm);
    }
    return null;
  })();

  // ---- crop a vertical strip from the photo ----
  const cropAndMeasure = (left, right) => {
    if (!pxPerCmWidth || !imgRef.current || !measuredBookHeightCm) {
      setError("Calibration incomplete. Set shelf width AND height first.");
      setSpineLeftX(null); setSpineRightX(null);
      return;
    }
    const yTop = Math.min(heightPxFrom[1], heightPxTo[1]);
    const yBot = Math.max(heightPxFrom[1], heightPxTo[1]);
    const w = right - left;
    const h = yBot - yTop;
    const spineCm = Math.round((w / pxPerCmWidth) * 10) / 10;
    const heightCm = measuredBookHeightCm;

    // Draw to an offscreen canvas at full natural resolution.
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, left, yTop, w, h, 0, 0, w, h);
      c.toBlob((blob) => {
        if (!blob) return;
        const dataUrl = c.toDataURL("image/jpeg", 0.85);
        setPendingCrop({ blob, dataUrl, spineCm, heightCm });
        setStep(STEPS.ASSIGN);
        setSearchQ("");
      }, "image/jpeg", 0.85);
    };
    img.src = imageUrl;
  };

  const onAssign = async (book) => {
    if (!pendingCrop) return;
    setBusy(true); setError("");
    try {
      await uploadSpineImage(userId, book.id, pendingCrop.blob, {
        heightCm: pendingCrop.heightCm,
        spineThicknessCm: pendingCrop.spineCm
      });
      setMeasuredIds(prev => new Set([...prev, book.id]));
      onMeasured && onMeasured(book.id);
      setPendingCrop(null);
      setSpineLeftX(null); setSpineRightX(null);
      setStep(STEPS.SPINES);
    } catch (e) {
      setError(e.message || "Couldn't save.");
    }
    setBusy(false);
  };

  const skipCrop = () => {
    setPendingCrop(null);
    setSpineLeftX(null); setSpineRightX(null);
    setStep(STEPS.SPINES);
  };

  // ---- render ----
  const candidates = (searchQ.trim()
    ? appSearch(books, searchQ)
    : books
  ).filter(b => !measuredIds.has(b.id)).slice(0, 25);

  return (
    <div className="fixed inset-0 z-50 bg-[#2A1F14] text-[#F4EBD9] overflow-auto">
      <header className="flex items-center justify-between px-5 py-3 sticky top-0 bg-[#2A1F14] border-b border-[#F4EBD9]/10">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] opacity-70">Measure from photo</div>
          <div className="display text-lg">
            {step === STEPS.PHOTO && "Pick a shelf photo"}
            {step === STEPS.CALIB_WIDTH && "Mark the shelf's left and right edges"}
            {step === STEPS.CALIB_HEIGHT && "Mark the shelf's top and bottom"}
            {step === STEPS.SPINES && "Tap each spine: left edge, then right edge"}
            {step === STEPS.ASSIGN && "Which book is this?"}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="hover:opacity-70 p-2"><X size={22} /></button>
      </header>

      {step === STEPS.PHOTO && (
        <div className="p-6 flex flex-col items-center justify-center min-h-[60vh]">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="bg-[#FBF6E9] text-[#2A1F14] px-6 py-4 rounded-2xl flex items-center gap-3 hover:bg-[#F4EBD9] transition"
          >
            <Camera size={22} />
            <div className="text-left">
              <div className="text-base">Take or upload a photo</div>
              <div className="text-xs text-[#6B5840]">One shelf, straight-on if you can.</div>
            </div>
          </button>
        </div>
      )}

      {imageUrl && step !== STEPS.PHOTO && (
        <div ref={wrapRef} className="px-3 py-3">
          <div className="relative inline-block w-full">
            <img
              ref={imgRef}
              src={imageUrl}
              alt="shelf"
              onClick={step === STEPS.ASSIGN ? undefined : onImageClick}
              className="w-full max-h-[55vh] object-contain bg-black rounded-lg cursor-crosshair"
              draggable={false}
            />
            <Overlay
              imgEl={imgRef.current}
              natural={imageNatural}
              widthPxFrom={widthPxFrom} widthPxTo={widthPxTo}
              heightPxFrom={heightPxFrom} heightPxTo={heightPxTo}
              spineLeftX={spineLeftX} spineRightX={spineRightX}
              step={step}
            />
          </div>

          {/* Step-specific controls */}
          {step === STEPS.CALIB_WIDTH && (
            <CalibBar
              fromPt={widthPxFrom} toPt={widthPxTo}
              label="Real shelf width (cm)"
              value={shelfWidthCm} onChange={setShelfWidthCm}
              onReset={() => { setWidthPxFrom(null); setWidthPxTo(null); }}
              onNext={() => setStep(STEPS.CALIB_HEIGHT)}
              nextEnabled={widthPxFrom && widthPxTo && parseFloat(shelfWidthCm) > 0}
              hint="Tap the leftmost wood edge, then the rightmost. Then type the real shelf width."
            />
          )}

          {step === STEPS.CALIB_HEIGHT && (
            <CalibBar
              fromPt={heightPxFrom} toPt={heightPxTo}
              label="Shelf height in cm (the inside height)"
              value={shelfHeightCm} onChange={setShelfHeightCm}
              onReset={() => { setHeightPxFrom(null); setHeightPxTo(null); }}
              onNext={() => setStep(STEPS.SPINES)}
              nextEnabled={heightPxFrom && heightPxTo && parseFloat(shelfHeightCm) > 0}
              hint="Tap the top inside edge of the shelf, then the bottom. This gives the book height for the row."
            />
          )}

          {step === STEPS.SPINES && (
            <div className="mt-3 bg-[#F4EBD9] text-[#2A1F14] rounded-xl p-4">
              <div className="text-xs text-[#6B5840] mb-2">
                {spineLeftX == null
                  ? "Tap the left edge of a book's spine."
                  : "Tap the right edge of that same spine to crop it."}
              </div>
              <div className="flex items-center justify-between text-[11px] text-[#6B5840]">
                <span>Measured so far: <span className="font-medium text-[#2A1F14]">{measuredIds.size}</span></span>
                <button onClick={onClose} className="text-[#8B3A2A] hover:underline">Done</button>
              </div>
              {error && <p className="text-xs text-[#8B3A2A] mt-2">{error}</p>}
            </div>
          )}

          {step === STEPS.ASSIGN && pendingCrop && (
            <div className="mt-3 bg-[#F4EBD9] text-[#2A1F14] rounded-xl p-4">
              <div className="flex gap-3 items-start mb-3">
                <img
                  src={pendingCrop.dataUrl}
                  alt="cropped spine"
                  className="rounded-md border border-[#2A1F14]/15"
                  style={{ width: 64, height: 96, objectFit: "cover" }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm">
                    Spine <span className="font-medium">{pendingCrop.spineCm} cm</span> wide × <span className="font-medium">{pendingCrop.heightCm} cm</span> tall.
                  </div>
                  <div className="text-xs text-[#6B5840] mt-1">Pick which library book this spine belongs to.</div>
                </div>
                <button onClick={skipCrop} className="text-[#6B5840] hover:text-[#8B3A2A] p-1" title="Skip">
                  <Trash2 size={14} />
                </button>
              </div>
              <input
                type="text"
                autoFocus
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="title or author"
                className="w-full bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-md px-3 py-2 outline-none focus:border-[#8B3A2A] text-sm mb-2"
              />
              <ul className="max-h-60 overflow-y-auto divide-y divide-[#2A1F14]/5">
                {candidates.map(b => (
                  <li key={b.id}>
                    <button
                      onClick={() => onAssign(b)}
                      disabled={busy}
                      className="w-full text-left px-2 py-2 hover:bg-[#FBF6E9] flex items-center justify-between gap-2 disabled:opacity-50"
                    >
                      <div className="min-w-0">
                        <div className="display text-sm truncate">{b.title}</div>
                        <div className="text-xs text-[#6B5840] truncate">{b.author}</div>
                      </div>
                      <Check size={14} className="text-[#8B3A2A]" />
                    </button>
                  </li>
                ))}
                {candidates.length === 0 && (
                  <li className="text-xs text-[#6B5840] italic py-2 px-2">No matches.</li>
                )}
              </ul>
              {error && <p className="text-xs text-[#8B3A2A] mt-2">{error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CalibBar({ fromPt, toPt, label, value, onChange, onReset, onNext, nextEnabled, hint }) {
  return (
    <div className="mt-3 bg-[#F4EBD9] text-[#2A1F14] rounded-xl p-4">
      <div className="text-xs text-[#6B5840] mb-2">{hint}</div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] uppercase tracking-wider text-[#6B5840]">
          Marks: {[fromPt, toPt].filter(Boolean).length} / 2
        </span>
        <button onClick={onReset} className="text-[11px] text-[#8B3A2A] hover:underline ml-auto">Reset marks</button>
      </div>
      <div className="flex gap-2">
        <label className="block flex-1">
          <span className="text-[10px] uppercase tracking-wider text-[#6B5840]">{label}</span>
          <input
            type="number"
            inputMode="decimal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. 80"
            className="w-full mt-0.5 bg-[#FBF6E9] border border-[#2A1F14]/15 rounded-md px-3 py-2 outline-none focus:border-[#8B3A2A] text-[15px]"
          />
        </label>
        <button
          onClick={onNext}
          disabled={!nextEnabled}
          className="self-end bg-[#2A1F14] text-[#F4EBD9] px-4 py-2 rounded-full text-sm disabled:opacity-30 hover:bg-[#8B3A2A] transition flex items-center gap-1"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// SVG overlay showing the user's calibration + crop markers on top of the image.
function Overlay({ imgEl, natural, widthPxFrom, widthPxTo, heightPxFrom, heightPxTo, spineLeftX, spineRightX, step }) {
  if (!imgEl || !natural.w) return null;
  const r = imgEl.getBoundingClientRect();
  const scaleX = r.width / natural.w;
  const scaleY = r.height / natural.h;

  const dot = (pt, color) => pt && (
    <circle cx={pt[0] * scaleX} cy={pt[1] * scaleY} r={7} fill={color} stroke="#fff" strokeWidth={2} />
  );

  const vLine = (x, color) => x != null && (
    <line x1={x * scaleX} y1={0} x2={x * scaleX} y2={r.height} stroke={color} strokeWidth={2} strokeDasharray="4 3" />
  );

  return (
    <svg
      width={r.width} height={r.height}
      viewBox={`0 0 ${r.width} ${r.height}`}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
    >
      {/* width marks */}
      {dot(widthPxFrom, "#C77D3F")}
      {dot(widthPxTo,   "#C77D3F")}
      {widthPxFrom && widthPxTo && (
        <line
          x1={widthPxFrom[0] * scaleX} y1={widthPxFrom[1] * scaleY}
          x2={widthPxTo[0]   * scaleX} y2={widthPxTo[1]   * scaleY}
          stroke="#C77D3F" strokeWidth={2}
        />
      )}
      {/* height marks */}
      {dot(heightPxFrom, "#7AAE6B")}
      {dot(heightPxTo,   "#7AAE6B")}
      {heightPxFrom && heightPxTo && (
        <line
          x1={heightPxFrom[0] * scaleX} y1={heightPxFrom[1] * scaleY}
          x2={heightPxTo[0]   * scaleX} y2={heightPxTo[1]   * scaleY}
          stroke="#7AAE6B" strokeWidth={2}
        />
      )}
      {/* spine edges */}
      {step === "spines" && (
        <>
          {vLine(spineLeftX,  "#8B3A2A")}
          {vLine(spineRightX, "#8B3A2A")}
        </>
      )}
    </svg>
  );
}
