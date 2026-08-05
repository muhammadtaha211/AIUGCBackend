-- Public catalog copies of persona reference images. The `catalog` bucket is
-- the one PUBLIC storage bucket (see packages/core/src/storage.ts): persona
-- images are founder-curated catalog data (0007's RLS lets any signed-in user
-- read them), so the pickers serve a stable cacheable URL instead of signing.
-- Nullable: rows uploaded before the bucket existed are backfilled by
-- `aiugc persona sync-catalog`.
ALTER TABLE public.persona_images ADD COLUMN catalog_path text;
