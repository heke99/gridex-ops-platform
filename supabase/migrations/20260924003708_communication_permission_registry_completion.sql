-- Created by Supabase CLI 2.101.0. Materialize only the established catalog
-- keys (lib/rbac/catalog.ts); historical role lists did not create these rows.
-- Preserve every existing row, including disabled permissions and metadata.
-- No role/user/override assignments or historical grant-list replay.
BEGIN;
INSERT INTO public.permissions(key,name,description,category)
VALUES
 ('communication.read','Läsa kommunikation','Kan läsa kommunikationshistorik och utskick.','Kommunikation'),
 ('communication.send','Skicka kommunikation','Kan skicka meddelanden eller kommunikation.','Kommunikation')
ON CONFLICT(key) DO NOTHING;
COMMIT;
