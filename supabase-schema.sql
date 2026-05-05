-- =====================================================================
-- The Shelf — Supabase schema
-- Paste this entire file into Supabase Dashboard → SQL Editor → New query
-- and click "Run". You only need to do this ONCE.
-- =====================================================================

-- Books table: every row belongs to a single auth.users row.
create table if not exists public.books (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  author        text not null,
  series        text,
  series_number numeric,
  shelf         text,
  created_at    timestamptz not null default now()
);

-- Fast lookups by user.
create index if not exists books_user_id_idx on public.books(user_id);

-- Optional: case-insensitive search helpers (cheap, helps if your library grows).
create index if not exists books_title_lower_idx  on public.books (lower(title));
create index if not exists books_author_lower_idx on public.books (lower(author));

-- =====================================================================
-- Row Level Security: each user only sees their own books.
-- This is THE critical piece. Without RLS, anyone with the publishable
-- key could read every book from every user.
-- =====================================================================
alter table public.books enable row level security;

-- Drop old policies if you re-run this file.
drop policy if exists "books_select_own" on public.books;
drop policy if exists "books_insert_own" on public.books;
drop policy if exists "books_update_own" on public.books;
drop policy if exists "books_delete_own" on public.books;

create policy "books_select_own"
  on public.books for select
  using (auth.uid() = user_id);

create policy "books_insert_own"
  on public.books for insert
  with check (auth.uid() = user_id);

create policy "books_update_own"
  on public.books for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "books_delete_own"
  on public.books for delete
  using (auth.uid() = user_id);
