-- Tiny (~8px-wide) base64 WebP placeholder for the persona pickers, computed
-- once at upload (ffmpeg) and shown by next/image (placeholder="blur") while
-- the real card image loads. Nullable: pre-existing rows are backfilled by
-- `aiugc persona sync-catalog`; rows whose bytes never decoded stay null and
-- the card simply has no placeholder.
ALTER TABLE public.persona_images ADD COLUMN blur_data_url text;
