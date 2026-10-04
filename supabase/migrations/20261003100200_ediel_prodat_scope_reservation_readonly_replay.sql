-- gridex_ediel_ack_guide.require_prodat_scope_v1 reserves each own PRODAT ACK
-- scope with INSERT ... ON CONFLICT DO NOTHING. The same function also runs on
-- the read-only replay path (read_scope_v2 -> read_business_original_v1 ->
-- require_business_owner_v1 -> assert_message_v1 -> ack_guide.require_v1), so
-- every replay read of an already reserved ACK still attempted an INSERT and
-- fired BEFORE INSERT triggers on outbound_prodat_scopes.
--
-- The preceding loop already proves any existing row for this source is the
-- identical reservation (same ACK, hash, outcome and physical reference) or
-- raises. Insert only a scope that is still absent; an existing identical
-- reservation is a pure read. Body rewrite with predecessor/metadata guards.
BEGIN;
DO $scope$DECLARE f record;
 needle CONSTANT text:=$n$   VALUES(m.company_id,m.environment,source.id,source_hash,scope->>'scope',scope->>'reference',scope->'physicalReference',scope->>'outcome',m.id,ack_hash) ON CONFLICT DO NOTHING;$n$;
 replacement CONSTANT text:=$n$   SELECT m.company_id,m.environment,source.id,source_hash,scope->>'scope',scope->>'reference',scope->'physicalReference',scope->>'outcome',m.id,ack_hash
   WHERE NOT EXISTS(SELECT FROM gridex_ediel_ack_guide.outbound_prodat_scopes r WHERE r.source_message_id=source.id AND r.scope_kind=scope->>'scope' AND r.scope_reference=scope->>'reference')
   ON CONFLICT DO NOTHING;$n$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p
  WHERE oid='gridex_ediel_ack_guide.require_prodat_scope_v1(public.ediel_messages)'::regprocedure;
 IF (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'prodat_scope_readonly_replay_predecessor_required';END IF;
 EXECUTE replace(f.definition,f.prosrc,replace(f.prosrc,needle,replacement));
 IF(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'prodat_scope_readonly_replay_metadata_changed';END IF;
END$scope$;
COMMIT;
