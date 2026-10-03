-- A mixed PRODAT source (own negatives plus committed own siblings) is owned by
-- the supply/permission partition owner since 20261001043234/043602. Its one
-- complete BGM34 reply carries the qualified negatives and ERC 100 for exactly
-- the objects with committed effect receipts. require_before_prodat_scope_v1
-- (20260930224726) still accepted such a reply only from the superseded mixed
-- owner's receipts, so the rejected object's negative APERAK could never be
-- sent (prodat_mixed_ack_committed_own_results_required).
--
-- When the source has no mixed-owner receipt but an authentic partition, this
-- guard defers to the partition owner: the domain_response_birth trigger
-- (gridex_received_sources.require_domain_response_at_birth_v1) requires every
-- ERC 100 object of the same insert to be a committed own effect. A mixed-owner
-- source keeps every existing check. Body rewrite with predecessor and
-- metadata guards.
BEGIN;
DO $scope$DECLARE f record;
 needle CONSTANT text:=$n$ SELECT * INTO r FROM gridex_received_sources.prodat_mixed_object_receipts WHERE source_message_id=source.id AND company_id=m.company_id AND environment=m.environment AND source_payload_hash=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') FOR SHARE;
$n$;
 addition CONSTANT text:=$n$ IF NOT FOUND AND EXISTS(SELECT FROM gridex_received_sources.supply_object_partitions p WHERE p.source_message_id=source.id AND p.company_id=m.company_id
   AND p.environment=m.environment AND p.payload_hash=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex'))
  AND EXISTS(SELECT FROM pg_trigger WHERE tgrelid='public.ediel_messages'::regclass AND tgname='domain_response_birth' AND tgenabled<>'D'
   AND tgfoid='gridex_received_sources.require_domain_response_at_birth_v1()'::regprocedure) THEN RETURN;END IF;
$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='gridex_ediel_ack_guide.require_before_prodat_scope_v1(public.ediel_messages)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 OR to_regclass('gridex_received_sources.supply_object_partitions') IS NULL
  OR to_regprocedure('gridex_received_sources.require_domain_response_at_birth_v1()') IS NULL
 THEN RAISE EXCEPTION 'prodat_partition_mixed_reply_scope_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,needle||addition));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'prodat_partition_mixed_reply_scope_metadata_changed';END IF;
END$scope$;
COMMIT;
