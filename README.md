# The Shelf

A quiet personal library. Searchable, grouped by author, flags series gaps. Self-hosted on Supabase + Vercel for $0/month.

---

## What's in this folder

```
.
├── supabase-schema.sql        ← paste into Supabase SQL editor (one time)
├── package.json
├── vite.config.js              ← PWA + React + Tailwind
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── .env.example                ← template
├── .env.local                  ← already filled in with your Supabase keys
├── .gitignore
├── public/
│   ├── favicon.svg
│   ├── apple-touch-icon.png
│   ├── icon-192.png
│   ├── icon-512.png
│   └── icon-512-maskable.png
└── src/
    ├── main.jsx
    ├── App.jsx                 ← auth gate
    ├── Auth.jsx                ← magic link login
    ├── Library.jsx             ← the shelf itself
    ├── supabaseClient.js
    └── index.css
```

---

## Step 1 — Set up the Supabase database (5 min, one time)

1. Open your project: <https://supabase.com/dashboard/project/ytuasrnqlyjcnkzmkscj>
2. Sidebar → **SQL Editor** → **New query**.
3. Open `supabase-schema.sql` from this folder, copy the whole thing, paste, click **Run**.
   You should see "Success. No rows returned." That's it — table created with row-level security on.
4. Sidebar → **Authentication** → **Providers** → make sure **Email** is enabled (it is by default). Magic link works out of the box.
5. Sidebar → **Authentication** → **URL Configuration**:
   - **Site URL**: leave as `http://localhost:5173` for now. We'll change it after deploying.
   - **Redirect URLs**: add `http://localhost:5173/*` (later we'll add your Vercel URL too).

---

## Step 2 — Run it locally (3 min)

You'll need [Node.js](https://nodejs.org/) 18 or newer.

```bash
cd /path/to/this/folder
npm install
npm run dev
```

Open <http://localhost:5173>. Type your email, hit "Send me a sign-in link", check your inbox, click the link. You're in.

Try importing your Goodreads CSV (Goodreads → My Books → Import and export → Export Library). It'll take a few seconds for ~thousands of rows.

If something errors, open the browser dev console (F12) — Supabase prints clear error messages there.

---

## Step 3 — Deploy to Vercel (5 min, free)

1. Push this folder to a new GitHub repo (private is fine).
2. Go to <https://vercel.com> → **Add New Project** → import that repo.
3. Vercel auto-detects Vite. The only thing you need to set is **Environment Variables**:
   - `VITE_SUPABASE_URL` = `https://ytuasrnqlyjcnkzmkscj.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_YDfEojgdvIJca0Q629fVOA_x4IVjgFu`
4. Click **Deploy**. After ~90 seconds you'll have a URL like `the-shelf.vercel.app`.

**Then** — back in Supabase → Authentication → URL Configuration:
- **Site URL** → change to your Vercel URL (e.g. `https://the-shelf.vercel.app`)
- **Redirect URLs** → add `https://the-shelf.vercel.app/*`

(If you skip this step, magic-link emails will still point at localhost, which is a confusing footgun.)

---

## Step 4 — Install on your phone (30 seconds)

Because we shipped a PWA manifest and service worker:

**iPhone:**
1. Open the Vercel URL in Safari.
2. Tap the share icon → **Add to Home Screen**.
3. Tap the new "Shelf" icon. Opens fullscreen, no browser chrome.

**Android:**
1. Open the Vercel URL in Chrome.
2. Three-dot menu → **Install app** (or you'll see a prompt).
3. Done.

It looks and feels like a native app. Books still need network to load, but the UI shell works offline once cached.

---

## Adding more users (your "few people")

You don't need to do anything special. Send them the URL, they enter their email, they get their own private library. RLS policies in the schema guarantee they can only ever see their own books.

If you want to **restrict signups** to only people you invite (instead of the open world):
- Supabase → Authentication → Providers → Email → toggle **Allow new users to sign up** OFF.
- Then add users manually: Authentication → Users → **Add user** → invite by email.

---

## Costs (the "under $5/month" check)

| Service | Free tier | What kicks you to paid |
|---------|-----------|------------------------|
| Supabase | 500 MB DB, 50,000 monthly active users, 5 GB egress | Probably never for a personal library. 10,000 books is ~5 MB. |
| Vercel | 100 GB bandwidth, unlimited static deploys | Probably never for a personal app. |
| **Total** | **$0/month** | |

If you ever exceed Supabase's free tier, the next step is **Pro at $25/month** — which is over your budget. Realistically you won't hit it.

---

## Things you might want later (not built, but easy to add)

- **Barcode scanner** — wire up `quagga2` or use the browser's `BarcodeDetector` API to scan ISBNs with your phone camera and auto-fill title/author from the Open Library API.
- **CSV export** — back up your library to a CSV file. ~20 lines of code.
- **Multiple shelves per user** — currently flat library; could add a "shelves" table.
- **Real-time sync across devices** — `supabase.channel('books').on('postgres_changes', ...)`. Good if you add books on laptop and want them to appear on phone instantly without a refresh.

---

## Common questions

**"Can I share the publishable key publicly?"** Yes. That's what the `sb_publishable_*` prefix means — it's safe to commit to a public repo and bundle into your frontend. RLS policies are what protect your data. Never commit your `service_role` key (you don't have one in this project, and you don't need one).

**"What if I lose my Supabase password?"** Your books are tied to your auth user, not to a database password. As long as you can sign in with your email magic link, you're fine. Supabase project credentials are recoverable through their dashboard.

**"Can I delete my account?"** Supabase → Authentication → Users → find yours → delete. The `on delete cascade` in the schema means all your books go with you.
