// SVG canvas — renders a bookcase with realistic-ish book spines.
//
// Each vertical book: dominant color rectangle + title rendered vertically
// (rotated -90°) when the spine is wide enough to fit readable text. Thin
// spines just show the color band, like a real mass-market paperback sitting
// next to fatter volumes.
//
// Horizontal stacks render the cover image on the top face when we have a
// coverUrl, otherwise the dominant color block.
//
// Drag-to-rearrange: pointerdown a book, pointerup elsewhere → moveBook()
// reshapes the layout. Parent component receives onLayoutChange(next).

import { useRef, useState } from "react";

const PADDING_CM = 2;
const SHELF_BOARD_CM = 1.2;
const PX_PER_CM_DEFAULT = 6;
const MIN_SPINE_TEXT_CM = 1.3;  // skinnier than this and we don't try to render text

// Pick black or white text based on background luminance.
function readableTextOn(hex) {
  if (!hex) return "#F4EBD9";
  const c = hex.replace("#", "");
  if (c.length !== 6) return "#F4EBD9";
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 150 ? "#2A1F14" : "#F4EBD9";
}

function truncate(s, max) {
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export default function BookshelfCanvas({
  bookcase,
  books,
  layout,
  onLayoutChange,
  pxPerCm = PX_PER_CM_DEFAULT
}) {
  const wRaw = bookcase.shelf_width_cm + PADDING_CM * 2;
  const hRaw = bookcase.shelf_count * (bookcase.shelf_height_cm + SHELF_BOARD_CM) + SHELF_BOARD_CM + PADDING_CM * 2;
  const W = wRaw * pxPerCm;
  const H = hRaw * pxPerCm;

  const [dragging, setDragging] = useState(null);
  const svgRef = useRef(null);

  const onPointerDown = (e, bookId, shelfIdx) => {
    if (!onLayoutChange) return;
    e.preventDefault();
    setDragging({ bookId, shelfIdx, startX: e.clientX, startY: e.clientY });
  };
  const onPointerUp = (e) => {
    if (!dragging) return;
    const drop = pointToShelf(e, svgRef.current, bookcase, pxPerCm);
    if (drop && onLayoutChange) {
      const next = moveBook(layout, dragging.bookId, drop.shelfIdx, drop.xCm);
      onLayoutChange(next);
    }
    setDragging(null);
  };

  const shelfYsCm = [];
  let cursor = PADDING_CM + SHELF_BOARD_CM;
  for (let i = 0; i < bookcase.shelf_count; i++) {
    shelfYsCm.push(cursor);
    cursor += bookcase.shelf_height_cm + SHELF_BOARD_CM;
  }

  return (
    <div className="overflow-auto" onPointerUp={onPointerUp}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        style={{ display: "block", background: "#3B2A1C", borderRadius: 8 }}
      >
        {/* Shelf boards (horizontal) */}
        {Array.from({ length: bookcase.shelf_count + 1 }).map((_, i) => {
          const yCm = PADDING_CM + i * (bookcase.shelf_height_cm + SHELF_BOARD_CM);
          return (
            <rect
              key={`board-${i}`}
              x={PADDING_CM * pxPerCm}
              y={yCm * pxPerCm}
              width={bookcase.shelf_width_cm * pxPerCm}
              height={SHELF_BOARD_CM * pxPerCm}
              fill="#5A4029"
            />
          );
        })}

        {/* Side rails */}
        <rect x={0} y={0} width={PADDING_CM * pxPerCm} height={H} fill="#5A4029" />
        <rect x={W - PADDING_CM * pxPerCm} y={0} width={PADDING_CM * pxPerCm} height={H} fill="#5A4029" />

        {/* Books */}
        {layout.shelves.map((shelf, sIdx) => {
          const shelfYCm = shelfYsCm[sIdx];
          const shelfBottomYCm = shelfYCm + bookcase.shelf_height_cm;
          return shelf.books.map((slot, bIdx) => {
            const book = books[slot.bookId];
            if (!book) return null;

            const xPx = (PADDING_CM + slot.xCm) * pxPerCm;

            if (slot.orientation === "horizontal") {
              // Horizontal stack — the book is laid on its side.
              // We see the cover from above. Width = book height, height = spine thickness.
              const w = book.heightCm * pxPerCm;
              const h = book.spineThicknessCm * pxPerCm;
              const y = (shelfBottomYCm - (slot.stackIndex || 0) - book.spineThicknessCm) * pxPerCm;
              const fill = book.dominantColorHex || "#9C8B6E";
              return (
                <g
                  key={`b-${slot.bookId}`}
                  onPointerDown={(e) => onPointerDown(e, slot.bookId, sIdx)}
                  style={{ cursor: onLayoutChange ? "grab" : "default" }}
                >
                  <rect x={xPx} y={y} width={w} height={h} fill={fill} stroke="#1c130b" strokeWidth={0.5} />
                  {book.coverUrl && h > 6 && (
                    // Cover image on the top face of the laid-flat book.
                    <image
                      href={book.coverUrl}
                      x={xPx + 1}
                      y={y + 1}
                      width={w - 2}
                      height={h - 2}
                      preserveAspectRatio="xMidYMid slice"
                      crossOrigin="anonymous"
                    />
                  )}
                  <title>{book.title} — {book.author}</title>
                </g>
              );
            }

            // Vertical book (standard).
            const w = book.spineThicknessCm * pxPerCm;
            const h = book.heightCm * pxPerCm;
            const y = (shelfBottomYCm - book.heightCm) * pxPerCm;
            const fill = book.dominantColorHex || "#9C8B6E";
            // If we have a real photographed spine, render it instead of the
            // color-block + vertical title fallback. Ground truth wins.
            if (book.spineImageUrl) {
              return (
                <g
                  key={`b-${slot.bookId}`}
                  onPointerDown={(e) => onPointerDown(e, slot.bookId, sIdx)}
                  style={{ cursor: onLayoutChange ? "grab" : "default" }}
                >
                  <image
                    href={book.spineImageUrl}
                    x={xPx} y={y} width={w} height={h}
                    preserveAspectRatio="none"
                    crossOrigin="anonymous"
                  />
                  <rect x={xPx} y={y} width={w} height={h} fill="none" stroke="#1c130b" strokeWidth={0.5} />
                  <title>{book.title} — {book.author}</title>
                </g>
              );
            }

            // Decorative "embossed bands" near top and bottom for spine realism.
            const bandTopY = y + h * 0.12;
            const bandBotY = y + h * 0.85;
            const bandColor = darken(fill, 0.15);
            const showText = book.spineThicknessCm >= MIN_SPINE_TEXT_CM && h > 30;
            const textColor = readableTextOn(fill);
            const fontPx = Math.max(7, Math.min(11, w * 0.45));
            // Vertical text — rotate -90deg around the spine's midpoint.
            // We position the text along the spine, leaving the top/bottom bands clear.
            const textX = xPx + w / 2;
            const textY = y + h - 10;
            const maxCharFit = Math.floor((h - 30) / fontPx);
            const spineText = truncate(book.title, Math.max(6, maxCharFit));

            return (
              <g
                key={`b-${slot.bookId}`}
                onPointerDown={(e) => onPointerDown(e, slot.bookId, sIdx)}
                style={{ cursor: onLayoutChange ? "grab" : "default" }}
              >
                <rect x={xPx} y={y} width={w} height={h} fill={fill} stroke="#1c130b" strokeWidth={0.5} rx={0.5} />
                {/* embossed bands */}
                {h > 50 && (
                  <>
                    <rect x={xPx} y={bandTopY} width={w} height={Math.max(1, h * 0.012)} fill={bandColor} opacity={0.7} />
                    <rect x={xPx} y={bandBotY} width={w} height={Math.max(1, h * 0.012)} fill={bandColor} opacity={0.7} />
                  </>
                )}
                {/* vertical title */}
                {showText && (
                  <text
                    x={textX}
                    y={textY}
                    transform={`rotate(-90, ${textX}, ${textY})`}
                    fontSize={fontPx}
                    fontFamily="'Fraunces', Georgia, serif"
                    fill={textColor}
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {spineText}
                  </text>
                )}
                <title>{book.title} — {book.author}</title>
              </g>
            );
          });
        })}
      </svg>
    </div>
  );
}

function darken(hex, amount) {
  const c = (hex || "").replace("#", "");
  if (c.length !== 6) return "#000";
  const r = Math.max(0, Math.floor(parseInt(c.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.floor(parseInt(c.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.floor(parseInt(c.slice(4, 6), 16) * (1 - amount)));
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

function pointToShelf(e, svg, bookcase, pxPerCm) {
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const xPx = e.clientX - rect.left;
  const yPx = e.clientY - rect.top;
  const xCm = xPx / pxPerCm - PADDING_CM;
  const yCm = yPx / pxPerCm - PADDING_CM;
  if (xCm < 0 || xCm > bookcase.shelf_width_cm) return null;
  const stride = bookcase.shelf_height_cm + SHELF_BOARD_CM;
  const sIdx = Math.floor(yCm / stride);
  if (sIdx < 0 || sIdx >= bookcase.shelf_count) return null;
  return { shelfIdx: sIdx, xCm: Math.max(0, xCm) };
}

function moveBook(layout, bookId, toShelf, toXcm) {
  const next = {
    shelves: layout.shelves.map(s => ({ books: s.books.filter(b => b.bookId !== bookId) })),
    overflow: layout.overflow ? [...layout.overflow] : []
  };
  let moved = null;
  for (const s of layout.shelves) {
    const f = s.books.find(b => b.bookId === bookId);
    if (f) { moved = { ...f }; break; }
  }
  if (!moved) return layout;
  const targetShelf = next.shelves[toShelf];
  if (!targetShelf) return layout;
  const insertAt = targetShelf.books.findIndex(b => b.xCm > toXcm);
  if (insertAt === -1) targetShelf.books.push(moved);
  else targetShelf.books.splice(insertAt, 0, moved);
  let cursor = 0;
  for (const b of targetShelf.books) {
    b.xCm = cursor;
    cursor += 2.5;
  }
  return next;
}
 stride);
  if (sIdx < 0 || sIdx >= bookcase.shelf_count) return null;
  return { shelfIdx: sIdx, xCm: Math.max(0, xCm) };
}

function moveBook(layout, bookId, toShelf, toXcm) {
  const next = {
    shelves: layout.shelves.map(s => ({ books: s.books.filter(b => b.bookId !== bookId) })),
    overflow: layout.overflow ? [...layout.overflow] : []
  };
  let moved = null;
  for (const s of layout.shelves) {
    const f = s.books.find(b => b.bookId === bookId);
    if (f) { moved = { ...f }; break; }
  }
  if (!moved) return layout;
  const targetShelf = next.shelves[toShelf];
  if (!targetShelf) return layout;
  const insertAt = targetShelf.books.findIndex(b => b.xCm > toXcm);
  if (insertAt === -1) targetShelf.books.push(moved);
  else targetShelf.books.splice(insertAt, 0, moved);
  let cursor = 0;
  for (const b of targetShelf.books) {
    b.xCm = cursor;
    cursor += 2.5;
  }
  return next;
}
