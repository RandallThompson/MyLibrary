# MyLibrary v2 — what you need to do before deploying

You only have to do these steps once. Order matters: run the SQL migration before deploying the new code, or your existing app will hit a column-doesn't-exist error.

---

## 1) Run the database migration (5 min)

1. Open <https://supabase.com/dashboard/project/ytuasrnqlyjcnkzmkscj/sql/new>.
2. Open `supabase/migrations/002_v2_schema.sql` from this repo.
3. Copy the whole file, paste into the SQL editor, click **Run**.
4. You should see "Success. No rows returned." and (if you click Table Editor → books) the new columns: `additional_authors`, `notes`, `openlibrary_work_key`, `series_known_total`, `series_known_total_refreshed_at`, `normalized_key`. The `shelf` column is gone.

The migration is idempotent and safe to re-run. It:
- Adds the new columns.
- Strips trailing `(Series, #N)` from any existing titles.
- Backfills `normalized_key` for every row.
- Deletes duplicate rows for each user (keeps the earliest), then adds a unique constraint.
- Installs a trigger that keeps `normalized_key` in sync on every insert/update.
- Drops the `shelf` column (v2 has no shelves).

If something goes wrong: every step has `if not exists` / `if exists` guards and the dedup pass uses `created_at, id` ordering so it's deterministic. Worst case, the unique-index step fails because of a row count mismatch and the migration aborts — at which point you can rerun.

---

## 2) Enable Google OAuth in Supabase (10 min)

This is a real OAuth setup. You need a Google Cloud project to get a client ID & secret.

### A. Make a Google OAuth client

1. Go to <https://console.cloud.google.com/apis/credentials>. Make a new project ("MyLibrary") if needed.
2. Configure the OAuth consent screen if prompted: User type **External**, app name "MyLibrary", your email as support email, save. You can leave the app in "Testing" status — it'll work fine for personal use, with a 7-day token expiry. To make it permanent, hit "Publish app". For ≤100 users you don't need verification.
3. Back at Credentials → **Create Credentials** → **OAuth client ID** → Application type **Web application**. Name it "MyLibrary Supabase".
4. **Authorized redirect URIs** — paste this exact URL:
   ```
   https://ytuasrnqlyjcnkzmkscj.supabase.co/auth/v1/callback
   ```
5. Save. You'll get a **Client ID** and **Client Secret**. Copy both.

### B. Plug them into Supabase

1. Go to <https://supabase.com/dashboard/project/ytuasrnqlyjcnkzmkscj/auth/providers>.
2. Find **Google** in the provider list, click it.
3. Toggle **Enabled** on.
4. Paste the Client ID and Client Secret you just got from Google.
5. **Save**.

### C. Make sure existing email-magic-link accounts link to the Google account

Critical — without this, signing in with Google creates a new user and you'd see an empty library.

1. Same page (Auth → Providers), scroll to the top — there's a setting called **"Allow new users to link with existing identities"** or similar (the exact wording moves around in Supabase's UI). Make sure it's enabled.
2. If you don't see that option, go to **Auth → Settings** → look for **Identity Linking** → enable **Link identities by email**.
3. Test: sign in via Google in an incognito window using the same email you used for magic-link before. You should land in the same library.

If Supabase has split them into two users (it can happen if linking was off when you signed in), you'll need to manually merge: copy the books table rows from the new (empty) Google user_id back to your magic-link user_id with a SQL update, then delete the duplicate user from Auth → Users.

---

## 3) Install dependencies and deploy

The repo already has Vercel auto-deploy set up. After you commit:

```bash
npm install   # picks up dexie@4
git add .
git commit -m "v2: IDB layer, search v2, OpenLibrary, fuzzy import, settings"
git push
```

Vercel will deploy in ~90 seconds. The PWA service worker will replace itself the next time you open the app. (On iOS you may need to delete the home-screen icon and re-add it for the new manifest name "MyLibrary" to take effect.)

---

## Rollback

If something is broken in production:
1. **Code rollback:** in the Vercel dashboard, find the previous deploy, click "Promote to production".
2. **DB rollback:** the v2 migration is *additive plus a column drop* (`shelf`). To undo, you'd have to re-add `shelf` and remove the new columns. Practically: don't roll back the DB. Roll forward by fixing whatever's broken.

---

## Acceptance check (do these after deploy)

- [ ] Open the URL, sign in via Google. Land in the same library you had via magic link.
- [ ] Search "frost" → live dropdown shows results within the keystroke.
- [ ] Search "frost court" → falls through to token AND match, still works.
- [ ] Search "M" (single letter) → only books whose title or author **starts with** M.
- [ ] Add "Court of Mist and Fury" via the title field — OpenLibrary suggestions appear after ~300ms; clicking one fills Author + Series + #.
- [ ] Add a duplicate book (same title + author) → form blocks the save with "You already own this".
- [ ] Re-import the same Goodreads CSV → "Nothing to import" message.
- [ ] Re-import a slightly different CSV → fuzzy review modal lists the near-duplicates with merge / keep-both options.
- [ ] After import, the snackbar "Imported N books — Undo" appears at the bottom; clicking Undo within 10 minutes restores the prior state.
- [ ] Delete a book → snackbar "Removed Title — Undo"; clicking Undo restores it.
- [ ] Settings → Export library → CSV downloads. Open it in a text editor and verify the column headers match Goodreads format.
- [ ] Phone: Add to Home Screen. App opens fullscreen, named "MyLibrary".
- [ ] Turn airplane mode on, reopen the app → still loads, search/browse still works (writes will fail with a clear message).
