-- The native canonical registry contains communication.send/read, never a
-- communication.write grant. Preserve the private legacy operation marker and
-- all existing actor/scope/read guards; bind only its resolver to the real key.
BEGIN;
DO $reception_canonical_permission$
DECLARE before_record record;after_record record;body text;definition text;
 needle constant text:='public.gridex_actor_has_company_permission(actor,c,''communication.write'')';
 replacement constant text:='public.gridex_actor_has_company_permission(actor,c,''communication.send'')';
BEGIN
 IF NOT EXISTS(SELECT FROM public.permissions WHERE key='communication.send' AND is_active)
  OR NOT EXISTS(SELECT FROM public.permissions WHERE key='communication.read' AND is_active)
  OR EXISTS(SELECT FROM public.permissions WHERE key='communication.write')
  THEN RAISE EXCEPTION 'reception_actual_permission_catalog_review_required';END IF;
 SELECT p.*,to_jsonb(p)-'prosrc' unchanged_catalog INTO STRICT before_record
  FROM pg_catalog.pg_proc p WHERE p.oid='gridex_ediel_inbound_receptions.authorize_v1(uuid,uuid,text)'::regprocedure;
 IF before_record.prosecdef IS DISTINCT FROM true
  OR (before_record.proconfig @> ARRAY['search_path=pg_catalog']) IS DISTINCT FROM true
  OR before_record.provolatile<>'v'
  OR (length(before_record.prosrc)-length(replace(before_record.prosrc,needle,'')))/length(needle)<>2
  OR position('x.company_id=c AND x.user_id=actor AND x.status=''active'' AND x.is_active AND x.accepted_at IS NOT NULL' IN before_record.prosrc)=0
  THEN RAISE EXCEPTION 'reception_authorization_original_review_required';END IF;
 body:=replace(before_record.prosrc,needle,replacement);
 definition:=pg_catalog.pg_get_functiondef(before_record.oid);
 IF position(before_record.prosrc IN definition)=0 THEN RAISE EXCEPTION 'reception_authorization_definition_required';END IF;
 EXECUTE replace(definition,before_record.prosrc,body);
 SELECT p.* INTO STRICT after_record FROM pg_catalog.pg_proc p WHERE p.oid=before_record.oid;
 IF to_jsonb(after_record)-'prosrc' IS DISTINCT FROM before_record.unchanged_catalog
  OR after_record.prosrc IS DISTINCT FROM body
  THEN RAISE EXCEPTION 'reception_authorization_catalog_drift';END IF;
END
$reception_canonical_permission$;
COMMIT;
