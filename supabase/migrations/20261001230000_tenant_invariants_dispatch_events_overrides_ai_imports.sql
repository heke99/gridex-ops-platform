-- Tenant isolation invariants (scripts/sql/tenant-isolation-invariants.sql)
-- failed after the native/browser runs:
--   F-3   outbound_dispatch_events rows without company_id
--   F-3   user_permission_overrides rows without company_id
--   F-8/F-10 ai_list_imports unique (source_ediel_message_id) not tenant scoped
--
-- 1. outbound_dispatch_events: lib/cis/db-outbound.ts createOutboundDispatchEvent
--    (and admin writers) never set company_id. The owning outbound request is
--    the only authority: derive company_id from it, refuse a conflicting value
--    and refuse an event that cannot be attributed to a tenant. Existing rows
--    are backfilled from their request.
-- 2. user_permission_overrides: every reader (gridex_actor_has_company_permission,
--    retention/requested-change scoped permissions) applies a NULL-company row
--    only as a deny in every company. That is a deliberate platform-wide ban, so
--    the table is "mixed". A NULL-company row may never grant: enforced by a
--    check constraint, and the classification documents the NULL meaning.
-- 3. ai_list_imports: company_id is bound to the source message's company, so
--    the global unique key on the message id is replaced by the equivalent
--    tenant-scoped key (company_id, source_ediel_message_id).
BEGIN;

-- 1. outbound_dispatch_events
CREATE FUNCTION public.gridex_outbound_dispatch_event_company_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE owner uuid;
BEGIN
 IF NEW.outbound_request_id IS NOT NULL THEN
  SELECT r.company_id INTO owner FROM public.outbound_requests r WHERE r.id=NEW.outbound_request_id;
 END IF;
 IF owner IS NULL THEN RAISE EXCEPTION 'outbound_dispatch_event_tenant_required' USING ERRCODE='23514';END IF;
 IF NEW.company_id IS NOT NULL AND NEW.company_id IS DISTINCT FROM owner THEN RAISE EXCEPTION 'outbound_dispatch_event_tenant_mismatch' USING ERRCODE='23514';END IF;
 NEW.company_id:=owner;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.gridex_outbound_dispatch_event_company_v1() FROM PUBLIC,anon,authenticated,service_role;
UPDATE public.outbound_dispatch_events e SET company_id=r.company_id
 FROM public.outbound_requests r WHERE e.company_id IS NULL AND r.id=e.outbound_request_id AND r.company_id IS NOT NULL;
CREATE TRIGGER outbound_dispatch_events_tenant BEFORE INSERT OR UPDATE OF company_id,outbound_request_id ON public.outbound_dispatch_events
 FOR EACH ROW EXECUTE FUNCTION public.gridex_outbound_dispatch_event_company_v1();

-- 2. user_permission_overrides
ALTER TABLE public.user_permission_overrides ADD CONSTRAINT user_permission_overrides_global_deny_only
 CHECK (company_id IS NOT NULL OR effect='deny') NOT VALID;
ALTER TABLE public.user_permission_overrides VALIDATE CONSTRAINT user_permission_overrides_global_deny_only;
UPDATE public.platform_table_classification SET kind='mixed',
 rationale='Holds company-scoped overrides and platform-wide user denies.',
 null_company_meaning='NULL = a platform-wide deny for this user, applied in every company. Enforced by check user_permission_overrides_global_deny_only: a NULL-company row can never grant.',
 classified_at=now(),classified_by='migration:20261001230000'
 WHERE table_name='user_permission_overrides';

-- 3. ai_list_imports
CREATE FUNCTION public.gridex_ai_list_import_company_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $$
DECLARE owner uuid;
BEGIN
 SELECT m.company_id INTO owner FROM public.ediel_messages m WHERE m.id=NEW.source_ediel_message_id;
 IF owner IS NULL OR NEW.company_id IS DISTINCT FROM owner THEN RAISE EXCEPTION 'ai_list_import_tenant_mismatch' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.gridex_ai_list_import_company_v1() FROM PUBLIC,anon,authenticated,service_role;
DO $chk$BEGIN
 IF EXISTS(SELECT FROM public.ai_list_imports a JOIN public.ediel_messages m ON m.id=a.source_ediel_message_id WHERE a.company_id IS DISTINCT FROM m.company_id)
 THEN RAISE EXCEPTION 'ai_list_import_existing_tenant_mismatch';END IF;
END$chk$;
CREATE TRIGGER ai_list_imports_tenant BEFORE INSERT OR UPDATE OF company_id,source_ediel_message_id ON public.ai_list_imports
 FOR EACH ROW EXECUTE FUNCTION public.gridex_ai_list_import_company_v1();
ALTER TABLE public.ai_list_imports DROP CONSTRAINT ai_list_imports_source_ediel_message_id_key;
ALTER TABLE public.ai_list_imports ADD CONSTRAINT ai_list_imports_company_source_ediel_message_id_key UNIQUE (company_id,source_ediel_message_id);
COMMIT;
