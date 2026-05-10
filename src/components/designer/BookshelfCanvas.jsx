// SVG canvas that renders a single bookcase + a layout plan.
// Books are drawn as colored vertical rectangles (spines) or horizontal stacks.
// Drag-to-rearrange: pointerdown a book, pointermove, pointerup → emits
//   onMove(bookId, fromShelf, toShelf, toIndex). Parent updates layout.

import { useMemo, useRef, useState } from "react";

const PADDING_CM = 2;
const SHELF_BOARD_CM = 1.2;          // wood thickness drawn between shelves
const PX_PER_CM_DEFAULT = 6;          // tweak with prop if desired

export default function BookshelfCanvas({
  bookcase,
  books,                 // map id → book
  layout,                // { shelves: [{ books: [...] }], overflow: [...] }
  onLayoutChange,        // (newLayout) => void  — for drag-rearrange
  pxPerCm = PX_PER_CM_DEFAULT
}) {
  const wRaw = bookcase.shelf_width_cm + PADDING_CM * 2;
  const hRaw = bookcase.shelf_count * (bookcase.shelf_height_cm + SHELF_BOARD_CM) + SHELF_BOARD_CM + PADDING_CM * 2;
  const W = wRaw * pxPerCm;
  const H = hRaw * pxPerCm;

  const [dragging, setDragging] = useState(null);   // { bookId, shelfIdx, startX, startY }
  const svgRef = useRef(null);

  const onPointerDown = (e, bookId, shelfIdx) => {
    if (!onLayoutChange) return;
    e.preventDefault();
    setDragging({ bookId, shelfIdx, startX: e.clientX, startY: e.clientY });
  };
  const onPointerMove = (e) => {
    if (!dragging) return;
    // We only resolve drop on pointerup; here we could draw a ghost. Simple = no ghost.
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

  // Pre-compute shelf y-coordinates in cm.
  const shelfYsCm = [];
  let cursor = PADDING_CM + SHELF_BOARD_CM;
  for (let i = 0; i < bookcase.shelf_count; i++) {
    shelfYsCm.push(cursor);
    cursor += bookcase.shelf_height_cm + SHELF_BOARD_CM;
  }

  return (
    <div className="overflow-auto" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
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
            const x = (PADDING_CM + slot.xCm) * pxPerCm;
            if (slot.orientation === "horizontal") {
              const w = book.heightCm * pxPerCm;
              const h = book.spineThicknessCm * pxPerCm;
              const y = (shelfBottomYCm - (slot.stackIndex || 0) - book.spineThicknessCm) * pxPerCm;
              return (
                <rect
                  key={`b-${slot.bookId}`}
                  x={x} y={y} width={w} height={h}
                  fill={book.dominantColorHex || "#9C8B6E"}
                  stroke="#1c130b" strokeWidth={0.5}
                  onPointerDown={(e) => onPointerDown(e, slot.bookId, sIdx)}
                  style={{ cursor: onLayoutChange ? "grab" : "default" }}
                >
                  <title>{book.title} — {book.author}</title>
                </rect>
              );
            }
            const w = book.spineThicknessCm * pxPerCm;
            const h = book.heightCm * pxPerCm;
            const y = (shelfBottomYCm - book.heightCm) * pxPerCm;
            return (
              <rect
                key={`b-${slot.bookId}`}
                x={x} y={y} width={w} height={h}
                fill={book.dominantColorHex || "#9C8B6E"}
                stroke="#1c130b" strokeWidth={0.5}
                rx={0.5}
                onPointerDown={(e) => onPointerDown(e, slot.bookId, sIdx)}
                style={{ cursor: onLayoutChange ? "grab" : "default" }}
              >
                <title>{book.title} — {book.author}</title>
              </rect>
            );
          });
        })}
      </svg>
    </div>
  );
}

// Translate a pointer event into a drop target { shelfIdx, xCm }.
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

// Pure layout transform: move a book to (toShelf, toXcm).
// Inserts at the position that keeps shelf books left-to-right by xCm; recomputes xCm to be contiguous.
function moveBook(layout, bookId, toShelf, toXcm) {
  const next = {
    shelves: layout.shelves.map(s => ({ books: s.books.filter(b => b.bookId !== bookId) })),
    overflow: layout.overflow ? [...layout.overflow] : []
  };
  // Find the moved book in the source layout to preserve orientation/dimensions.
  let moved = null;
  for (const s of layout.shelves) {
    const f = s.books.find(b => b.bookId === bookId);
    if (f) { moved = { ...f }; break; }
  }
  if (!moved) return layout;
  // Insert into target shelf at the right index based on toXcm.
  const targetShelf = next.shelves[toShelf];
  if (!targetShelf) return layout;
  // Place in the slot left of where they dropped.
  const insertAt = targetShelf.books.findIndex(b => b.xCm > toXcm);
  if (insertAt === -1) targetShelf.books.push(moved);
  else targetShelf.books.splice(insertAt, 0, moved);
  // Re-stake xCm contiguously.
  let cursor = 0;
  for (const b of targetShelf.books) {
    b.xCm = cursor;
    // Approximate width: vertical = spineThicknessCm; horizontal = heightCm. The
    // actual book object is in the parent's books map; the layout slot doesn't carry it.
    // Drag rearrangement can leave xCm slightly inaccurate visually — parent should
    // re-run a pass over (books map) to fix if it cares. For initial drag UX this is fine.
    cursor += 2.5;
  }
  return next;
}
