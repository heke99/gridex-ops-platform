-- Created by Supabase CLI 2.101.0. The canonical fourteen-digit replay does
-- not execute the legacy eight-digit customer permission seed migrations.
-- Materialize the established catalog key without assigning it to any actor.
BEGIN;
INSERT INTO public.permissions(key,name,description,category)
VALUES ('customers.read','Läsa kunder','Kan se kundregister och kundkort.','Kunder')
ON CONFLICT(key) DO NOTHING;
COMMIT;
