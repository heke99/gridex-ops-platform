-- The actual ACK validation definer cannot enter a public invoker facade
-- guarded by current_user=service_role. Retain that external boundary and
-- reuse its exact existing private physical original and immutable witness
-- readers here. No current-guide reselection, new admission or backfill.
BEGIN;
DO $ack_validation$
DECLARE f record;body text;actual jsonb;
 needle CONSTANT text:=$old$original_ack:=public.gridex_read_inbound_ack_source_v1(p_company_id,p_environment,src.source_message_id);
      original_ack:=original_ack->'sourceRulePackEvidence';$old$;
 replacement CONSTANT text:=$new$original_ack:=gridex_ediel_source_rules.read_ack_source_before_basis_v1(p_company_id,p_environment,src.source_message_id);
      IF original_ack IS NOT NULL THEN
        original_ack:=gridex_ediel_source_rules.require_v1(p_company_id,(original_ack#>>'{sourceMessage,id}')::uuid);
      END IF;$new$;
BEGIN
 SELECT * INTO STRICT f FROM pg_proc WHERE oid='gridex_received_sources.append_validation_before_reference_profile_v1(uuid,text,uuid,text,text)'::regprocedure;
 IF f.prosecdef IS NOT TRUE OR f.prolang<>(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  OR (length(f.prosrc)-length(replace(f.prosrc,needle,'')))<>length(needle)
  OR strpos(f.prosrc,replacement)>0
 THEN RAISE EXCEPTION 'received_ack_validation_existing_owner_review_required';END IF;
 body:=replace(f.prosrc,needle,replacement);
 EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,body);
 SELECT to_jsonb(p)-'prosrc' INTO actual FROM pg_proc p WHERE p.oid=f.oid;
 IF actual IS DISTINCT FROM to_jsonb(f)-'prosrc'
 THEN RAISE EXCEPTION 'received_ack_validation_existing_authority_changed';END IF;
END$ack_validation$;
COMMIT;
