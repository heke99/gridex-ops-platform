-- Materialize the established cases.write catalog key for canonical replay.
-- The older customer-flow seeds have eight-digit names and are not replayed.
-- Existing metadata and all role, user and override assignments stay intact.
BEGIN;
INSERT INTO public.permissions(key,name,description,category)
VALUES ('cases.write','Ändra driftuppgifter','Kan skapa eller ändra driftuppgifter kopplade till kund.','Drift')
ON CONFLICT(key) DO NOTHING;
COMMIT;
