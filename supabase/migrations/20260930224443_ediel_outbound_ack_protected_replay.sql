-- Created by Supabase CLI 2.118.0. Outbound response replay is a read-only
-- native command over the actual original and consumed immutable own response.
-- Current actor grants/namespace are checked, never a current route or guide.
BEGIN;
CREATE SCHEMA gridex_ediel_ack_replay;
REVOKE ALL ON SCHEMA gridex_ediel_ack_replay FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA gridex_ediel_ack_replay TO service_role;
CREATE FUNCTION gridex_ediel_ack_replay.read_v1(c uuid,env text,source_id uuid,actor uuid,family text,sequence_field text,sequence_value text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE source public.ediel_messages%rowtype;ack public.ediel_messages%rowtype;ids uuid[];context jsonb;ack_context jsonb;basis jsonb;own_basis jsonb;
 a jsonb;s jsonb;tokens jsonb;common_source boolean;observed timestamptz:=clock_timestamp();companies uuid[];wire_outcome text;
BEGIN
 IF c IS NULL OR actor IS NULL OR source_id IS NULL OR env IS NULL OR env NOT IN('test','production') OR family IS NULL OR family NOT IN('CONTRL','APERAK','UTILTS_ERR')
  OR (sequence_field IS NULL)<>(sequence_value IS NULL) OR sequence_field IS NOT NULL AND (sequence_field NOT IN('relatedTransactionReference','utiltsErrSequenceToken') OR nullif(btrim(sequence_value),'') IS NULL)
  OR family='CONTRL' AND sequence_field IS NOT NULL OR sequence_field='utiltsErrSequenceToken' AND family<>'UTILTS_ERR' THEN
  RAISE EXCEPTION 'ediel_ack_replay_scope_required' USING ERRCODE='22023';END IF;
 -- A permission decision must remain true through source/ACK qualification.
 -- SHARE prevents UPDATE/DELETE and phantom INSERT grants/namespace collisions;
 -- all permission sources used by the current native resolver are included.
 LOCK TABLE auth.users,public.user_profiles,public.companies,public.company_memberships,public.admin_users,
  public.user_roles,public.roles,public.role_permissions,public.permissions,public.user_permissions,
  public.tenant_actor_identifiers,public.tenant_counterparty_relations,public.platform_actor_identifiers IN SHARE MODE;
 IF NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
  OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
  OR NOT EXISTS(SELECT FROM public.companies co WHERE co.id=c AND co.status='active') THEN
  RAISE EXCEPTION 'ediel_ack_replay_actor_not_authorized' USING ERRCODE='42501';END IF;
 -- Stabilize the entire own-source candidate set, including opposite outcomes.
 -- A later concurrent INSERT is re-read through this same command after 23505.
 LOCK TABLE public.ediel_messages IN SHARE MODE;
 SELECT * INTO source FROM public.ediel_messages WHERE id=source_id AND environment=env AND direction='inbound'
  AND message_standard='edifact' AND (company_id=c OR company_id IS NULL) FOR SHARE;
 IF source.id IS NULL OR nullif(source.raw_payload,'') IS NULL THEN RAISE EXCEPTION 'ediel_ack_replay_actual_source_unavailable';END IF;
 common_source:=family='APERAK' AND source.message_family='PRODAT' AND EXISTS(SELECT FROM gridex_ediel_common_header.sources p WHERE p.source_message_id=source.id AND p.company_id=c AND p.environment=env AND p.status='ready');
 IF public.gridex_actor_has_company_permission(actor,c,'communication.write') IS NOT TRUE
  AND NOT(env='test' AND (family='CONTRL' OR common_source) AND public.gridex_actor_has_company_permission(actor,c,'ediel_testing.write') IS TRUE) THEN
  RAISE EXCEPTION 'ediel_ack_replay_actor_not_authorized' USING ERRCODE='42501';END IF;
 IF family='CONTRL' THEN
  basis:=gridex_ediel_technical_ack.require_source_v1(c,source.id);
  PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(basis);
 ELSIF common_source THEN
  basis:=gridex_ediel_common_header.require_v1(c,env,source.id);
  PERFORM gridex_ediel_common_header.require_current_scope_v1(basis);
 ELSE
  IF source.company_id IS DISTINCT FROM c THEN RAISE EXCEPTION 'ediel_ack_replay_actual_source_unavailable';END IF;
  basis:=gridex_ediel_source_rules.require_v1(c,source.id);
  context:=gridex_ediel_inbound_context.require_v1(c,source.id);
  -- The immutable local legal recipient becomes the ACK issuer. Both wire
  -- legal parties and full transport components are matched below; only the
  -- current local namespace is resolved here, without profile/role re-selection.
  IF context->>'basisKind' IS DISTINCT FROM 'observed_source_persistence' OR context->>'companyId' IS DISTINCT FROM c::text OR context->>'environment' IS DISTINCT FROM env THEN RAISE EXCEPTION 'ediel_ack_replay_legal_scope_invalid';END IF;
  SELECT array_agg(DISTINCT i.company_id) INTO companies FROM public.tenant_actor_identifiers i WHERE i.environment=env AND i.identifier_type='EdielId'
   AND i.identifier_value=context->>'legalEdielId' AND i.valid_from<=observed AND (i.valid_to IS NULL OR observed<i.valid_to);
  IF cardinality(companies) IS DISTINCT FROM 1 OR companies[1] IS DISTINCT FROM c OR NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.company_id=c AND i.environment=env
   AND i.actor_id::text=context->>'legalActorId' AND i.identifier_type='EdielId' AND i.identifier_value=context->>'legalEdielId'
   AND i.valid_from<=observed AND (i.valid_to IS NULL OR observed<i.valid_to)) THEN RAISE EXCEPTION 'ediel_ack_replay_legal_scope_invalid';END IF;
  PERFORM gridex_ediel_technical_ack.require_current_endpoint_v1(context);
 END IF;
 SELECT array_agg(m.id ORDER BY m.id) INTO ids FROM public.ediel_messages m WHERE m.company_id=c AND m.environment=env AND m.direction='outbound'
  AND m.related_message_id=source.id AND m.message_family=family AND m.status NOT IN('cancelled','failed')
  AND CASE WHEN sequence_field IS NOT NULL THEN m.parsed_payload->>sequence_field=sequence_value
   ELSE nullif(m.parsed_payload->>'relatedTransactionReference','') IS NULL AND nullif(m.parsed_payload->>'utiltsErrSequenceToken','') IS NULL END;
 IF coalesce(cardinality(ids),0)=0 THEN RETURN NULL;END IF;
 IF cardinality(ids)<>1 THEN RAISE EXCEPTION 'ediel_ack_replay_own_response_ambiguous';END IF;
 SELECT * INTO STRICT ack FROM public.ediel_messages WHERE id=ids[1] AND company_id=c AND environment=env AND direction='outbound' AND related_message_id=source.id AND message_family=family FOR SHARE;
 IF NOT EXISTS(SELECT FROM gridex_ediel_wire_namespace.coverage w WHERE w.source_message_id=ack.id AND w.company_id=c AND w.environment=env
  AND w.payload_sha256=encode(sha256(convert_to(ack.raw_payload,'UTF8')),'hex')) THEN RAISE EXCEPTION 'ediel_ack_replay_private_own_wire_unavailable';END IF;
 IF family='CONTRL' THEN
  own_basis:=gridex_ediel_technical_ack.require_contrl_v1(ack);
  IF own_basis IS DISTINCT FROM basis THEN RAISE EXCEPTION 'ediel_ack_replay_original_basis_mismatch';END IF;
  wire_outcome:=CASE own_basis->>'syntaxDecision' WHEN 'accepted' THEN 'positive' WHEN 'rejected' THEN 'negative' END;
 ELSIF common_source THEN
  own_basis:=gridex_ediel_common_header.require_ack_v1(ack);
  IF own_basis IS DISTINCT FROM basis THEN RAISE EXCEPTION 'ediel_ack_replay_original_basis_mismatch';END IF;
  wire_outcome:='negative';
 ELSE
  own_basis:=gridex_ediel_outbound_owner.require_v1(c,ack.id);
  IF own_basis IS DISTINCT FROM basis OR gridex_ediel_source_rules.require_v1(c,ack.id) IS DISTINCT FROM basis
   OR NOT EXISTS(SELECT FROM gridex_ediel_source_rules.receipts r WHERE r.source_message_id=ack.id AND r.original_source_message_id=source.id) THEN RAISE EXCEPTION 'ediel_ack_replay_original_basis_mismatch';END IF;
  ack_context:=gridex_ediel_inbound_context.require_v1(c,ack.id);
  IF ack_context->>'basisKind' IS DISTINCT FROM 'prescribed_outbound_ack' OR ack_context->>'originalSourceMessageId' IS DISTINCT FROM source.id::text
   OR ack_context->>'originalSourceHash' IS DISTINCT FROM encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex')
   OR ack_context->>'legalActorId' IS DISTINCT FROM context->>'legalActorId' OR ack_context->>'legalEdielId' IS DISTINCT FROM context->>'legalEdielId'
   OR ack_context->>'transportActorId' IS DISTINCT FROM context->>'transportActorId' THEN RAISE EXCEPTION 'ediel_ack_replay_legal_scope_invalid';END IF;
  a:=gridex_ack_authority.wire_v1(ack.raw_payload);s:=gridex_ack_authority.wire_v1(source.raw_payload);
  IF NOT coalesce(gridex_ack_authority.source_match_v1(a,s),false) THEN RAISE EXCEPTION 'ediel_ack_replay_physical_source_mismatch';END IF;
  IF sequence_field='relatedTransactionReference' AND (NOT coalesce(s->'ide','[]') ? sequence_value
   OR NOT (CASE family WHEN 'APERAK' THEN coalesce(a#>'{refs,ACW}','[]') ELSE coalesce(a#>'{refs,TN}','[]') END) ? sequence_value
   OR ack.parsed_payload->>'ackScope' IS DISTINCT FROM 'transaction') THEN RAISE EXCEPTION 'ediel_ack_replay_sequence_mismatch';END IF;
  IF sequence_field='utiltsErrSequenceToken' THEN
   tokens:=gridex_utilts_binding.wire_tokens_v1(ack.raw_payload);
   IF NOT EXISTS(SELECT FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='STS' AND t#>>'{elements,1,0}'='E01' AND t#>>'{elements,2,0}'='41' AND t#>>'{elements,3,0}'=sequence_value) THEN RAISE EXCEPTION 'ediel_ack_replay_sequence_mismatch';END IF;
  END IF;
  wire_outcome:=CASE WHEN family='UTILTS_ERR' THEN 'negative' WHEN jsonb_array_length(coalesce(a->'erc','[]'))>0 AND NOT EXISTS(SELECT FROM jsonb_array_elements_text(a->'erc') x WHERE x<>'100') THEN 'positive' ELSE 'negative' END;
 END IF;
 PERFORM gridex_ediel_ack_guide.require_v1(ack);
 IF wire_outcome IS NULL OR ack.ack_outcome IS NOT NULL AND ack.ack_outcome IS DISTINCT FROM wire_outcome THEN RAISE EXCEPTION 'ediel_ack_replay_own_outcome_mismatch';END IF;
 RETURN jsonb_build_object('version',1,'sourceMessage',to_jsonb(source),'ackMessage',to_jsonb(ack)||jsonb_build_object('ack_outcome',wire_outcome));
END $$;
CREATE FUNCTION public.ediel_read_outbound_ack_replay_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_actor_user_id uuid,p_ack_family text,p_sequence_field text DEFAULT NULL,p_sequence_value text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 RETURN gridex_ediel_ack_replay.read_v1(p_company_id,p_environment,p_source_message_id,p_actor_user_id,p_ack_family,p_sequence_field,p_sequence_value);END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_replay.read_v1(uuid,text,uuid,uuid,text,text,text),public.ediel_read_outbound_ack_replay_v1(uuid,text,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION gridex_ediel_ack_replay.read_v1(uuid,text,uuid,uuid,text,text,text),public.ediel_read_outbound_ack_replay_v1(uuid,text,uuid,uuid,text,text,text) TO service_role;
COMMIT;
