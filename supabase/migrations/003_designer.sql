-- =====================================================================
-- MyLibrary v3 — bookshelf designer schema
-- Adds physical metadata to books, plus bookcases, arrangements, prep_jobs.
-- Idempotent: safe to re-run.
-- =====================================================================

-- 1) Physical-book metadata columns on books.
alter table public.books
  add column if not exists cover_url           text,
  add column if not exists dominant_color_hex  text,            -- e.g. "#a14532"
  add column if not exists height_cm           numeric(4,1),    -- physical book height
  add column if not exists spine_thickness_cm  numeric(4,2),    -- physical spine width
  add column if not exists page_count          int,
  add column if not exists binding             text,            -- 'paperback' | 'hardcover' | null
  add column if not exists metadata_fetched_at timestamptz;

-- 2) Bookcases — separate physical pieces of furniture.
create table if not exists public.bookcases (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,                 -- e.g. "IKEA Billy bedroom"
  shelf_count     int  not null check (shelf_count > 0 and shelf_count <= 20),
  shelf_width_cm  int  not null check (shelf_width_cm  > 0  and shelf_width_cm  <= 400),
  shelf_height_cm int  not null check (shelf_height_cm > 0  and shelf_height_cm <= 100),
  position_order  int  not null default 0,       -- for ordering bookcases in UI
  created_at      timestamptz not null default now()
);
create index if not exists bookcases_user_idx on public.bookcases (user_id);

alter table public.bookcases enable row level security;
drop policy if exists "bookcases_select_own" on public.bookcases;
drop policy if exists "bookcases_insert_own" on public.bookcases;
drop policy if exists "bookcases_update_own" on public.bookcases;
drop policy if exists "bookcases_delete_own" on public.bookcases;
create policy "bookcases_select_own" on public.bookcases for select using (auth.uid() = user_id);
create policy "bookcases_insert_own" on public.bookcases for insert with check (auth.uid() = user_id);
create policy "bookcases_update_own" on public.bookcases for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "bookcases_delete_own" on public.bookcases for delete using (auth.uid() = user_id);

-- 3) Arrangements — saved layouts on a specific bookcase.
-- layout_json shape: { shelves: [ { books: [ { book_id, orientation: "vertical"|"horizontal", x_cm, stack_index? } ] } ] }
create table if not exists public.arrangements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  bookcase_id uuid not null references public.bookcases(id) on delete cascade,
  name        text not null,                 -- e.g. "Rainbow"
  preset      text,                          -- preset id used: 'rainbow' | 'mono' | 'rhythm' | 'mix' | 'shuffle' | 'manual'
  layout_json jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists arrangements_user_idx on public.arrangements (user_id);
create index if not exists arrangements_bookcase_idx on public.arrangements (bookcase_id);

alter table public.arrangements enable row level security;
drop policy if exists "arrangements_select_own" on public.arrangements;
drop policy if exists "arrangements_insert_own" on public.arrangements;
drop policy if exists "arrangements_update_own" on public.arrangements;
drop policy if exists "arrangements_delete_own" on public.arrangements;
create policy "arrangements_select_own" on public.arrangements for select using (auth.uid() = user_id);
create policy "arrangements_insert_own" on public.arrangements for insert with check (auth.uid() = user_id);
create policy "arrangements_update_own" on public.arrangements for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "arrangements_delete_own" on public.arrangements for delete using (auth.uid() = user_id);

-- 4) Prep jobs — track the metadata-fetch progress per user.
create table if not exists public.prep_jobs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  status        text not null default 'pending', -- 'pending' | 'running' | 'complete' | 'error'
  total_books   int  not null default 0,
  done_books    int  not null default 0,
  error_message text,
  email_sent    boolean not null default false,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index if not exists prep_jobs_user_idx on public.prep_jobs (user_id);

alter table public.prep_jobs enable row level security;
drop policy if exists "prep_jobs_select_own" on public.prep_jobs;
drop policy if exists "prep_jobs_insert_own" on public.prep_jobs;
drop policy if exists "prep_jobs_update_own" on public.prep_jobs;
drop policy if exists "prep_jobs_delete_own" on public.prep_jobs;
create policy "prep_jobs_select_own" on public.prep_jobs for select using (auth.uid() = user_id);
create policy "prep_jobs_insert_own" on public.prep_jobs for insert with check (auth.uid() = user_id);
create policy "prep_jobs_update_own" on public.prep_jobs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "prep_jobs_delete_own" on public.prep_jobs for delete using (auth.uid() = user_id);
