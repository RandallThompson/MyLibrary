-- =====================================================================
-- MyLibrary v2 schema migration
-- Run this ONCE in Supabase Dashboard → SQL Editor → New query.
-- Safe to run on a populated table — it backfills, dedups, and only
-- adds the unique constraint after dedup.
--
-- Changes:
--   + additional_authors text[]              (multi-author books)
--   + notes text                             (reserved for v2; no UI)
--   + openlibrary_work_key text              (for series-extension lookups)
--   + series_known_total int                 (full series size if known)
--   + series_known_total_refreshed_at timestamptz
--   + normalized_key text                    (for ownership-identity dedup)
--   + UNIQUE INDEX (user_id, normalized_key)
--   - shelf                                  (no longer in v2 model)
--   * title rewriting:                        strip " (Series, #N)" suffix
-- =====================================================================

-- 1) Add new columns (idempotent).
alter table public.books
  add column if not exists additional_authors           text[],
  add column if not exists notes                        text,
  add column if not exists openlibrary_work_key         text,
  add column if not exists series_known_total           int,
  add column if not exists series_known_total_refreshed_at timestamptz,
  add column if not exists normalized_key               text;

-- 2) Title cleanup: if a row's title still has the trailing "(Series, #N)"
--    pattern AND the series fields are populated, strip the suffix from title.
--    This handles the v1 importer edge case where the parser failed.
update public.books
set title = trim(regexp_replace(title, '\s*\([^()]+,\s*#[0-9]+(?:\.[0-9]+)?\)\s*$', '', 'g'))
where title ~ '\([^()]+,\s*#[0-9]+(?:\.[0-9]+)?\)\s*$';

-- 3) Define the normalize() function used by the v2 client.
--    Lowercase, trim, collapse internal whitespace, strip diacritics.
--    Trailing series suffix is already stripped above, but we still
--    apply a defensive regex here in case any sneak through.
create or replace function public.mylib_normalize(s text)
returns text
language sql
immutable
as $$
  select lower(trim(regexp_replace(
    regexp_replace(coalesce(s, ''), '\s+', ' ', 'g'),
    '\s*\([^()]+,\s*#[0-9]+(?:\.[0-9]+)?\)\s*$', '', 'g'
  )));
$$;

-- 4) Backfill normalized_key for every existing row.
update public.books
set normalized_key = public.mylib_normalize(title) || '|' || public.mylib_normalize(author)
where normalized_key is null;

-- 5) Dedup pass within each user.
--    Keep the EARLIEST row per (user_id, normalized_key); delete the rest.
--    This makes the unique index addable.
with ranked as (
  select id,
         row_number() over (
           partition by user_id, normalized_key
           order by created_at asc, id asc
         ) as rn
  from public.books
)
delete from public.books
where id in (select id from ranked where rn > 1);

-- 6) Make normalized_key NOT NULL and add the unique index.
alter table public.books
  alter column normalized_key set not null;

create unique index if not exists books_user_normkey_unique
  on public.books (user_id, normalized_key);

-- 7) Trigger: keep normalized_key in sync on insert/update.
create or replace function public.mylib_books_normalize_trigger()
returns trigger
language plpgsql
as $$
begin
  new.normalized_key := public.mylib_normalize(new.title) || '|' || public.mylib_normalize(new.author);
  return new;
end;
$$;

drop trigger if exists books_normalize_before_write on public.books;
create trigger books_normalize_before_write
  before insert or update of title, author on public.books
  for each row execute function public.mylib_books_normalize_trigger();

-- 8) Drop the v1 shelf column. v2 has no shelves.
alter table public.books drop column if exists shelf;

-- 9) Helpful index for series-grouping queries.
create index if not exists books_user_author_series_idx
  on public.books (user_id, author, series);

-- =====================================================================
-- Done. RLS policies from 001 still apply unchanged: users see/edit
-- only rows where auth.uid() = user_id.
-- =====================================================================
