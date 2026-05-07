# MyLibrary — design notes

A pocket-sized record of how this app works and why each piece is shaped the way it is. Update when you change things.

---

## What problem we're solving

The "do I own this?" moment in a bookstore. That's it. Everything else is feature creep.

Goodreads tries to be a reading tracker, a social network, a recommendation engine, and a library catalog all at once. As an ownership tool it's *bad*: it treats every printing of a book as a separate entry, the UI is a vertical scroll into infinity, and there's no fast "is this on my shelf?" answer.

Our north star: type three letters, see the answer. Ownership only. No editions. No statuses. No social.

---

## Architecture

```
┌──────────────────────────┐
│  React UI (Vite, PWA)    │
│  - Auth.jsx              │      ┌─────────────────┐
│  - Library.jsx           │      │  Supabase       │
│  - SearchBar / AddModal  │◄────►│  - auth         │
│  - ImportModal / Settings│      │  - books table  │
└────────────┬─────────────┘      │  - RLS by user  │
             │                    └─────────────────┘
             ▼
┌──────────────────────────┐      ┌─────────────────┐
│  src/db/dataStore.js     │      │ OpenLibrary API │
│  IDB-first reads         │◄────►│ - title search  │
│  Write-through to server │      │ - series total  │
└────────────┬─────────────┘      └─────────────────┘
             │
             ▼
┌──────────────────────────┐
│  IndexedDB (Dexie)       │
│  - books                 │
│  - snapshots (10-min TTL)│
└──────────────────────────┘
```

### Data flow

- **Reads** always come from IDB. The UI never calls Supabase directly.
- **Writes** go through Supabase first. On success, IDB is updated to match.
  - If offline at write time, we throw a "you're offline" error. We do *not* queue writes.
- **Sync**: on app load, if online, pull all rows from Supabase and replace IDB. After that, IDB is the source of truth for the session.
- **Pull-to-refresh** on touch devices triggers a re-sync.

This setup buys us:
- Instant search/browse (no network round-trip per keystroke).
- Offline browsing of an existing library.
- Bookstore-moment latency: zero.

It costs us:
- IDB and Supabase can diverge if a write fails partway. We mitigate with write-through ordering — IDB only updates on Supabase success.
- The user's "same library on every device" assumption requires a network round-trip on app open. Fine.

---

## Data model

`public.books` (Postgres):

| column | type | notes |
|---|---|---|
| id | uuid | PK |
| user_id | uuid | FK auth.users; RLS isolates rows by `auth.uid()` |
| title | text | NEVER includes "(Series, #N)" suffix — stripped at import & migration |
| author | text | primary author |
| additional_authors | text[] | from Goodreads' "Additional Authors" column |
| series | text | nullable |
| series_number | numeric | nullable; decimals allowed (3.1) |
| notes | text | reserved for future UI |
| openlibrary_work_key | text | "/works/OL12345W"; nullable |
| series_known_total | int | nullable; cached series size from OpenLibrary |
| series_known_total_refreshed_at | timestamptz | when we last asked OL |
| normalized_key | text | `lower(strip_series_suffix(title))\|lower(author)`; unique per user |
| created_at | timestamptz | default now() |

**Identity is `(user_id, normalized_key)`**. Unique index enforces it. A trigger keeps `normalized_key` synced on every write so the client doesn't have to send it.

**RLS policies** (from `001_initial.sql`): users can SELECT/INSERT/UPDATE/DELETE only rows where `auth.uid() = user_id`. No anon access.

---

## Search behavior

`searchBooks(books, query)` in `src/components/SearchBar.jsx`:

- **1 char**: title OR author **starts with** that char (case-insensitive). Browse-by-letter mode.
- **2+ chars**: substring match on `title + " " + author + " " + (series ?? "")`. If zero hits, **token AND** fallback: split on whitespace, every token must appear somewhere in the searchable string.

Why this shape: substring is "what people expect" but breaks on out-of-order words ("frost court" should still find *A Court of Frost and Starlight*). Token AND covers that without going to a full ranking algorithm. Single-char first-letter mode prevents "f" from returning every book containing the letter f.

Reads happen in-memory on the IDB cache. For 1k–5k books this is ~5ms per keystroke; no need for an index.

---

## Add flow

