-- Supabase default privileges can grant ALL to service_role at CREATE TABLE.
-- Clear those inherited grants before giving the assertion verifier only its
-- read, one-time insert and expired-replay cleanup operations.
BEGIN;
REVOKE ALL ON TABLE public.tenant_staff_assertion_replays FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,DELETE ON TABLE public.tenant_staff_assertion_replays TO service_role;
COMMIT;
