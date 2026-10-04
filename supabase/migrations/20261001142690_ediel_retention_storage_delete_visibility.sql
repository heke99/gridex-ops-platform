-- Qualified physical purge of transport raw MIME bytes
-- (lib/ediel/retention/blobLifecycleRetention.ts) removes the object with the
-- purging actor's own session so storage.objects RLS and
-- gridex_ediel_retention.storage_guard_v1 can check that actor. Storage
-- executes the removal as DELETE ... RETURNING, which PostgreSQL filters by
-- SELECT policies as well. ediel-files has no SELECT policy for authenticated,
-- so the row was invisible: the API answered {data:[],error:null}, nothing was
-- deleted, and neither the authorized purge nor a denied one ever reached the
-- DELETE guard.
--
-- Add the narrowest visibility that makes the existing DELETE policy and guard
-- effective: SELECT only while storage is executing an object delete
-- (storage.operation() = 'storage.object.delete_many', set by the storage
-- server, not by the client), only in ediel-files, and only for a tombstoned
-- target that public.ediel_storage_retention_target_v1 already authorizes for
-- the current purge actor. Download/list/sign operations stay invisible, so no
-- byte read is granted. The DELETE policy and the guard (current legal purge,
-- class permission, exact target hash/path) are unchanged.
BEGIN;
DO $pre$BEGIN
 IF to_regprocedure('storage.operation()') IS NULL OR to_regprocedure('public.ediel_storage_retention_target_v1(text)') IS NULL
  OR NOT EXISTS(SELECT FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='ediel_qualified_retention_storage_delete' AND polcmd='d')
  OR EXISTS(SELECT FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='ediel_qualified_retention_storage_delete_visibility')
 THEN RAISE EXCEPTION 'ediel_retention_storage_delete_visibility_predecessor_required';END IF;
END$pre$;
CREATE POLICY ediel_qualified_retention_storage_delete_visibility ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='ediel-files' AND storage.operation()='storage.object.delete_many'
  AND EXISTS(SELECT FROM public.ediel_storage_retention_target_v1(objects.name)));
COMMIT;
