-- =====================================================================
-- MyLibrary v3.1 — spine photos + measured dimensions
-- =====================================================================

-- 1) New column for a per-book spine image URL.
alter table public.books
  add column if not exists spine_image_url text,
  add column if not exists dimensions_measured_at timestamptz; -- when user measured from a photo

-- 2) Storage bucket for spine images. Public-read so we can drop the URL into
--    an <image> tag. Writes are RLS-controlled.
insert into storage.buckets (id, name, public)
  values ('spines', 'spines', true)
  on conflict (id) do nothing;

-- 3) Storage RLS — each user can upload/read/delete files under their own
--    user_id folder. Bucket is public-read so the renderer can fetch images
--    without authenticated requests.
drop policy if exists "spines_insert_own" on storage.objects;
drop policy if exists "spines_update_own" on storage.objects;
drop policy if exists "spines_delete_own" on storage.objects;
drop policy if exists "spines_select_public" on storage.objects;

create policy "spines_select_public"
  on storage.objects for select
  using (bucket_id = 'spines');

create policy "spines_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'spines'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "spines_update_own"
  on storage.objects for update
  using (
    bucket_id = 'spines'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "spines_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'spines'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
