BEGIN;
-- Forward over the installed retention authority. Preserve all current classes,
-- actor/auth bridge, company/scope, DENY precedence and non-retention delegate.
-- The clock is sampled after existing current actor/company/member checks
-- and used consistently for the two own override validity windows.
DO $retention_grant_native_clock$
DECLARE
 f record;
 installed record;
 body text;
 definition text;
 retention_keys_needle constant text:='retention_keys constant text[]:=ARRAY[''ediel.retention.submit'',''ediel.retention.review'',''ediel.retention.purge'',''ediel.retention.source_bytes'',''ediel.retention.customer_fields'',''ediel.retention.original_bytes'',''ediel.retention.mime_bytes'',''ediel.retention.artifact_decision_evidence'',''ediel.retention.blob_decision_evidence'',''ediel.retention.record_decision_evidence'',''ediel.retention.process_decision_evidence'',''ediel.retention.decision_policy_evidence'',''ediel.retention.billing_source_evidence'',''ediel.retention.invoice_copy_evidence'',''ediel.retention.settlement_copy_evidence'',''ediel.retention.finance_decision_evidence''];';
 start_needle constant text:='BEGIN'||chr(10)||' IF wanted<>ALL(retention_keys) THEN';
 permission_needle constant text:=' IF NOT EXISTS(SELECT FROM public.permissions WHERE key=wanted AND is_active)';
BEGIN
 SELECT p.*,p.oid::regprocedure identity,to_jsonb(p)-'prosrc' authority_before
 INTO STRICT f FROM pg_catalog.pg_proc p
 WHERE p.oid='gridex_ediel_retention.permission_v1(uuid,uuid,text)'::regprocedure;
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc,'UTF8')),'hex')<>'24128f720357eb64a0d3b6ba306925716453cbbd7f241696b54ec8de4d53910f'
  OR NOT f.prosecdef OR f.proowner<>'gridex_ediel_retention_owner'::regrole
  OR f.provolatile<>'v' OR (f.proconfig @> ARRAY['search_path=pg_catalog']) IS DISTINCT FROM true
  OR position(retention_keys_needle IN f.prosrc)=0
  OR f.prosrc!~'public.ediel_retention_lock_auth_actor_v1\(actor\)'
  OR position('''ediel.retention.finance_decision_evidence''' IN f.prosrc)=0
  OR (length(f.prosrc)-length(replace(f.prosrc,start_needle,'')))/length(start_needle)<>1
  OR (length(f.prosrc)-length(replace(f.prosrc,permission_needle,'')))/length(permission_needle)<>1
  OR position('retention_grant_observed_at' IN f.prosrc)>0
  OR (length(f.prosrc)-length(replace(f.prosrc,'o.valid_from<=now()','')))/length('o.valid_from<=now()')<>2
  OR (length(f.prosrc)-length(replace(f.prosrc,'now()<o.valid_to','')))/length('now()<o.valid_to')<>2
 THEN RAISE EXCEPTION 'retention_grant_native_clock_original_review_required';END IF;
 body:=replace(f.prosrc,start_needle,'retention_grant_observed_at timestamptz;'||chr(10)||start_needle);
 body:=replace(body,permission_needle,' retention_grant_observed_at:=clock_timestamp();'||chr(10)||permission_needle);
 body:=replace(replace(body,'o.valid_from<=now()','o.valid_from<=retention_grant_observed_at'),
  'now()<o.valid_to','retention_grant_observed_at<o.valid_to');
 definition:=pg_catalog.pg_get_functiondef(f.oid);
 IF position(f.prosrc IN definition)=0 THEN RAISE EXCEPTION 'retention_grant_native_clock_definition_required';END IF;
 EXECUTE replace(definition,f.prosrc,body);
 SELECT * INTO STRICT installed FROM pg_catalog.pg_proc p WHERE p.oid=f.oid;
 IF to_jsonb(installed)-'prosrc' IS DISTINCT FROM f.authority_before
  OR installed.prosrc IS DISTINCT FROM body
  OR pg_catalog.to_regprocedure(f.identity::text) IS DISTINCT FROM f.oid
 THEN RAISE EXCEPTION 'retention_grant_native_clock_authority_changed';END IF;
END
$retention_grant_native_clock$;
COMMIT;
