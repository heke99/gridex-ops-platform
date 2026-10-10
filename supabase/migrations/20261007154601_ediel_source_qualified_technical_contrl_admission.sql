-- Prescribed source-qualified CONTRL is independent of business activation.
-- Frozen masterplan section 18.1; retain all current actor/source, journal,
-- byte/archive/fencing guards and every outer transport wrapper.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
DO $repair$
DECLARE
 function_oid oid:=to_regprocedure('gridex_ediel_transport.mutate_before_service_origin_v1(jsonb)');
 original_definition text; original_body text; original_metadata jsonb;
 expected_body text; replacement_definition text; slot integer;
 old_slots text[]:=ARRAY[
$oldslot$is_ai boolean;$oldslot$,
$oldslot$ perform 1 from public.user_profiles x where x.id=actor for share;$oldslot$,
$oldslot$ or not exists(select 1 from public.canonical_tenant_operation_decision(c,case when env='production' then 'ediel.production.send' else 'ediel.test.process' end) d where d.allowed)$oldslot$,
$oldslot$ if action in ('prepare','enter') then$oldslot$];
 new_slots text[]:=ARRAY[
$newslot$is_ai boolean; technical_basis jsonb; technical_evidence jsonb; technical_candidate boolean:=false;$newslot$,
$newslot$ -- Routing is only a candidate selector. Authority comes from the existing
 -- actor-qualified private original port, with graph-first locks before rows.
 if env='production' and exists(select 1 from public.ediel_messages candidate
   where candidate.id=mid and candidate.company_id=c and candidate.environment=env
     and candidate.direction='outbound' and candidate.message_standard='edifact' and candidate.message_family='CONTRL') then
  technical_candidate:=true;
  technical_basis:=gridex_ediel_technical_ack.read_persisted_contrl_v2(c,env,mid,actor,'send');
 end if;
 perform 1 from public.user_profiles x where x.id=actor for share;$newslot$,
$newslot$$newslot$,
$newslot$ -- The private reader projects exactly two non-authoritative public caches.
 -- Bind those projections to its protected source/syntax, preserve stored rows,
 -- and compare every other field to the current locked sealed message.
 if technical_candidate then
  technical_evidence:=technical_basis->'technicalSyntaxAckEvidence';
  if jsonb_typeof(technical_basis) is distinct from 'object' or env is distinct from 'production' or m.message_family is distinct from 'CONTRL'
   or technical_basis->'version' is distinct from '2'::jsonb
   or technical_basis->>'executionActorUserId' is distinct from actor::text
   or technical_basis->>'executionPhase' is distinct from 'send'
   or jsonb_typeof(technical_basis->'ackMessage') is distinct from 'object'
   or jsonb_typeof(technical_evidence) is distinct from 'object'
   or technical_evidence->>'kind' is distinct from 'technical_syntax_ack'
   or technical_evidence->'version' is distinct from '1'::jsonb
   or technical_evidence->>'companyId' is distinct from c::text
   or technical_evidence->>'environment' is distinct from env
   or nullif(technical_evidence->>'sourceMessageId','') is null
   or technical_basis#>>'{ackMessage,related_message_id}' is distinct from technical_evidence->>'sourceMessageId'
   or technical_evidence->>'syntaxDecision' is null or technical_evidence->>'syntaxDecision' not in ('accepted','rejected')
   or technical_basis#>>'{ackMessage,ack_outcome}' is distinct from (case technical_evidence->>'syntaxDecision' when 'accepted' then 'positive' when 'rejected' then 'negative' end)
   or (technical_basis->'ackMessage')-array['related_message_id','ack_outcome'] is distinct from to_jsonb(m)-array['related_message_id','ack_outcome']
  then raise exception 'ediel_transport_technical_contrl_basis_mismatch' using errcode='42501'; end if;
 end if;
 if not technical_candidate and not exists(select 1 from public.canonical_tenant_operation_decision(c,case when env='production' then 'ediel.production.send' else 'ediel.test.process' end) d where d.allowed)
 then raise exception 'ediel_transport_actor_not_authorized' using errcode='42501'; end if;
 if action in ('prepare','enter') then$newslot$];
BEGIN
 IF function_oid IS NULL THEN RAISE EXCEPTION 'ediel_transport_existing_private_leaf_required';END IF;
 SELECT pg_get_functiondef(p.oid),p.prosrc,to_jsonb(p)-'prosrc'
 INTO STRICT original_definition,original_body,original_metadata FROM pg_proc p WHERE p.oid=function_oid;
 IF encode(sha256(convert_to(original_body,'UTF8')),'hex')='ecf31dbcb58e2c437a5286d781cffa052d49ab5f91f48521596ee93d6737d141' THEN RETURN;END IF;
 IF encode(sha256(convert_to(original_body,'UTF8')),'hex')<>'0c8f52291b620b8584a4182ba851f58fca1b30d1b7f3dbbc75e2700376fc5348' THEN RAISE EXCEPTION 'ediel_transport_exact_original_private_leaf_required';END IF;
 expected_body:=original_body;
 FOR slot IN 1..array_length(old_slots,1) LOOP
  IF (length(original_body)-length(replace(original_body,old_slots[slot],'')))/length(old_slots[slot])<>1 THEN RAISE EXCEPTION 'ediel_transport_exact_source_slot_required:%',slot;END IF;
  expected_body:=replace(expected_body,old_slots[slot],new_slots[slot]);
 END LOOP;
 IF encode(sha256(convert_to(expected_body,'UTF8')),'hex')<>'ecf31dbcb58e2c437a5286d781cffa052d49ab5f91f48521596ee93d6737d141' THEN RAISE EXCEPTION 'ediel_transport_exact_repaired_private_leaf_required';END IF;
 replacement_definition:=replace(original_definition,original_body,expected_body);
 EXECUTE replacement_definition;
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=function_oid) IS DISTINCT FROM original_metadata
  OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=function_oid) IS DISTINCT FROM expected_body THEN
  RAISE EXCEPTION 'ediel_transport_private_leaf_metadata_or_body_changed';END IF;
END $repair$;
COMMIT;
