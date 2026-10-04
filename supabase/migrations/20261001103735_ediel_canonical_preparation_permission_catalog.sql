-- Canonical internal preparation is distinct from external delivery. Existing
-- Ediel commands already require this purpose, but it was absent from the
-- selectable canonical catalog. No role, user or override assignment is added.
-- Existing disabled entries and explicit current denies remain unchanged.
BEGIN;
INSERT INTO public.permissions(key,name,description,category,is_active)
VALUES ('communication.write','Förbereda kommunikation','Kan skapa och förbereda källbundna meddelanden; medger inte extern leverans.','Kommunikation',true)
ON CONFLICT(key) DO NOTHING;
COMMIT;
