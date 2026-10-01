-- Created by actual Supabase CLI2.118.0. Native functional ERR authorization
-- consumes the actual canonical owner's immutable own-IDE national projection.
-- No diagnostic issueCode, global error flag or caller response hint decides it.
BEGIN;
CREATE FUNCTION gridex_ediel_outbound_owner.require_utilts_err_source_v1(m public.ediel_messages,p_sending boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;tokens jsonb;a jsonb;s jsonb;facet jsonb;own_facet jsonb;
 t jsonb;sts jsonb;reference jsonb;original_reference jsonb;group_start integer;group_end integer;
 transaction_id text;national_code text;own_id text;count_refs integer;seen text[]:='{}';own_ids text[]:='{}';
 reservation public.ediel_ack_transaction_results%rowtype;
BEGIN
 IF m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'UTILTS_ERR' THEN RETURN;END IF;
 SELECT * INTO source FROM public.ediel_messages WHERE id=m.related_message_id AND company_id=m.company_id AND environment=m.environment AND direction='inbound' FOR SHARE;
 IF source.id IS NULL OR source.message_family IS DISTINCT FROM 'UTILTS' THEN RAISE EXCEPTION 'utilts_err_own_source_unavailable';END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);a:=gridex_ack_authority.wire_v1(m.raw_payload);s:=gridex_ack_authority.wire_v1(source.raw_payload);
 IF tokens IS NULL OR a IS NULL OR s IS NULL OR a->>'family' IS DISTINCT FROM 'UTILTS' OR a->>'code' IS DISTINCT FROM 'ERR'
  OR NOT coalesce(gridex_ack_authority.source_match_v1(a,s),false) THEN RAISE EXCEPTION 'utilts_err_own_source_unavailable';END IF;
 facet:=gridex_received_sources.require_utilts_functional_responses_v1(m.company_id,source.id);
 IF facet->>'version' IS DISTINCT FROM '1' OR facet->>'sourcePayloadHash' IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') OR jsonb_typeof(facet->'transactions') IS DISTINCT FROM 'array'
  OR (SELECT count(*) FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='IDE')=0 THEN RAISE EXCEPTION 'utilts_err_own_functional_facet_required';END IF;
 FOR t IN SELECT x FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='IDE' ORDER BY(x->>'index')::int LOOP
  group_start:=(t->>'index')::int;SELECT min((x->>'index')::int) INTO group_end FROM jsonb_array_elements(tokens)x WHERE(x->>'index')::int>group_start AND x->>'tag' IN('IDE','UNT','UNZ');
  own_id:=t#>>'{elements,2,0}';
  IF t#>>'{elements,1,0}' IS DISTINCT FROM '24' OR nullif(own_id,'') IS NULL OR own_id=ANY(own_ids) THEN RAISE EXCEPTION 'utilts_err_own_functional_facet_required';END IF;own_ids:=array_append(own_ids,own_id);
  SELECT count(*) INTO count_refs FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='STS' AND x#>>'{elements,1,0}'='E01' AND(x->>'index')::int>group_start AND(x->>'index')::int<group_end;
  IF count_refs<>1 THEN RAISE EXCEPTION 'utilts_err_own_functional_facet_required';END IF;
  SELECT x->'elements' INTO sts FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='STS' AND x#>>'{elements,1,0}'='E01' AND(x->>'index')::int>group_start AND(x->>'index')::int<group_end;
  national_code:=sts#>>'{3,0}';
  IF sts->1 IS DISTINCT FROM '["E01","","260"]'::jsonb OR sts->2 IS DISTINCT FROM '["41"]'::jsonb OR sts->3 IS DISTINCT FROM jsonb_build_array(national_code,'','260') OR jsonb_array_length(sts)>4 OR nullif(national_code,'') IS NULL THEN RAISE EXCEPTION 'utilts_err_own_functional_facet_required';END IF;
  SELECT count(*) INTO count_refs FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='TN' AND(x->>'index')::int>group_start AND(x->>'index')::int<group_end;
  IF count_refs<>1 THEN RAISE EXCEPTION 'utilts_err_own_functional_facet_required';END IF;
  SELECT x#>'{elements,1}' INTO reference FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'='TN' AND(x->>'index')::int>group_start AND(x->>'index')::int<group_end;
  transaction_id:=reference->>1;
  IF reference IS DISTINCT FROM jsonb_build_array('TN',transaction_id) OR nullif(transaction_id,'') IS NULL OR NOT coalesce(s->'ide','[]') ? transaction_id OR (transaction_id||'|'||national_code)=ANY(seen) THEN RAISE EXCEPTION 'utilts_err_own_functional_facet_required';END IF;seen:=array_append(seen,transaction_id||'|'||national_code);
  SELECT count(*) INTO count_refs FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'=s->>'code' AND(x->>'index')::int>group_start AND(x->>'index')::int<group_end;
  IF count_refs<>1 THEN RAISE EXCEPTION 'utilts_err_own_functional_facet_required';END IF;
  SELECT x#>'{elements,1}' INTO original_reference FROM jsonb_array_elements(tokens)x WHERE x->>'tag'='RFF' AND x#>>'{elements,1,0}'=s->>'code' AND(x->>'index')::int>group_start AND(x->>'index')::int<group_end;
  IF original_reference IS DISTINCT FROM jsonb_build_array(s->>'code',s->>'document') THEN RAISE EXCEPTION 'utilts_err_own_functional_facet_required';END IF;
  SELECT count(*) INTO count_refs FROM jsonb_array_elements(facet->'transactions')x WHERE x->>'transactionId'=transaction_id;IF count_refs<>1 THEN RAISE EXCEPTION 'utilts_err_own_functional_facet_required';END IF;
  SELECT x INTO own_facet FROM jsonb_array_elements(facet->'transactions')x WHERE x->>'transactionId'=transaction_id;
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(own_facet->'errors')x WHERE x->>'code'=national_code AND x->>'referenceQualifier'='TN' AND x->>'referenceNumber'=transaction_id) THEN RAISE EXCEPTION 'utilts_err_own_functional_facet_required';END IF;
  SELECT * INTO reservation FROM public.ediel_ack_transaction_results WHERE company_id=m.company_id AND environment=m.environment AND source_message_id=source.id AND source_transaction_id=transaction_id FOR SHARE;
  IF NOT FOUND OR reservation.planned_response_type IS DISTINCT FROM 'utilts_err' OR reservation.disposition IS DISTINCT FROM 'processability_rejected'
   OR (reservation.final_response_type IS NOT NULL AND reservation.final_response_type<>'utilts_err') OR (p_sending AND (reservation.final_response_type IS DISTINCT FROM 'utilts_err' OR reservation.response_message_id IS DISTINCT FROM m.id OR reservation.finalized_at IS NULL)) THEN RAISE EXCEPTION 'utilts_err_own_reservation_unavailable';END IF;
 END LOOP;
