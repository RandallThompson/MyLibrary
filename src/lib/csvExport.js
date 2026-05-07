// Export the user's library to a Goodreads-compatible CSV.
// Goodreads' export schema is fixed; we populate the columns we have and leave
// the rest blank so the file round-trips back into Goodreads (or back into us)
// without errors.

const HEADERS = [
  "Book Id",
  "Title",
  "Author",
  "Author l-f",
  "Additional Authors",
  "ISBN",
  "ISBN13",
  "My Rating",
  "Average Rating",
  "Publisher",
  "Binding",
  "Number of Pages",
  "Year Published",
  "Original Publication Year",
  "Date Read",
  "Date Added",
  "Bookshelves",
  "Bookshelves with positions",
  "Exclusive Shelf",
  "My Review",
  "Spoiler",
  "Private Notes",
  "Read Count",
  "Owned Copies"
];

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function authorLastFirst(name) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1).join(" ");
  return `${last}, ${rest}`;
}

// title with "(Series, #N)" appended when the book is part of a series.
// This makes the export round-trip — re-importing recovers the series link.
function titleWithSeriesSuffix(b) {
  if (!b.series) return b.title;
  if (b.seriesNumber == null) return `${b.title} (${b.series})`;
  return `${b.title} (${b.series}, #${b.seriesNumber})`;
}

export function exportToCSV(books) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  const lines = [HEADERS.map(csvEscape).join(",")];
  for (const b of books) {
    const row = {
      "Book Id": "",
      "Title": titleWithSeriesSuffix(b),
      "Author": b.author,
      "Author l-f": authorLastFirst(b.author),
      "Additional Authors": (b.additionalAuthors || []).join(", "),
      "ISBN": "",
      "ISBN13": "",
      "My Rating": "0",
      "Average Rating": "",
      "Publisher": "",
      "Binding": "",
      "Number of Pages": "",
      "Year Published": "",
      "Original Publication Year": "",
      "Date Read": "",
      "Date Added": today,
      "Bookshelves": "",
      "Bookshelves with positions": "",
      "Exclusive Shelf": "read",
      "My Review": "",
      "Spoiler": "",
      "Private Notes": b.notes || "",
      "Read Count": "",
      "Owned Copies": "1"
    };
    lines.push(HEADERS.map(h => csvEscape(row[h])).join(","));
  }
  return lines.join("\n");
}

// Trigger a browser download of the CSV.
export function downloadCSV(books, filename = "mylibrary_export.csv") {
  const csv = exportToCSV(books);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 0);
}
