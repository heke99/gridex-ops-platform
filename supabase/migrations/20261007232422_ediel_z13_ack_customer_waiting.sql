-- Project the first newly completed Z13 ACK pair into the customer-waiting
-- phase. ACK acceptance grants no customer consent, objects or data rights.
-- Existing receipts and already established market decisions are untouched.
BEGIN;
CREATE FUNCTION gridex_service_permission.wait_after_z13_ack_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
 c gridex_ack_authority.source_correlations%rowtype;
 a gridex_ack_authority.source_correlations%rowtype;
 s public.ediel_messages%rowtype;
 p public.metering_permissions%rowtype;
 o gridex_service_permission.origins%rowtype;
 wire jsonb; original jsonb; expected jsonb; proof jsonb; ack_raw text;
 positive_aperaks uuid[]:=ARRAY[]::uuid[]; positive_contrl boolean:=false;
BEGIN
 IF NEW.result->'sourceAccepted' IS DISTINCT FROM 'true'::jsonb
  OR NEW.result->'finalAckReached' IS DISTINCT FROM 'true'::jsonb
  OR NEW.result->'wholeSourceRejected' IS DISTINCT FROM 'false'::jsonb THEN RETURN NEW; END IF;
 SELECT * INTO STRICT c FROM gridex_ack_authority.source_correlations WHERE ack_message_id=NEW.ack_message_id;
 -- Most ACKs have no service-permission origin. Do not impose new permission
 -- locks or business authority on those unrelated source families.
 SELECT * INTO o FROM gridex_service_permission.origins
  WHERE message_id=c.source_message_id AND company_id=c.company_id AND message_code='Z13';
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT * INTO s FROM public.ediel_messages WHERE id=c.source_message_id FOR UPDATE;
 IF s.company_id IS DISTINCT FROM c.company_id OR s.environment IS DISTINCT FROM c.environment
  OR s.direction IS DISTINCT FROM 'outbound' OR s.message_family IS DISTINCT FROM 'PRODAT'
  OR s.message_code IS DISTINCT FROM 'Z13' OR s.intent_id IS DISTINCT FROM o.intent_id THEN RETURN NEW; END IF;
 IF s.message_sent_at IS NULL OR s.immutable_rendered_at IS NULL
  OR s.immutable_payload_hash IS DISTINCT FROM c.source_payload_hash
  OR c.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex')
  OR NEW.result#>>'{sourceMessage,id}' IS DISTINCT FROM s.id::text
  OR NEW.result#>>'{sourceMessage,company_id}' IS DISTINCT FROM c.company_id::text
  OR NEW.result#>>'{sourceMessage,environment}' IS DISTINCT FROM c.environment
  OR NEW.result#>>'{sourceMessage,raw_payload}' IS DISTINCT FROM s.raw_payload THEN
  RAISE EXCEPTION 'ediel_z13_waiting_source_receipt_conflict' USING ERRCODE='23514';
 END IF;
 -- A distinct later ACK must not repair an aggregate already completed before
 -- this migration. Earlier *partial* receipts can still complete prospectively.
 IF EXISTS(SELECT FROM gridex_ack_authority.applied_receipts r
  JOIN gridex_ack_authority.source_correlations prior USING(ack_message_id)
  WHERE prior.source_message_id=s.id AND r.ack_message_id<>NEW.ack_message_id
   AND r.result->'sourceAccepted'='true'::jsonb AND r.result->'finalAckReached'='true'::jsonb)
 THEN RETURN NEW; END IF;
 wire:=gridex_ack_authority.wire_v1(s.raw_payload);
 IF wire->>'family' IS DISTINCT FROM 'PRODAT' OR wire->>'code' IS DISTINCT FROM 'Z13'
  OR wire->>'environment' IS DISTINCT FROM c.environment THEN RETURN NEW; END IF;
 PERFORM gridex_ack_authority.require_physical_actor_v1(c.company_id,c.actor_user_id,true);
 proof:=gridex_ack_authority.read_committed_v1(c.company_id,c.environment,c.ack_message_id,c.actor_user_id);
 IF proof->>'kind' IS DISTINCT FROM 'exact_receipt' OR proof->'result' IS DISTINCT FROM NEW.result THEN
  RAISE EXCEPTION 'ediel_z13_waiting_committed_receipt_required' USING ERRCODE='23514'; END IF;
 expected:=gridex_ack_authority.prodat_expected_physical_scope_keys_v1(s.raw_payload,s.id);
 IF jsonb_typeof(expected) IS DISTINCT FROM 'array' OR jsonb_array_length(expected)=0
  OR EXISTS(SELECT FROM gridex_ack_authority.scope_outcomes x WHERE x.source_message_id=s.id AND x.outcome='negative')
 THEN RETURN NEW; END IF;
 -- The final ACK may be CONTRL arriving after APERAK. Qualify that earlier
 -- APERAK's immutable canonical receipt and physical scopes as well. The outer
 -- owner writes its physical receipt AFTER applied_receipts; do not demand it
 -- prematurely for the current APERAK. Recompute the same actual projection.
 FOR a IN SELECT * FROM gridex_ack_authority.source_correlations
  WHERE source_message_id=s.id AND company_id=c.company_id AND environment=c.environment
   AND source_payload_hash=c.source_payload_hash AND ack_outcome='positive'
   AND ack_family IN('CONTRL','APERAK') ORDER BY ack_message_id LOOP
  proof:=gridex_ack_authority.read_committed_v1(c.company_id,c.environment,a.ack_message_id,c.actor_user_id);
  IF proof->>'kind' IS DISTINCT FROM 'exact_receipt' THEN CONTINUE; END IF;
  IF a.ack_family='CONTRL' AND a.ack_scope='interchange'
   AND EXISTS(SELECT FROM gridex_ack_authority.scope_outcomes x WHERE x.source_message_id=s.id
    AND x.ack_message_id=a.ack_message_id AND x.ack_family='CONTRL' AND x.ack_scope='interchange' AND x.outcome='positive')
  THEN positive_contrl:=true;
  ELSIF a.ack_family='APERAK' AND a.ack_scope='object' THEN
   SELECT raw_payload INTO STRICT ack_raw FROM public.ediel_messages WHERE id=a.ack_message_id;
   IF a.scope_outcomes IS DISTINCT FROM gridex_ack_authority.prodat_physical_outcomes_v1(ack_raw,s.raw_payload,s.id)
   THEN RAISE EXCEPTION 'ediel_z13_waiting_physical_scope_conflict' USING ERRCODE='23514'; END IF;
   positive_aperaks:=array_append(positive_aperaks,a.ack_message_id);
  END IF;
 END LOOP;
 IF NOT positive_contrl OR cardinality(positive_aperaks)=0
  OR EXISTS(SELECT FROM jsonb_array_elements_text(expected) ref WHERE NOT EXISTS(
   SELECT FROM gridex_ack_authority.scope_outcomes x WHERE x.source_message_id=s.id
    AND x.ack_family='APERAK' AND x.ack_scope='object' AND x.source_reference=ref
    AND x.ack_message_id=ANY(positive_aperaks) AND x.outcome='positive')) THEN RETURN NEW; END IF;
 -- The current graph owner already holds SHARE on this table before locking
 -- messages. A blocking upgrade here can deadlock with another ACK waiting on
 -- messages. NOWAIT deliberately propagates 55P03: the ENTIRE ACK transaction
 -- rolls back and can retry; never commit acceptance with a skipped projection.
 LOCK TABLE public.metering_permissions IN ROW EXCLUSIVE MODE NOWAIT;
 SELECT * INTO p FROM public.metering_permissions WHERE id=o.permission_id AND company_id=c.company_id FOR UPDATE;
 original:=gridex_received_sources.permission_partition_wire_v1(s.raw_payload);
 IF NOT FOUND OR (p.status IN('z13_ready','z13_sent')) IS NOT TRUE
  OR p.source_z13_message_id IS DISTINCT FROM s.id OR p.outbound_z13_message_id IS DISTINCT FROM s.id
  OR s.customer_id IS NULL OR p.customer_id IS DISTINCT FROM s.customer_id
  OR o.basis->>'customerId' IS DISTINCT FROM p.customer_id::text
  OR nullif(btrim(p.rff_li_reference),'') IS NULL
  OR jsonb_typeof(original->'objects') IS DISTINCT FROM 'array'
  OR (SELECT count(*) FROM jsonb_array_elements(original->'objects') x WHERE x->>'li'=p.rff_li_reference)<>1
  OR nullif(p.grid_owner_ediel_id,'') IS NULL OR p.grid_owner_ediel_id IS DISTINCT FROM original->>'receiver'
  OR p.source_z14_message_id IS NOT NULL OR p.inbound_z14_message_id IS NOT NULL OR p.inbound_z15_message_id IS NOT NULL
  OR p.market_state_version IS DISTINCT FROM 0::bigint OR p.permission_reference IS NOT NULL
  OR p.approved_start_date IS NOT NULL OR p.approved_end_date IS NOT NULL
  OR p.approved_start_at IS NOT NULL OR p.approved_end_at IS NOT NULL
  OR coalesce(p.metadata,'{}'::jsonb) ?| ARRAY['marketPermission','z14','z15'] THEN RETURN NEW; END IF;
 UPDATE public.metering_permissions SET status='waiting_for_customer_approval',updated_at=now(),updated_by=c.actor_user_id
  WHERE id=p.id AND company_id=c.company_id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION gridex_service_permission.wait_after_z13_ack_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER z13_customer_waiting AFTER INSERT ON gridex_ack_authority.applied_receipts
 FOR EACH ROW EXECUTE FUNCTION gridex_service_permission.wait_after_z13_ack_v1();
COMMIT;
