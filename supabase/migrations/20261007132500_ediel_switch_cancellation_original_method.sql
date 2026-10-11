-- A C-Z03 withdraws the immutable L/LK original, including its qualified217.
-- Read the original signed declaration binding, not today's new-contract
-- authorization. Current withdrawal authority remains in context_v1. Neither
-- that context nor the immutable cancellation reservation basis is changed.
BEGIN;
CREATE FUNCTION gridex_switch_cancellations.original_method_v1(c uuid,original uuid,expected_hash text,expected_environment text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;o gridex_received_sources.switch_originals%rowtype;
 binding gridex_received_sources.switch_contract_request_bindings%rowtype;
 d gridex_metering_method_changes.contract_request_declarations%rowtype;
 w jsonb;own jsonb;method text;frozen jsonb;prior_legal jsonb;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=original AND company_id=c FOR SHARE;
 SELECT * INTO o FROM gridex_received_sources.switch_originals WHERE message_id=m.id AND company_id=c FOR SHARE;
 SELECT * INTO binding FROM gridex_received_sources.switch_contract_request_bindings WHERE message_id=m.id AND company_id=c FOR SHARE;
 SELECT * INTO d FROM gridex_metering_method_changes.contract_request_declarations WHERE id=binding.declaration_id AND company_id=c FOR SHARE;
 IF m.id IS NULL OR o.message_id IS NULL OR binding.message_id IS NULL OR d.id IS NULL
  OR m.environment IS DISTINCT FROM expected_environment OR m.direction IS DISTINCT FROM 'outbound'
  OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z03'
  OR m.immutable_rendered_at IS NULL OR m.immutable_payload_hash IS DISTINCT FROM expected_hash
  OR o.payload_hash IS DISTINCT FROM expected_hash OR binding.payload_hash IS DISTINCT FROM expected_hash
  OR expected_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')
  OR gridex_received_sources.sent_source_is_current_v1(m) IS NOT TRUE THEN RETURN NULL;END IF;
 w:=gridex_received_sources.switch_origin_wire_v1(m.raw_payload);own:=w#>'{objects,0}';
 method:=gridex_received_sources.switch_requested_method_v1(m.raw_payload);
 IF w IS NULL OR own IS DISTINCT FROM o.original_object OR (own->>'reason' IN('Z22','Z23')) IS NOT TRUE
  OR method IS NULL OR method IS DISTINCT FROM binding.requested_method OR method IS DISTINCT FROM d.requested_method
  OR d.environment IS DISTINCT FROM m.environment OR d.contract_id IS DISTINCT FROM o.contract_id OR d.protected_contract_hash IS DISTINCT FROM o.contract_hash
  OR d.customer_id IS DISTINCT FROM m.customer_id OR d.site_id IS DISTINCT FROM m.site_id OR d.metering_point_id IS DISTINCT FROM m.metering_point_id
  OR d.point_id IS DISTINCT FROM own->>'point' OR d.identity_agency IS DISTINCT FROM own->>'identityAgency'
  OR d.grid_area_code IS DISTINCT FROM own->>'gridArea' OR d.legal_sender_id IS DISTINCT FROM w->>'sender' OR d.legal_receiver_id IS DISTINCT FROM w->>'receiver'
 THEN RETURN NULL;END IF;
 prior_legal:=gridex_ediel_inbound_context.require_v1(c,m.id);
 IF d.legal_actor_id::text IS DISTINCT FROM prior_legal->>'legalActorId' THEN RETURN NULL;END IF;
 -- This is the existing immutable declaration's original evidence projection.
 -- No current-declaration selection, revocation lookup or contract reapproval.
 frozen:=jsonb_build_object('status','authorized','declarationId',d.id,'companyId',c,'environment',d.environment,'contractId',d.contract_id,
  'contractRevision',d.contract_revision,'protectedContractHash',d.protected_contract_hash,'agreementSha256',d.agreement_sha256,
  'customerId',d.customer_id,'siteId',d.site_id,'meteringPointId',d.metering_point_id,'pointId',d.point_id,'identityAgency',d.identity_agency,
  'legalActorId',d.legal_actor_id,'legalSenderId',d.legal_sender_id,'legalReceiverId',d.legal_receiver_id,'gridArea',d.grid_area_code,
  'requestedMethod',d.requested_method,'sourceReference',d.source_reference,'sourceVersion',d.source_version,'sourceDigest',d.source_sha256);
 IF binding.source_basis IS DISTINCT FROM frozen THEN RETURN NULL;END IF;
 RETURN method;
END$$;
CREATE FUNCTION gridex_switch_cancellations.require_original_method_v1(c uuid,original uuid,expected_hash text,expected_environment text,raw text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE method text:=gridex_switch_cancellations.original_method_v1(c,original,expected_hash,expected_environment);
BEGIN
 IF method IS NULL OR gridex_received_sources.switch_requested_method_v1(raw) IS DISTINCT FROM method
 THEN RAISE EXCEPTION 'switch_cancellation_exact_original_method_required';END IF;
END$$;
REVOKE ALL ON FUNCTION gridex_switch_cancellations.original_method_v1(uuid,uuid,text,text),gridex_switch_cancellations.require_original_method_v1(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;

-- Patch the current bodies in place, preserving later physical-scope fixes,
-- function identities, configuration and ACLs. Every predecessor is exact and
-- singleton; a different body aborts the entire migration.
DO $rewrite$
DECLARE f record;spec record;body text;
BEGIN
 FOR spec IN SELECT * FROM (VALUES
 ('public.ediel_switch_cancellation_source_v1(uuid,uuid,uuid)',
  $n$BEGIN RETURN gridex_switch_cancellations.context_v1(p_company_id,p_switch_id,p_actor_user_id);END $n$,
  $n$DECLARE b jsonb;method text;
BEGIN
 b:=gridex_switch_cancellations.context_v1(p_company_id,p_switch_id,p_actor_user_id);
 IF b->>'status' IS DISTINCT FROM 'authorized' THEN RETURN b;END IF;
 method:=gridex_switch_cancellations.original_method_v1(p_company_id,(b->>'originalMessageId')::uuid,b->>'originalHash',b->>'environment');
 IF method IS NULL THEN RETURN jsonb_build_object('status','held','missing',ARRAY['qualified_immutable_original_requested_method']);END IF;
 RETURN b||jsonb_build_object('requestedMethod',method);
END $n$),
 ('gridex_switch_cancellations.bind_message_v1()',
  $n$ IF o.message_id IS NOT NULL THEN RAISE EXCEPTION 'switch_cancellation_original_already_bound';END IF;$n$,
  $n$ PERFORM gridex_switch_cancellations.require_original_method_v1(o.company_id,o.original_message_id,o.original_hash,NEW.environment,NEW.raw_payload);
 IF o.message_id IS NOT NULL THEN RAISE EXCEPTION 'switch_cancellation_original_already_bound';END IF;$n$),
 ('public.ediel_require_switch_cancellation_source_current_v1(uuid,uuid)',
  $n$ IF b->>'status' IS DISTINCT FROM 'authorized' OR (b-ARRAY['operationId','intentId','outboundRequestId','messageId']) IS DISTINCT FROM o.basis THEN RAISE EXCEPTION 'switch_cancellation_current_source_held';END IF;$n$,
  $n$ IF b->>'status' IS DISTINCT FROM 'authorized' OR (b-ARRAY['operationId','intentId','outboundRequestId','messageId']) IS DISTINCT FROM o.basis THEN RAISE EXCEPTION 'switch_cancellation_current_source_held';END IF;
 PERFORM gridex_switch_cancellations.require_original_method_v1(o.company_id,o.original_message_id,o.original_hash,m.environment,m.raw_payload);$n$)
 ) AS x(signature,needle,replacement) LOOP
  SELECT p.oid,to_jsonb(p)-'prosrc' metadata,p.prosrc,pg_get_functiondef(p.oid) definition INTO STRICT f FROM pg_proc p WHERE oid=spec.signature::regprocedure;
  IF (length(f.prosrc)-length(replace(f.prosrc,spec.needle,'')))/length(spec.needle)<>1 THEN RAISE EXCEPTION 'switch_cancellation_method_predecessor_required:%',spec.signature;END IF;
  body:=replace(f.prosrc,spec.needle,spec.replacement);
  EXECUTE replace(f.definition,f.prosrc,body);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'switch_cancellation_method_metadata_changed:%',spec.signature;END IF;
 END LOOP;
END$rewrite$;
COMMIT;
