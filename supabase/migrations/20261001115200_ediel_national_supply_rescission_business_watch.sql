-- National Z08H uses the existing accepted-source watch and immutable matched
-- end ledger. SMTP is an uncertain sender clock, never remote receipt or end.
BEGIN;
-- Preserve every source predicate from the installed bilateral owner. Historic
-- renderer READ is not execution authority for today's sender or consumer.
DO $source$DECLARE d text;b text;needle text;BEGIN
 d:=pg_get_functiondef('gridex_bilateral_prodat.require_recorded_outbound_v1(public.ediel_messages,uuid)'::regprocedure);
 SELECT prosrc INTO STRICT b FROM pg_proc WHERE oid='gridex_bilateral_prodat.require_recorded_outbound_v1(public.ediel_messages,uuid)'::regprocedure;
 needle:=E' IF gridex_bilateral_prodat.actor_v1(m.company_id,actor,''read'') IS NOT TRUE THEN RAISE EXCEPTION ''bilateral_prodat_outbound_recorded_actor_forbidden'' USING ERRCODE=''42501'';END IF;\n';
 IF position(needle IN b)=0 OR position('recorded_profile_authority_v1' IN b)=0 OR position('gridex_ediel_outbound_owner.consumptions' IN b)=0 OR position('gridex_ediel_source_rules.receipts' IN b)=0 THEN RAISE EXCEPTION 'supply_rescission_bilateral_source_owner_contract_changed';END IF;
 d:=replace(replace(d,'CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.require_recorded_outbound_v1(','CREATE OR REPLACE FUNCTION gridex_bilateral_prodat.require_recorded_outbound_source_current_v1('),', actor uuid)',')');
 IF position('require_recorded_outbound_source_current_v1' IN d)=0 THEN RAISE EXCEPTION 'supply_rescission_bilateral_source_signature_changed';END IF;
 EXECUTE replace(d,b,replace(b,needle,''));
