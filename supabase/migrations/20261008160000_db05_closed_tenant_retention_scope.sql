-- DB-05: a canonically closed tenant (canonical_transition_tenant_lifecycle -> 'closed') keeps its
-- decided per-class retention workflow. The three retention gates admitted only active/archived/
-- pending_deletion, so a closed tenant's data could never be lawfully purged. Only the tenant-status
-- admission list changes; membership, actor, grant, deny, class and operational-permission checks,
-- owners, ACLs and search_path stay as installed. deleted_test_only remains refused.
BEGIN;
DO $$
DECLARE
 needle constant text:='status IN(''active'',''archived'',''pending_deletion'')';
 replacement constant text:='status IN(''active'',''archived'',''pending_deletion'',''closed'')';
 body text;
BEGIN
 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure;
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'db05_retention_permission_gate_requires_source_review';END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION gridex_ediel_retention.permission_v1(c uuid,actor uuid,wanted text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS %L',replace(body,needle,replacement));

 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='gridex_ediel_retention.record_permission_v1(uuid,uuid,text)'::regprocedure;
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'db05_retention_record_gate_requires_source_review';END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION gridex_ediel_retention.record_permission_v1(c uuid,actor uuid,k text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS %L',replace(body,needle,replacement));

 SELECT prosrc INTO STRICT body FROM pg_proc WHERE oid='public.ediel_current_retention_companies_v1()'::regprocedure;
 IF (length(body)-length(replace(body,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'db05_retention_workspace_gate_requires_source_review';END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION public.ediel_current_retention_companies_v1() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS %L',replace(body,needle,replacement));
END$$;
COMMIT;
