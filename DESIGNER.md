# MyLibrary v3 — Bookshelf Designer setup

The designer adds a new top-right icon (the grid icon, between the wave and the gear). Tapping it opens a full-screen view where Abby can pick a bookcase, choose a layout, drag books around, and save arrangements.

You need to do three things on the backend before deploying.

---

## 1) Run the v3 schema migration

Open <https://supabase.com/dashboard/project/ytuasrnqlyjcnkzmkscj/sql/new>, paste `supabase/migrations/003_designer.sql`, hit **Run**.

It adds:
- new metadata columns on `books` (`cover_url`, `dominant_color_hex`, `height_cm`, `spine_thickness_cm`, `page_count`, `binding`, `metadata_fetched_at`)
- three new tables (`bookcases`, `arrangements`, `prep_jobs`) with RLS policies

Idempotent — safe to re-run.

---

## 2) Set up Resend for the "your library is ready" email

The prep job runs entirely on the client. When it finishes, it asks a Supabase Edge Function to send Abby an email. That function uses Resend.

### A. Get a Resend API key

1. Sign up at <https://resend.com> (free tier: 3,000 emails/month, 100/day — way more than needed).
2. Go to **API Keys** → **Create API Key**. Name it "MyLibrary". Copy the `re_...` key.
3. **Sender domain (optional but recommended)**: in **Domains** → **Add Domain**, add a domain you own. Follow Resend's DNS instructions (3 records). Without this, emails come from `onboarding@resend.dev`, which works for testing but lands in spam more often.

### B. Deploy the Edge Function

You need the Supabase CLI installed: <https://supabase.com/docs/guides/local-development/cli/getting-started>.

```bash
cd C:\Users\randy\Documents\repos\MyLibrary
supabase login          # one-time, opens a browser
supabase link --project-ref ytuasrnqlyjcnkzmkscj
supabase functions deploy library-ready-email --no-verify-jwt
```

Note: `--no-verify-jwt` is a workaround for letting the function read the JWT itself rather than rejecting requests. The function still checks the user identity inside.

### C. Set the function's secrets

Open <https://supabase.com/dashboard/project/ytuasrnqlyjcnkzmkscj/settings/functions> → **Edge Function Secrets** and add:

| Name | Value |
|---|---|
| `RESEND_API_KEY` | the `re_...` key from step A |
| `RESEND_FROM` | `MyLibrary <noreply@yourdomain.com>` if you set up a domain, else `MyLibrary <onboarding@resend.dev>` |
| `APP_URL` | `https://project-0mh6h.vercel.app` (your Vercel URL) |

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are auto-injected — don't add them.

---

## 3) Push and deploy

```bash
cd C:\Users\randy\Documents\repos\MyLibrary
npm install
git add .
git commit -m "v3: bookshelf designer"
git push
```

Vercel auto-deploys in ~90s. Then on the live site:

1. Open Settings → Bookcases → add at least one bookcase (name + shelf count + width + height in cm).
2. Click the grid icon in the header. The first time you do this, it kicks off the prep job. Most libraries finish in ~2 minutes (parallel API calls).
3. While prep runs, you can leave the page. When it's done, you'll get an email at the address you signed in with.

---

## How it actually works

**Phase 1 — metadata prep** (client-driven, persists progress to `prep_jobs`):
- For each book without `metadata_fetched_at`, in chunks of 6 in parallel:
  - Try Google Books API for cover URL, page count, binding, dimensions.
  - Fall back to OpenLibrary search.
  - Spine thickness estimated from page count if not directly available (paperback ~ pages × 0.0127 cm, hardcover ~ pages × 0.01016 cm).
  - Default height by binding (paperback 20 cm, hardcover 23 cm).
- Updates progress on the `prep_jobs` row after each chunk so the next session resumes.
- When all books processed, status flips to `complete` and the Edge Function fires.

**Phase 2 — color extraction** (lazy, also client-side):
- On designer mount, for any book that has a `cover_url` but no `dominant_color_hex`, downsample the cover to 64×64, run k-means with k=4, pick the most-saturated non-neutral cluster.
- Persists `dominant_color_hex` to the row so it's a one-time cost per book.
- Throttled to 4 in flight at once to avoid jank.

**Phase 3 — layout** (pure function, in-memory):
- 5 presets: Rainbow, Monochrome blocks, Height rhythm, Vertical + stacks, Shuffle.
- Each preset is a sort followed by a greedy left-to-right placement on shelves.
- Books that don't fit go in `layout.overflow` and a warning shows below the canvas.

**Phase 4 — drag-rearrange** (SVG pointer events):
- Pointer-down on a book starts a drag; on pointer-up we resolve the shelf index and approximate x position, splice the book into the target shelf, re-stake xCm contiguously.
- The drag UI is intentionally simple — no ghost preview. Adjust positions via repeated drags.

**Phase 5 — save** (Supabase row in `arrangements`):
- Named, per-bookcase. The full `layout_json` is stored.
- "Saved arrangements" list appears below the canvas. Click to load. × to delete.

---

## Things v3 deliberately does NOT do

- Edition awareness (we still collapse all editions into one entry — same as v2).
- Real spine colors (we use the cover's dominant color as a proxy — works in practice).
- Multi-bookcase arrangements (each saved arrangement is for one bookcase only).
- Cover images on the main library list (still text-only — bookstore-moment use case unchanged).
- Server-side image processing (saves us a Pro Supabase tier; client does it).
- Concurrent prep across multiple devices (whichever device is open processes; the job persists).

---

## Troubleshooting

**"Edge function returned 502"**: check the function logs at <https://supabase.com/dashboard/project/ytuasrnqlyjcnkzmkscj/functions> — likely your `RESEND_API_KEY` is wrong or `RESEND_FROM` references an unverified domain.

**Covers all show as a flat tan color**: dominant-color extraction needs CORS-enabled image URLs. Google Books images have CORS. OpenLibrary `covers.openlibrary.org` images do too. If a specific book is stuck on tan, it's probably a cover URL we couldn't load — check the network tab.

**Layout puts everything in overflow**: shelf width/height is too small for the books we have. Trade paperbacks are typically 20 cm tall — if you set `shelf_height_cm < 20` the dimensions don't fit. Set realistic dimensions in Settings → Bookcases.

**Email doesn't arrive**: it's likely in spam if you used the `onboarding@resend.dev` sender. Verify a domain in Resend for production deliverability. Check your `prep_jobs` row in Supabase — if `email_sent: true` we did send it.