END$source$;
CREATE FUNCTION public.ediel_qualify_persisted_prodat_outbound_source_v1(p_company_id uuid,p_actor_user_id uuid,p_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE m public.ediel_messages%rowtype;cap jsonb;BEGIN
 IF gridex_supply_rescission.sender_v1(p_company_id,p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_outbound_current_sender_required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF m.id IS NULL OR m.direction IS DISTINCT FROM 'outbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' THEN IF gridex_supply_rescission.sender_v1(p_company_id,p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_outbound_terminal_sender_required' USING ERRCODE='42501';END IF;RETURN NULL;END IF;
 IF gridex_supply_rescission.outbound_required_v1(m.raw_payload) IS TRUE THEN
  PERFORM gridex_supply_rescission.require_recorded_outbound_source_current_v1(m);
  SELECT capability INTO cap FROM gridex_supply_rescission.outbound_operations WHERE message_id=m.id AND company_id=m.company_id;
 ELSIF gridex_bilateral_prodat.outbound_required_v1(m.raw_payload) IS TRUE THEN
  PERFORM public.ediel_require_source_bytes_available_v1(m.company_id,m.id);
  PERFORM gridex_bilateral_prodat.require_recorded_outbound_source_current_v1(m);
  SELECT capability INTO cap FROM gridex_bilateral_prodat.outbound_operations WHERE message_id=m.id AND company_id=m.company_id;
 ELSE IF gridex_supply_rescission.sender_v1(p_company_id,p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_outbound_terminal_sender_required' USING ERRCODE='42501';END IF;RETURN NULL;END IF;
 IF cap->>'actorUserId' IS DISTINCT FROM m.created_by::text OR cap->>'payloadHash' IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'prodat_outbound_original_provenance_required';END IF;
 IF gridex_supply_rescission.sender_v1(p_company_id,p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION 'prodat_outbound_terminal_sender_required' USING ERRCODE='42501';END IF;
 RETURN cap||jsonb_build_object('originalActorUserId',cap->>'actorUserId','actorUserId',p_actor_user_id);
END$$;
CREATE FUNCTION public.ediel_qualify_supply_rescission_prepared_original_v1(p_company_id uuid,p_actor_user_id uuid,p_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE m public.ediel_messages%rowtype;cap jsonb;BEGIN
 IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,'archive') IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_current_prepare_actor_required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF m.id IS NULL OR gridex_supply_rescission.outbound_required_v1(m.raw_payload) IS NOT TRUE THEN IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,'archive') IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_terminal_prepare_actor_required' USING ERRCODE='42501';END IF;RETURN NULL;END IF;
 PERFORM gridex_supply_rescission.require_recorded_outbound_source_current_v1(m);
 SELECT capability INTO cap FROM gridex_supply_rescission.outbound_operations WHERE message_id=m.id AND company_id=m.company_id;
 IF gridex_supply_rescission.actor_v1(p_company_id,p_actor_user_id,'archive') IS NOT TRUE THEN RAISE EXCEPTION 'supply_rescission_terminal_prepare_actor_required' USING ERRCODE='42501';END IF;
 RETURN cap||jsonb_build_object('originalActorUserId',cap->>'actorUserId','actorUserId',p_actor_user_id);
END$$;
REVOKE ALL ON FUNCTION public.ediel_qualify_supply_rescission_prepared_original_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_qualify_supply_rescission_prepared_original_v1(uuid,uuid,uuid) TO service_role;
-- Original disclosure remains a READ operation with an explicit current actor.
-- Keep the old two-argument owner as private compatibility code, not a bypass.
CREATE FUNCTION public.ediel_read_bilateral_prodat_outbound_original_v1(p_company_id uuid,p_actor_user_id uuid,p_message_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE m public.ediel_messages%rowtype;cap jsonb;BEGIN
 IF gridex_bilateral_prodat.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'bilateral_prodat_outbound_current_reader_required' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_message_id AND company_id=p_company_id FOR SHARE;
 IF m.id IS NULL OR gridex_bilateral_prodat.outbound_required_v1(m.raw_payload) IS NOT TRUE THEN IF gridex_bilateral_prodat.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'bilateral_prodat_outbound_terminal_reader_required' USING ERRCODE='42501';END IF;RETURN NULL;END IF;
 PERFORM public.ediel_require_source_bytes_available_v1(m.company_id,m.id);PERFORM gridex_bilateral_prodat.require_recorded_outbound_source_current_v1(m);
 SELECT capability INTO cap FROM gridex_bilateral_prodat.outbound_operations WHERE message_id=m.id AND company_id=m.company_id;
 IF gridex_bilateral_prodat.actor_v1(p_company_id,p_actor_user_id,'read') IS NOT TRUE THEN RAISE EXCEPTION 'bilateral_prodat_outbound_terminal_reader_required' USING ERRCODE='42501';END IF;
 RETURN cap||jsonb_build_object('originalActorUserId',cap->>'actorUserId','actorUserId',p_actor_user_id);
END$$;
REVOKE ALL ON FUNCTION gridex_bilateral_prodat.require_recorded_outbound_source_current_v1(public.ediel_messages),public.ediel_read_bilateral_prodat_outbound_original_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_qualify_persisted_prodat_outbound_source_v1(uuid,uuid,uuid),public.ediel_read_bilateral_prodat_outbound_original_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_qualify_persisted_prodat_outbound_source_v1(uuid,uuid,uuid),public.ediel_read_bilateral_prodat_outbound_original_v1(uuid,uuid,uuid) TO service_role;

-- Adapt the installed watch, retaining its guards, journal lane and earlier
-- Z01/Z13/Z18 policy. H has no invented numeric deadline or automatic resend.
DO $watch$DECLARE signature text;d text;b text;old text;BEGIN
 signature:='gridex_business_expectations.mutate_v1(jsonb)';d:=pg_get_functiondef(signature::regprocedure);SELECT prosrc INTO STRICT b FROM pg_proc WHERE oid=signature::regprocedure;
 IF position('ediel_expectation_prepared_policy_missing' IN b)=0 OR position('gridex_business_expectations.bindings' IN b)=0 OR position('code NOT IN (''Z01'',''Z13'',''Z18'')' IN b)=0 THEN RAISE EXCEPTION 'supply_rescission_existing_watch_contract_changed';END IF;
 old:=b;
 b:=replace(b,E'  IF code NOT IN (''Z01'',''Z13'',''Z18'') THEN RETURN ''[]''::jsonb; END IF;',E'  IF code NOT IN (''Z01'',''Z13'',''Z18'',''Z08'') THEN RETURN ''[]''::jsonb; END IF;\n  IF code=''Z08'' THEN\n   IF gridex_supply_rescission.outbound_required_v1(m.raw_payload) IS NOT TRUE THEN RETURN ''[]''::jsonb;END IF;\n   PERFORM gridex_supply_rescission.require_recorded_outbound_source_current_v1(m);\n   IF gridex_supply_rescission.sender_v1(c,actor) IS NOT TRUE THEN RAISE EXCEPTION ''ediel_expectation_h_sender_required'' USING ERRCODE=''42501'';END IF;\n  END IF;');
 b:=replace(b,'WHEN ''Z18'' THEN ''Z15'' END','WHEN ''Z18'' THEN ''Z15'' WHEN ''Z08'' THEN ''Z05'' END');
 b:=replace(b,E'  due:=NULL;',E'  IF code=''Z08'' AND plan->''expectedSubtypes'' IS DISTINCT FROM ''["L"]''::jsonb THEN RAISE EXCEPTION ''ediel_expectation_h_exact_response_required'';END IF;\n  due:=NULL;');
 b:=replace(b,'IF code=''Z18'' THEN','IF code IN(''Z18'',''Z08'') THEN');
 b:=replace(b,'''PRODAT'',plan->>''expectedCode'',NULL,due,','''PRODAT'',plan->>''expectedCode'',CASE code WHEN ''Z08'' THEN ''L'' ELSE NULL END,due,');
 b:=replace(b,'RETURN jsonb_build_array',E'IF code=''Z08'' AND gridex_supply_rescission.sender_v1(c,actor) IS NOT TRUE THEN RAISE EXCEPTION ''ediel_expectation_h_terminal_sender_required'' USING ERRCODE=''42501'';END IF;\n   RETURN jsonb_build_array');
 IF b=old OR position('ediel_expectation_h_exact_response_required' IN b)=0 OR position('WHEN ''Z08'' THEN ''L''' IN b)=0 THEN RAISE EXCEPTION 'supply_rescission_h_watch_anchors_changed';END IF;EXECUTE replace(d,old,b);
 signature:='public.ediel_project_accepted_source_state_v1(uuid,text,uuid,uuid,text)';d:=pg_get_functiondef(signature::regprocedure);SELECT prosrc INTO STRICT b FROM pg_proc WHERE oid=signature::regprocedure;old:=b;
 b:=replace(b,'m.message_code IN(''Z01'',''Z13'',''Z18'')','(m.message_code IN(''Z01'',''Z13'',''Z18'') OR m.message_code=''Z08'' AND gridex_supply_rescission.outbound_required_v1(m.raw_payload) IS TRUE)');
 b:=replace(b,'RETURN jsonb_build_object(''status'',''source_projection''',E'IF m.message_code=''Z08'' AND gridex_supply_rescission.outbound_required_v1(m.raw_payload) IS TRUE AND gridex_supply_rescission.sender_v1(p_company_id,p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION ''ediel_h_projection_terminal_sender_required'' USING ERRCODE=''42501'';END IF;\n RETURN jsonb_build_object(''status'',''source_projection''');
 IF b=old OR position('ediel_source_projection_frozen_expectation_required' IN b)=0 THEN RAISE EXCEPTION 'supply_rescission_atomic_projection_contract_changed';END IF;EXECUTE replace(d,old,b);
END$watch$;
ALTER FUNCTION gridex_business_expectations.reconcile_v1(uuid) RENAME TO reconcile_before_supply_rescission_v1;
CREATE FUNCTION gridex_business_expectations.reconcile_v1(p_expectation uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE b gridex_business_expectations.bindings%rowtype;e public.ediel_business_expectations%rowtype;r gridex_supply_rescission.end_receipts%rowtype;original public.ediel_messages%rowtype;BEGIN
 SELECT * INTO b FROM gridex_business_expectations.bindings WHERE expectation_id=p_expectation;
 SELECT * INTO e FROM public.ediel_business_expectations WHERE id=p_expectation AND company_id=b.company_id AND environment=b.environment FOR UPDATE;
 IF e.id IS NULL OR e.expected_code IS DISTINCT FROM 'Z05' OR b.plan->>'sourceCode' IS DISTINCT FROM 'Z08' THEN PERFORM gridex_business_expectations.reconcile_before_supply_rescission_v1(p_expectation);RETURN;END IF;
 IF e.status NOT IN('pending','timeout','manual_review') THEN RETURN;END IF;
 SELECT * INTO original FROM public.ediel_messages WHERE id=b.source_message_id AND company_id=b.company_id AND environment=b.environment;
 IF original.id IS NULL OR b.source_payload_hash IS DISTINCT FROM original.immutable_payload_hash OR b.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(original.raw_payload,'UTF8')),'hex') OR e.expected_subtype IS DISTINCT FROM 'L' OR b.plan->'expectedSubtypes' IS DISTINCT FROM '["L"]'::jsonb THEN RAISE EXCEPTION 'ediel_expectation_h_original_changed';END IF;
 PERFORM gridex_supply_rescission.require_recorded_outbound_source_current_v1(original);
 SELECT receipt.* INTO r FROM gridex_supply_rescission.end_receipts receipt JOIN public.ediel_messages source ON source.id=receipt.source_message_id AND source.company_id=receipt.company_id AND source.environment=receipt.environment
 WHERE receipt.company_id=b.company_id AND receipt.environment=b.environment AND receipt.original_message_id=b.source_message_id AND receipt.original_payload_hash=b.source_payload_hash
 AND receipt.source_payload_hash=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex') AND source.direction='inbound' AND gridex_supply_rescission.recorded_end_current_v1(b.company_id,receipt.source_message_id) IS TRUE;
 IF r.source_message_id IS NULL THEN RETURN;END IF;
 UPDATE public.ediel_business_expectations SET status='fulfilled',fulfilled_by_message_id=r.source_message_id,updated_at=clock_timestamp(),metadata=metadata||jsonb_build_object('resolvedBy','immutable_matched_national_h_end','resolvedAt',clock_timestamp(),'mandateId',r.mandate_id,'sourcePayloadHash',r.source_payload_hash,'originalPayloadHash',r.original_payload_hash,'transitionHash',r.transition_hash) WHERE id=e.id;
END$$;
CREATE FUNCTION gridex_supply_rescission.end_watch_applied_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE e uuid;BEGIN
 FOR e IN SELECT expectation_id FROM gridex_business_expectations.bindings WHERE company_id=NEW.company_id AND environment=NEW.environment AND source_message_id=NEW.original_message_id ORDER BY expectation_id LOOP PERFORM gridex_business_expectations.reconcile_v1(e);END LOOP;RETURN NEW;
END$$;
CREATE TRIGGER supply_rescission_matched_end_watch AFTER INSERT ON gridex_supply_rescission.end_receipts FOR EACH ROW EXECUTE FUNCTION gridex_supply_rescission.end_watch_applied_v1();
REVOKE ALL ON FUNCTION gridex_business_expectations.reconcile_before_supply_rescission_v1(uuid),gridex_business_expectations.reconcile_v1(uuid),gridex_supply_rescission.end_watch_applied_v1() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