1. User opens the modal.
2. As they type the title (debounced 300ms, min 3 chars), we hit OpenLibrary's `/search.json` and show top 8 in a dropdown under the title field.
3. Picking a suggestion fills Title, Author, Series, Series #.
4. Author and Series fields are comboboxes seeded from existing library entries.
5. On Save:
   - If `(user_id, normalized_key)` already exists in IDB → form blocks the save.
   - Otherwise, we POST to Supabase. The DB trigger computes `normalized_key`. If the unique constraint fires on the server (race), we surface "you already own this".
   - On success, we kick off a background OpenLibrary lookup for `series_known_total` and update the row when it returns.

OpenLibrary calls fail silently. If the API is down, the user just gets a manual-entry form.

---

## Import flow

1. Take a snapshot of the current library (IDB + a `snapshots` table in IDB).
2. Parse CSV (preserves v1 logic — handles quoted fields with embedded newlines, the `(Series, #N)` suffix pattern).
3. Drop candidates whose normalized key already exists.
4. Pairwise Levenshtein similarity. Threshold > 0.85 and < 1.0. Compare against the existing library AND against other candidates in the same import.
5. If any near-dups: open the review modal. User picks merge (drop) or keep-both per pair.
6. Bulk-insert non-skipped rows.
7. Show "Imported N books — Undo" snackbar for 10 minutes.

Tapping Undo restores the snapshot: deletes everything in the library, reinserts the snapshotted rows. Snapshots auto-expire after 10 minutes.

---

## Series intelligence

OpenLibrary's series metadata is patchy. We don't trust it. Strategy:

- On a successful book add with a non-empty series, fire-and-forget a `lookupSeriesTotal({ author, series })` call. If we get an int, write it to `series_known_total` and timestamp.
- Gap detection (`src/lib/series.js`): if we have a known total, gaps = ints from 1..total not in owned set. Otherwise, gaps = ints between min(owned) and max(owned) not in owned set. Single owned book with no known total → no gaps (don't fabricate).
- "Refresh" button on each series header re-runs the lookup. We never overwrite a number the user typed by hand into the `#` field.

---

## Auth

Two methods, same account:
- **Magic link** via `supabase.auth.signInWithOtp` — passwordless, 5-min OTP, links session for 30 days.
- **Google OAuth** via `supabase.auth.signInWithOAuth({ provider: "google" })`.

Supabase merges identities by email so you get one user_id no matter how you sign in. The merging requires "Allow new users to link with existing identities" enabled on the project — see `MIGRATION.md`.

---

## PWA

`vite-plugin-pwa` handles manifest + service worker registration. We cache the app shell (JS/CSS/HTML/icons) so the UI loads offline. Books are not cached at the SW level — they live in IDB.

Manifest highlights:
- name: "MyLibrary"
- theme: `#2A1F14` (ink)
- display: standalone (fullscreen on phone)
- icons: 192/512 + 512 maskable

---

## Files map

```
supabase/
  migrations/
    002_v2_schema.sql        ← run this once
src/
  App.jsx                    auth gate + session state
  Auth.jsx                   magic link + Google
  Library.jsx                main view
  main.jsx, index.css        boilerplate
  supabaseClient.js          Supabase JS client (env-driven)
  components/
    SearchBar.jsx            sticky search + dropdown
    AddBookModal.jsx         OL autocomplete + comboboxes
    ImportModal.jsx          fuzzy review queue
    Settings.jsx             export, sign out, wipe
    Snackbar.jsx             undo banner
    Combobox.jsx             reusable autocomplete combobox
    Modal.jsx                modal shell
  db/
    dexie.js                 IDB schema
    dataStore.js             read/write/sync layer
  lib/
    normalize.js             identity normalization (matches SQL fn)
    openlibrary.js           OL API client
    similarity.js            Levenshtein + similarity
    series.js                grouping + gap detection
    csvExport.js             Goodreads-format CSV writer
public/
  favicon.svg, *.png         PWA icons
index.html                   title + apple-mobile-web-app-title
vite.config.js               PWA + manifest
```

---

## Things deliberately not built

In case you're tempted later: book covers, read/want-to-read statuses, ratings/reviews, custom shelves, lent/borrowed tracking, reading goals, public profiles, friends, recommendations, edition/ISBN identity, barcode scanning, offline-write queueing, multi-step undo, alternate view modes (by-series, by-recently-added). These are explicitly out per the v2 spec. If you find yourself wanting one of these, re-read why we said no.

Most of them undermine the bookstore moment. The rest reintroduce Goodreads' problems.
