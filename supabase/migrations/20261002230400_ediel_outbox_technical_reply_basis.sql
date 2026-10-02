-- The outbox trigger gridex_validate_ediel_outbox_tenant_and_snapshot still
-- requires a business rule pack for every CONTRL/APERAK, so a protected
-- technical CONTRL (20260930184410) or a PRODAT common-header APERAK
-- (20260930205320) could be created but never queued:
-- ediel_outbox_rule_pack_snapshot_missing.
--
-- Those two kinds carry no rule pack by design. The message contract trigger
-- (20261002070000) accepts them only after re-running their protected owner
-- (gridex_ediel_technical_ack.require_contrl_v1 /
-- gridex_ediel_common_header.witness_v1) on the same row, so the outbox
-- accepts exactly those rows: an outbound CONTRL without rule pack, or an
-- APERAK whose execution context names its common-header witness. Every other
-- family still needs its rule pack; tenant and direction checks are unchanged.
BEGIN;
DO $outbox$DECLARE f record;
 needle CONSTANT text:=$n$  if m.message_family in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR')
     and (m.rule_profile_version_id is null or nullif(m.rule_pack_checksum,'') is null) then$n$;
 replacement CONSTANT text:=$n$  if m.message_family in ('PRODAT','UTILTS','CONTRL','APERAK','UTILTS_ERR')
     and (m.rule_profile_version_id is null or nullif(m.rule_pack_checksum,'') is null)
     and not (m.canonical_rule_pack_id is null and m.rule_profile_version_id is null
       and (m.message_family='CONTRL'
        or (m.message_family='APERAK' and m.execution_context_snapshot ? 'prodatCommonHeaderNegativeWitnessId'))) then$n$;
BEGIN
 IF to_regprocedure('gridex_ediel_technical_ack.require_contrl_v1(public.ediel_messages)') IS NULL THEN RAISE EXCEPTION 'outbox_technical_reply_predecessor_required';END IF;
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid='public.gridex_validate_ediel_outbox_tenant_and_snapshot()'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'outbox_technical_reply_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'outbox_technical_reply_metadata_changed';END IF;
END$outbox$;
COMMIT;
