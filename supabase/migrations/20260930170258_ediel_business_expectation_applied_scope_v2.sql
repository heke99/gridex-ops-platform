-- Supabase CLI migration new ediel_business_expectation_applied_scope_v2.
-- Apply only the newly qualified original request, never unrelated tenant watches.
BEGIN;
CREATE OR REPLACE FUNCTION gridex_business_expectations.applied_source_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE e uuid; original_id uuid; source_environment text;
BEGIN
 IF TG_TABLE_NAME='z02_core_applications' THEN
  original_id:=NEW.originating_z01_message_id;source_environment:=NEW.environment;
 ELSE
  original_id:=NEW.qualified_original_message_id;
  SELECT m.environment INTO source_environment FROM public.ediel_messages m WHERE m.id=NEW.source_message_id AND m.company_id=NEW.company_id;
 END IF;
 IF original_id IS NULL OR source_environment IS NULL THEN RETURN NEW; END IF;
 FOR e IN SELECT b.expectation_id FROM gridex_business_expectations.bindings b
  WHERE b.company_id=NEW.company_id AND b.environment=source_environment AND b.source_message_id=original_id
  ORDER BY b.expectation_id LOOP
  PERFORM gridex_business_expectations.reconcile_v1(e);
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_business_expectations.applied_source_v1() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
