# MyLibrary

A quiet personal book library. Searchable, grouped by author, flags series gaps. Self-hosted on Supabase + Vercel for $0/month.

The bookstore moment: type three letters, see whether you own the book.

---

## What's here

- React + Vite frontend, Tailwind for styles.
- Supabase for auth (magic link + Google) and the `books` table.
- IndexedDB (Dexie) cache for instant, offline reads.
- PWA-installable on iOS and Android.

For the architecture, read [`DESIGN.md`](./DESIGN.md).
For deployment & migration, read [`MIGRATION.md`](./MIGRATION.md).

---

## Local dev

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. Sign in with your email, click the magic link, you're in.

The Supabase URL and publishable key are in `.env.local` (already populated). Don't commit anything ending in `.env.local` — it's gitignored.

---

## Cost

| Service | Free tier | Where you'd outgrow it |
|---|---|---|
| Supabase | 500 MB DB, 50K MAU | Realistically never, for a personal library. |
| Vercel | 100 GB bandwidth | Same. |
| **Total** | **$0/month** | |

---

## What's deliberately missing

- Book covers
- Reading statuses (want-to-read, currently reading, read)
- Ratings or reviews
- Custom shelves
- Lent/loaned tracking
- Reading goals
- Social features
- Edition/ISBN identity
- Barcode scanning

These are out by design. The point of MyLibrary is not to replace Goodreads' feature surface — it's to do one thing better: tell you if you own a book.
