-- SafeLife — server-side avatar size/type limits (audit 5.3)
--
-- WHY: avatar type (magic bytes) and size (5 MB) are checked only in the
-- app (mobile-app/utils/mediaValidation.ts). A tampered client holding its
-- own valid session could store arbitrary bytes in its own private avatar
-- slot. This enforces the same limits server-side on the storage bucket.
-- Bucket id 'avatars' verified in 20261022194500_security_lockdown.sql.
-- Mirrors the client limits exactly: 5 MB, JPEG/PNG/GIF/WebP only.
--
-- APPLY: Supabase Dashboard → SQL Editor → paste → Run
-- (project: safelife / xkfrsjtfbylhhrvibmxk, ap-south-1).
-- IDEMPOTENT: safe to re-run (sets the same values).
-- VERIFY: select id, file_size_limit, allowed_mime_types
--         from storage.buckets where id = 'avatars';

update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
where id = 'avatars';
