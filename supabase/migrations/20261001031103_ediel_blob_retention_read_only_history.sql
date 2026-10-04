-- Metadata-only current own retention read, separate from legal original review.
-- The installed source-bound reader and its OID/owner/ACL/search_path survive.
BEGIN;
DO $blob_read_scope$
DECLARE f record;after_record record;body text;definition text;needle text:=E' IF gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,\'ediel.retention.review\') IS TRUE THEN permission:=\'ediel.retention.review\';';boundary text:=E' PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,permission);';
BEGIN
 PERFORM 'gridex_ediel_retention.record_read_actor_v1(uuid,uuid)'::regprocedure;
 SELECT oid,prosrc,proowner,proacl,proconfig INTO STRICT f FROM pg_proc WHERE oid='public.ediel_read_blob_retention_decision_v1(uuid,uuid,uuid,boolean)'::regprocedure;
 IF f.proowner<>'gridex_ediel_retention_owner'::regrole OR position(needle IN f.prosrc)=0 OR position(boundary IN f.prosrc)=0 THEN RAISE EXCEPTION 'retention_blob_read_scope_requires_original_review';END IF;
 body:=replace(f.prosrc,needle,E' IF NOT p_include_document AND gridex_ediel_retention.record_permission_v1(p_company_id,p_actor_user_id,\'__read_scope__\') IS TRUE THEN permission:=\'ediel.retention.read\';\n ELSIF gridex_ediel_retention.permission_v1(p_company_id,p_actor_user_id,\'ediel.retention.review\') IS TRUE THEN permission:=\'ediel.retention.review\';');
 body:=replace(body,boundary,E' IF permission=\'ediel.retention.read\' THEN PERFORM gridex_ediel_retention.record_read_actor_v1(p_company_id,p_actor_user_id);ELSE PERFORM gridex_ediel_retention.actor_v1(p_company_id,p_actor_user_id,permission);END IF;');
 definition:=pg_get_functiondef(f.oid);IF position(f.prosrc IN definition)=0 THEN RAISE EXCEPTION 'retention_blob_read_definition_binding_required';END IF;
 EXECUTE replace(definition,f.prosrc,body);
 SELECT proowner,proacl,proconfig INTO STRICT after_record FROM pg_proc WHERE oid=f.oid;
 IF after_record.proowner IS DISTINCT FROM f.proowner OR after_record.proacl IS DISTINCT FROM f.proacl OR after_record.proconfig IS DISTINCT FROM f.proconfig THEN RAISE EXCEPTION 'retention_blob_read_original_owner_acl_changed';END IF;
END
$blob_read_scope$;
COMMIT;
