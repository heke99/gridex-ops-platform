-- masterplan: AT-Z03H-SUPPLIER, AT-Z04H-SUPPLIER
-- Protected technical CONTRL deliberately has no application rule pack. Repair
-- the single-item consumer using its existing current actor/send authority,
-- graph-first and before any claim write. Ordinary claims and grants unchanged.
BEGIN;
DO $claim$ DECLARE f record;after_metadata jsonb;body text;
 old_hash CONSTANT text:='bf6602de71202ae6b70eba4d1faed5346aed876fc3b7e783086a56fa0f5c0a2e';
 new_hash CONSTANT text:='38c765caf8b3de750f2a6970b404816ad483bfa0aeccc7294d40cd993e3ecef1';
 declaration_slot CONSTANT text:=$slot$
begin
$slot$;
 query_slot CONSTANT text:=$slot$  return query
$slot$;
 predicate_slot CONSTANT text:=$slot$           and m.rule_profile_version_id is not null and nullif(m.rule_pack_checksum,'') is not null$slot$;
BEGIN
 SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition
 INTO STRICT f FROM pg_proc p WHERE oid='public.claim_ediel_outbox_item(uuid,text,uuid)'::regprocedure;
 IF f.metadata->>'prosecdef' IS DISTINCT FROM 'true' OR f.metadata->>'proretset' IS DISTINCT FROM 'true'
    OR f.metadata->'proconfig' IS DISTINCT FROM '["search_path=public"]'::jsonb THEN
   RAISE EXCEPTION 'ediel_technical_contrl_claim_metadata_changed';
 END IF;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')=new_hash THEN RETURN;END IF;
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM old_hash
    OR (length(f.prosrc)-length(replace(f.prosrc,declaration_slot,'')))/length(declaration_slot)<>1
    OR (length(f.prosrc)-length(replace(f.prosrc,query_slot,'')))/length(query_slot)<>1
    OR (length(f.prosrc)-length(replace(f.prosrc,predicate_slot,'')))/length(predicate_slot)<>1 THEN
   RAISE EXCEPTION 'ediel_technical_contrl_claim_source_shape_changed';
 END IF;
 body:=replace(f.prosrc,declaration_slot,$declarations$
DECLARE candidate public.ediel_outbox%rowtype;locked_outbox public.ediel_outbox%rowtype;
 ack public.ediel_messages%rowtype;source public.ediel_messages%rowtype;
 basis jsonb;initial_basis jsonb;e jsonb;technical boolean:=false;pass integer;
begin
$declarations$);
 body:=replace(body,query_slot,$qualification$  -- Routing peek only. Never take an outbox/message row lock before the
  -- unchanged private reader acquires its current graph and source receipts.
  SELECT * INTO candidate FROM public.ediel_outbox WHERE id=p_outbox_item_id;
  IF candidate.company_id IS NOT NULL AND candidate.status IN ('prepared','queued') THEN
    SELECT * INTO ack FROM public.ediel_messages WHERE id=candidate.ediel_message_id;
    IF ack.company_id=candidate.company_id AND ack.environment=candidate.environment
       AND ack.environment IN ('test','production') AND ack.direction='outbound'
       AND ack.message_family='CONTRL' AND ack.canonical_rule_pack_id IS NULL
       AND ack.rule_profile_version_id IS NULL AND ack.rule_pack_checksum IS NULL THEN
      initial_basis:=gridex_ediel_technical_ack.read_persisted_contrl_v2(
        candidate.company_id,candidate.environment,candidate.ediel_message_id,p_actor_user_id,'send');
      FOR pass IN 1..2 LOOP
        basis:=initial_basis;
        IF pass=2 THEN
          -- The first call already holds this same complete graph/source chain.
          -- Revalidate current actor/phase/endpoint after the outbox lock wait.
          basis:=gridex_ediel_technical_ack.read_persisted_contrl_v2(
            candidate.company_id,candidate.environment,candidate.ediel_message_id,p_actor_user_id,'send');
          IF basis IS DISTINCT FROM initial_basis THEN
            RAISE EXCEPTION 'ediel_technical_contrl_claim_basis_changed' USING ERRCODE='23514';
          END IF;
        END IF;
        e:=basis->'technicalSyntaxAckEvidence';
        IF jsonb_typeof(basis) IS DISTINCT FROM 'object' OR basis->'version' IS DISTINCT FROM '2'::jsonb
           OR basis->>'executionActorUserId' IS DISTINCT FROM p_actor_user_id::text
           OR basis->>'executionPhase' IS DISTINCT FROM 'send'
           OR jsonb_typeof(basis->'ackMessage') IS DISTINCT FROM 'object'
           OR jsonb_typeof(e) IS DISTINCT FROM 'object' OR e->'version' IS DISTINCT FROM '1'::jsonb
           OR e->>'kind' IS DISTINCT FROM 'technical_syntax_ack'
           OR e->>'companyId' IS DISTINCT FROM candidate.company_id::text
           OR e->>'environment' IS DISTINCT FROM candidate.environment
           OR (e->>'syntaxDecision' IN ('accepted','rejected')) IS NOT TRUE
           OR (e->>'sourceMessageId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') IS NOT TRUE
           OR (e->>'sourceHash' ~ '^[0-9a-f]{64}$') IS NOT TRUE THEN
          RAISE EXCEPTION 'ediel_technical_contrl_claim_basis_required' USING ERRCODE='23514';
        END IF;
        SELECT * INTO ack FROM public.ediel_messages WHERE id=candidate.ediel_message_id FOR SHARE;
        SELECT * INTO source FROM public.ediel_messages WHERE id=(e->>'sourceMessageId')::uuid FOR SHARE;
        IF ack.id IS NULL OR ack.company_id IS DISTINCT FROM candidate.company_id
           OR ack.environment IS DISTINCT FROM candidate.environment OR ack.direction IS DISTINCT FROM 'outbound'
           OR ack.message_family IS DISTINCT FROM 'CONTRL' OR ack.canonical_rule_pack_id IS NOT NULL
           OR ack.rule_profile_version_id IS NOT NULL OR ack.rule_pack_checksum IS NOT NULL
           OR nullif(ack.raw_payload,'') IS NULL OR ack.immutable_rendered_at IS NULL
           OR ack.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex')
           OR (to_jsonb(ack)-ARRAY['related_message_id','ack_outcome']) IS DISTINCT FROM
              ((basis->'ackMessage')-ARRAY['related_message_id','ack_outcome'])
           OR basis#>>'{ackMessage,related_message_id}' IS DISTINCT FROM e->>'sourceMessageId'
           OR basis#>>'{ackMessage,ack_outcome}' IS DISTINCT FROM
              (CASE e->>'syntaxDecision' WHEN 'accepted' THEN 'positive' WHEN 'rejected' THEN 'negative' END)
           OR source.id IS NULL OR source.direction IS DISTINCT FROM 'inbound'
           OR source.environment IS DISTINCT FROM candidate.environment
           OR (source.company_id IS NOT NULL AND source.company_id IS DISTINCT FROM candidate.company_id)
           OR nullif(source.raw_payload,'') IS NULL
           -- Inbound original hash and outbound reply hash are different seals.
           OR e->>'sourceHash' IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') THEN
          RAISE EXCEPTION 'ediel_technical_contrl_claim_current_binding_required' USING ERRCODE='23514';
        END IF;
        IF pass=1 THEN
          SELECT * INTO locked_outbox FROM public.ediel_outbox WHERE id=p_outbox_item_id FOR UPDATE;
          IF locked_outbox.id IS NULL OR locked_outbox.company_id IS DISTINCT FROM ack.company_id
             OR locked_outbox.environment IS DISTINCT FROM ack.environment
             OR locked_outbox.ediel_message_id IS DISTINCT FROM ack.id
             OR (locked_outbox.status IN ('prepared','queued')) IS NOT TRUE
             OR to_jsonb(locked_outbox) IS DISTINCT FROM to_jsonb(candidate) THEN
            RETURN;
          END IF;
        END IF;
      END LOOP;
      -- Re-read after the last private call; no stale routing snapshot is an
      -- authority Boolean. Competing transactions cannot change this locked row.
      SELECT * INTO locked_outbox FROM public.ediel_outbox WHERE id=p_outbox_item_id FOR UPDATE;
      IF to_jsonb(locked_outbox) IS DISTINCT FROM to_jsonb(candidate) THEN RETURN;END IF;
      technical:=true;
    END IF;
  END IF;
  return query
$qualification$);
 body:=replace(body,predicate_slot,$predicate$           and ((m.rule_profile_version_id is not null and nullif(m.rule_pack_checksum,'') is not null)
             or (technical and m.id=ack.id and to_jsonb(m)=to_jsonb(ack)))$predicate$);
 IF encode(sha256(convert_to(body,'UTF8')),'hex') IS DISTINCT FROM new_hash THEN
   RAISE EXCEPTION 'ediel_technical_contrl_claim_patch_hash_mismatch';
 END IF;
 EXECUTE replace(f.definition,f.prosrc,body);
 SELECT to_jsonb(p)-'prosrc' INTO STRICT after_metadata FROM pg_proc p WHERE p.oid=f.oid;
 IF after_metadata IS DISTINCT FROM f.metadata OR
    (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM new_hash THEN
   RAISE EXCEPTION 'ediel_technical_contrl_claim_postimage_changed';
 END IF;
END $claim$;
COMMIT;