END $$;
-- One-use INSERT calls assert_message; fresh owner preparation also fences the
-- exact own functional source before issuing a witness. Existing observed
-- provider receipts return from their previous immutable wrappers first.
ALTER FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb) RENAME TO prepare_before_utilts_err_source_v1;
CREATE FUNCTION gridex_ediel_outbound_owner.prepare_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;a jsonb;
BEGIN
 a:=gridex_ack_authority.wire_v1(p_input->>'rawPayload');
 IF a->>'family'='UTILTS' AND a->>'code'='ERR' THEN m.company_id:=(p_input->>'companyId')::uuid;m.environment:=p_input->>'environment';m.direction:='outbound';m.message_family:='UTILTS_ERR';m.message_code:='ERR';m.raw_payload:=p_input->>'rawPayload';m.related_message_id:=(p_input->>'relatedMessageId')::uuid;PERFORM gridex_ediel_outbound_owner.require_utilts_err_source_v1(m,false);END IF;
 RETURN gridex_ediel_outbound_owner.prepare_before_utilts_err_source_v1(p_input);
END $$;
ALTER FUNCTION gridex_ediel_outbound_owner.assert_message_v1(public.ediel_messages,gridex_ediel_outbound_owner.witnesses) RENAME TO assert_message_before_utilts_err_source_v1;
CREATE FUNCTION gridex_ediel_outbound_owner.assert_message_v1(m public.ediel_messages,w gridex_ediel_outbound_owner.witnesses) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN PERFORM gridex_ediel_outbound_owner.assert_message_before_utilts_err_source_v1(m,w);PERFORM gridex_ediel_outbound_owner.require_utilts_err_source_v1(m,false);END $$;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_utilts_err_source_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;
BEGIN
 result:=gridex_ediel_transport.mutate_before_utilts_err_source_v1(p_input);
 IF p_input->>'action' IN('prepare','enter') AND result->>'proceed'='true' THEN SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid AND company_id=(p_input->>'companyId')::uuid AND environment=p_input->>'environment' AND direction='outbound' FOR SHARE;PERFORM gridex_ediel_outbound_owner.require_utilts_err_source_v1(m,true);END IF;RETURN result;
END $$;
ALTER FUNCTION gridex_outbound_dispatch.mutate_v1(jsonb) RENAME TO mutate_before_utilts_err_source_v1;
CREATE FUNCTION gridex_outbound_dispatch.mutate_v1(p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;m public.ediel_messages%rowtype;
BEGIN
 result:=gridex_outbound_dispatch.mutate_before_utilts_err_source_v1(p_input);
 IF p_input->>'action' IN('prepare','enter') AND result->>'proceed'='true' THEN SELECT * INTO STRICT m FROM public.ediel_messages WHERE id=(p_input->>'messageId')::uuid AND company_id=(p_input->>'companyId')::uuid AND environment=p_input->>'environment' AND direction='outbound' FOR SHARE;PERFORM gridex_ediel_outbound_owner.require_utilts_err_source_v1(m,true);END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_outbound_owner.require_utilts_err_source_v1(public.ediel_messages,boolean),gridex_ediel_outbound_owner.prepare_before_utilts_err_source_v1(jsonb),gridex_ediel_outbound_owner.prepare_v1(jsonb),gridex_ediel_outbound_owner.assert_message_before_utilts_err_source_v1(public.ediel_messages,gridex_ediel_outbound_owner.witnesses),gridex_ediel_outbound_owner.assert_message_v1(public.ediel_messages,gridex_ediel_outbound_owner.witnesses),gridex_ediel_transport.mutate_before_utilts_err_source_v1(jsonb),gridex_outbound_dispatch.mutate_before_utilts_err_source_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_outbound_owner.prepare_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb),gridex_outbound_dispatch.mutate_v1(jsonb) TO service_role;
COMMIT;
