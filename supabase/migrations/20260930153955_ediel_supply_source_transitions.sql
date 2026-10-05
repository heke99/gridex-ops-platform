-- Forward-only source attestation. Mutable operational rows are projections,
-- never authority for a beneficiary grant or a market transition.
BEGIN;
ALTER TABLE public.metering_permission_sites ADD COLUMN permission_end_at timestamptz;
ALTER TABLE gridex_received_sources.permission_transitions ADD COLUMN resulting_sites jsonb, ADD COLUMN qualified_original_message_id uuid REFERENCES public.ediel_messages(id) ON DELETE RESTRICT, ADD COLUMN qualified_expected_message_code text CHECK(qualified_expected_message_code IN ('Z14','Z15'));
CREATE OR REPLACE FUNCTION public.ediel_apply_permission_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid,p_expected_permission_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE m public.ediel_messages%rowtype; origin public.ediel_messages%rowtype; p public.metering_permissions%rowtype;
 wire jsonb; original jsonb; a jsonb; b jsonb; prior gridex_received_sources.permission_transitions%rowtype;
 ids uuid[]; mode text; reason text; next_status text; negative_status text; count_positive int:=0; count_negative int:=0;
 start_day date; end_day date; end_time timestamptz; before_state jsonb; before_sites jsonb; after_state jsonb; ended_source public.ediel_messages%rowtype; ended_wire jsonb; termination public.ediel_messages%rowtype; termination_wire jsonb; qualified_original uuid; qualified_code text;
BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR p_actor_user_id IS NULL THEN RETURN jsonb_build_object('applied',false,'reason','permission_source_unavailable'); END IF;
 IF NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,m.company_id,'metering.write'),false)
 OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=m.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
 THEN RETURN jsonb_build_object('applied',false,'reason','permission_execution_actor_unqualified'); END IF;
 SELECT * INTO prior FROM gridex_received_sources.permission_transitions WHERE source_message_id=m.id;
 IF FOUND THEN
  IF prior.company_id<>p_company_id OR prior.payload_hash<>encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR (p_expected_permission_id IS NOT NULL AND prior.permission_id<>p_expected_permission_id) THEN RAISE EXCEPTION 'permission_replay_conflict'; END IF;
  RETURN jsonb_build_object('applied',true,'idempotent',true,'permissionId',prior.permission_id,'status',prior.resulting_state->>'status');
 END IF;
 -- The real canonical runtime must have accepted this exact immutable payload.
 IF NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=m.company_id AND v.environment=m.environment
 AND v.source_payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') AND (v.facts_text::jsonb)->>'syntaxDecision'='accepted'
 AND (v.facts_text::jsonb)->>'applicationDecision'='accepted' AND (v.facts_text::jsonb)->>'functionalDecision'='accepted'
 AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN jsonb_build_object('applied',false,'reason','canonical_permission_source_not_accepted'); END IF;
 wire:=gridex_received_sources.permission_wire_v1(m.raw_payload);
 IF wire IS NULL OR (wire->>'code' IN ('Z14','Z15')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','permission_wire_unavailable'); END IF;
 -- Correlation is exact: permission owner, outbound original Z13, environment,
 -- opposite legal actors, and original LI. No unrelated unique-row fallback.
 SELECT array_agg(mp.id ORDER BY mp.id) INTO ids FROM public.metering_permissions mp
 JOIN public.ediel_messages z ON z.id=coalesce(mp.source_z13_message_id,mp.outbound_z13_message_id) AND z.company_id=mp.company_id AND z.environment=m.environment
 WHERE mp.company_id=m.company_id AND (p_expected_permission_id IS NULL OR mp.id=p_expected_permission_id)
 AND z.direction='outbound' AND z.status='sent' AND z.message_sent_at IS NOT NULL
 AND EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE nullif(o->>'li','') IS NOT NULL AND o->>'li'=mp.rff_li_reference);
 IF coalesce(cardinality(ids),0)<>1 THEN RETURN jsonb_build_object('applied',false,'reason','no_unique_source_bound_permission'); END IF;
 SELECT * INTO p FROM public.metering_permissions WHERE id=ids[1] AND company_id=m.company_id FOR UPDATE;
 SELECT * INTO origin FROM public.ediel_messages WHERE id=coalesce(p.source_z13_message_id,p.outbound_z13_message_id) AND company_id=m.company_id FOR SHARE;
 IF NOT FOUND OR origin.environment IS DISTINCT FROM m.environment OR origin.direction IS DISTINCT FROM 'outbound' OR origin.status IS DISTINCT FROM 'sent' OR origin.message_sent_at IS NULL
  OR origin.immutable_rendered_at IS NULL OR origin.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex')
 THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_not_sealed_and_sent'); END IF;
 original:=gridex_received_sources.permission_wire_v1(origin.raw_payload);
 IF original IS NULL OR original->>'code' IS DISTINCT FROM 'Z13' OR wire->>'sender' IS DISTINCT FROM original->>'receiver' OR wire->>'receiver' IS DISTINCT FROM original->>'sender'
 OR p.grid_owner_ediel_id IS DISTINCT FROM wire->>'sender' THEN RETURN jsonb_build_object('applied',false,'reason','permission_legal_actor_mismatch'); END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(original->'objects') o WHERE o->>'li'=p.rff_li_reference)<>1 OR origin.customer_id IS DISTINCT FROM p.customer_id THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_customer_scope_unavailable'); END IF;
 SELECT o INTO b FROM jsonb_array_elements(original->'objects') o WHERE o->>'li'=p.rff_li_reference;
 IF b IS NULL OR nullif(b->>'customerIdentity','') IS NULL OR (b->>'reason' IN ('S17','S18')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_mode_unavailable'); END IF;
 mode:=b->>'reason';before_state:=to_jsonb(p);
 PERFORM ps.id FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id ORDER BY ps.id FOR UPDATE;
 SELECT coalesce(jsonb_agg(to_jsonb(ps) ORDER BY ps.id),'[]'::jsonb) INTO before_sites FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id;
 IF wire->>'code'='Z14' THEN
  IF p.source_z13_message_id IS NOT NULL AND p.outbound_z13_message_id IS NOT NULL AND p.source_z13_message_id<>p.outbound_z13_message_id THEN RETURN jsonb_build_object('applied',false,'reason','permission_original_identity_conflict'); END IF;
  IF (p.status IN ('z13_sent','waiting_for_customer_approval','z13_ready')) IS NOT TRUE THEN RETURN jsonb_build_object('applied',false,'reason','permission_business_outcome_already_established'); END IF;
  FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects') o LOOP
   IF a->>'li' IS DISTINCT FROM p.rff_li_reference THEN RETURN jsonb_build_object('applied',false,'reason','permission_object_reference_mismatch'); END IF;
   reason:=a->>'reason';
   IF reason='Z96' AND a->>'status' IN ('A13','A76') THEN
    count_negative:=count_negative+1;
    IF negative_status IS NOT NULL AND negative_status<>a->>'status' THEN RETURN jsonb_build_object('applied',false,'reason','mixed_permission_denial_reasons'); END IF;
    negative_status:=a->>'status';
   ELSIF reason=mode AND a->>'status'='A74' THEN
    count_positive:=count_positive+1;start_day:=gridex_received_sources.permission_date_v1(a->>'reportStart');end_day:=gridex_received_sources.permission_date_v1(a->>'reportEnd');
    IF nullif(a->>'point','') IS NULL OR nullif(a->>'permissionId','') IS NULL OR nullif(a->>'customerIdentity','') IS NULL OR a->>'customerIdentity' IS DISTINCT FROM b->>'customerIdentity'
    OR (b->>'point' IS NOT NULL AND a->>'point' IS DISTINCT FROM b->>'point')
    OR start_day IS NULL OR gridex_received_sources.permission_time_v1(a->>'reportStart') IS NULL OR (a->>'reportEnd' IS NOT NULL AND gridex_received_sources.permission_time_v1(a->>'reportEnd') IS NULL) OR (a->>'reportEnd' IS NOT NULL AND end_day IS NULL) OR (end_day IS NOT NULL AND end_day<start_day) THEN RETURN jsonb_build_object('applied',false,'reason','permission_approved_object_evidence_invalid'); END IF;
   ELSE RETURN jsonb_build_object('applied',false,'reason','permission_business_reason_unqualified'); END IF;
  END LOOP;
  next_status:=CASE WHEN count_positive=0 THEN CASE negative_status WHEN 'A76' THEN 'rejected_passive_timeout' ELSE 'rejected_active' END WHEN count_negative>0 THEN 'partially_approved' ELSE 'active' END;
  -- Parent/site/history writes are one database transaction. Never copy one
  -- linked local site or point to every physical approved object.
  DELETE FROM public.metering_permission_sites WHERE company_id=m.company_id AND metering_permission_id=p.id;
  FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects') o WHERE o->>'status'='A74' LOOP
   INSERT INTO public.metering_permission_sites(company_id,metering_permission_id,customer_id,facility_id,grid_area_code,status,start_date,end_date,start_at,end_at,metadata)
   VALUES(m.company_id,p.id,p.customer_id,a->>'point',a->>'gridArea','approved',gridex_received_sources.permission_date_v1(a->>'reportStart'),gridex_received_sources.permission_date_v1(a->>'reportEnd'),gridex_received_sources.permission_time_v1(a->>'reportStart'),gridex_received_sources.permission_time_v1(a->>'reportEnd'),jsonb_build_object('source','inbound_prodat_z14','edielMessageId',m.id,'permissionId',a->>'permissionId','mode',mode,'product',a->>'product'));
  END LOOP;
  SELECT o INTO a FROM jsonb_array_elements(wire->'objects') o WHERE o->>'status'='A74' LIMIT 1;
  UPDATE public.metering_permissions SET status=next_status,source_z14_message_id=m.id,inbound_z14_message_id=m.id,
   permission_id=CASE WHEN count_positive=1 THEN a->>'permissionId' ELSE permission_id END,
   permission_reference=CASE WHEN count_positive=1 THEN a->>'permissionId' ELSE permission_reference END,
   approved_start_date=CASE WHEN count_positive=1 THEN gridex_received_sources.permission_date_v1(a->>'reportStart') ELSE NULL END,
   approved_end_date=CASE WHEN count_positive=1 THEN gridex_received_sources.permission_date_v1(a->>'reportEnd') ELSE NULL END,
   approved_start_at=CASE WHEN count_positive=1 THEN gridex_received_sources.permission_time_v1(a->>'reportStart') ELSE NULL END,
   approved_end_at=CASE WHEN count_positive=1 THEN gridex_received_sources.permission_time_v1(a->>'reportEnd') ELSE NULL END,
   product_code=CASE WHEN count_positive=1 THEN a->>'product' ELSE NULL END,
   report_frequency=CASE WHEN count_positive=1 THEN a->>'frequency' ELSE NULL END,
   last_blocker=CASE WHEN count_positive=0 THEN 'source_z14_denied_'||negative_status ELSE NULL END,
   metadata=coalesce(metadata,'{}')||jsonb_build_object('marketPermission',jsonb_build_object('mode',mode,'sourceZ14',m.id,'legalActor',wire->>'receiver','dsoActor',wire->>'sender','objects',wire->'objects')),
   market_state_version=market_state_version+1,updated_at=now(),updated_by=p_actor_user_id WHERE id=p.id AND company_id=m.company_id;
 ELSE
  -- Validate every physical object before mutating any of them.
  FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects') o LOOP
   end_time:=gridex_received_sources.permission_time_v1(a->>'permissionEnd');
   IF end_time IS NULL OR a->>'li' IS DISTINCT FROM p.rff_li_reference OR NOT EXISTS(SELECT FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id AND ps.facility_id=a->>'point' AND ps.metadata->>'permissionId'=a->>'permissionId') THEN RETURN jsonb_build_object('applied',false,'reason','z15_permission_object_mismatch'); END IF;
   reason:=a->>'reason';
   IF reason='Z24' THEN
    IF a->>'status' IS DISTINCT FROM 'A74' THEN RETURN jsonb_build_object('applied',false,'reason','z15c_status_unqualified'); END IF;
   ELSIF reason=mode AND a->>'status' IN ('A74','A75') AND a->>'endReason' IN ('B77','B78','B79','B80','E37') THEN NULL;
   ELSE RETURN jsonb_build_object('applied',false,'reason','z15_mode_or_reason_unqualified'); END IF;
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') o WHERE o->>'reason' IS DISTINCT FROM reason) THEN RETURN jsonb_build_object('applied',false,'reason','mixed_z15_modes'); END IF;
  IF reason='Z24' THEN
   SELECT * INTO ended_source FROM public.ediel_messages WHERE id=p.inbound_z15_message_id AND company_id=m.company_id AND environment=m.environment;
   ended_wire:=gridex_received_sources.permission_wire_v1(ended_source.raw_payload);
   IF ended_wire IS NULL OR ended_wire->>'sender' IS DISTINCT FROM wire->>'sender' OR ended_wire->>'receiver' IS DISTINCT FROM wire->>'receiver'
    OR jsonb_array_length(ended_wire->'objects')<>jsonb_array_length(wire->'objects')
    OR EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') own WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(ended_wire->'objects') old WHERE old->>'reason'=mode AND old->>'permissionId'=own->>'permissionId' AND old->>'point'=own->>'point' AND old->>'permissionEnd'=own->>'permissionEnd' AND old->>'li'=own->>'li'))
    THEN RETURN jsonb_build_object('applied',false,'reason','z15c_original_ending_not_bound'); END IF;
   SELECT * INTO prior FROM gridex_received_sources.permission_transitions WHERE source_message_id=ended_source.id AND permission_id=p.id;
   IF NOT FOUND OR p.market_state_version<>(prior.resulting_state->>'market_state_version')::bigint THEN RETURN jsonb_build_object('applied',false,'reason','z15c_original_snapshot_unavailable'); END IF;
   next_status:=prior.previous_state->>'status';
   UPDATE public.metering_permissions SET status=next_status,approved_end_date=(prior.previous_state->>'approved_end_date')::date,approved_end_at=(prior.previous_state->>'approved_end_at')::timestamptz WHERE id=p.id AND company_id=m.company_id;
   -- Restore exactly the previous object period; no customer-contract or
   -- beneficiary/service grant is revived by a market cancellation.
   UPDATE public.metering_permission_sites ps SET status=old->>'status',end_date=(old->>'end_date')::date,end_at=(old->>'end_at')::timestamptz,permission_end_at=(old->>'permission_end_at')::timestamptz,updated_at=now()
   FROM jsonb_array_elements(prior.previous_sites) old
   WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id AND ps.id=(old->>'id')::uuid
    AND EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') own WHERE own->>'point'=ps.facility_id);
  ELSE
   FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects') o LOOP
    end_day:=gridex_received_sources.permission_date_v1(a->>'permissionEnd');end_time:=gridex_received_sources.permission_time_v1(a->>'permissionEnd');
    UPDATE public.metering_permission_sites SET end_date=CASE WHEN end_at IS NULL OR end_time<end_at THEN end_day ELSE end_date END,end_at=least(end_at,end_time),permission_end_at=end_time,status=CASE WHEN end_time>now() THEN status ELSE 'ended' END,updated_at=now()
    WHERE company_id=m.company_id AND metering_permission_id=p.id AND facility_id=a->>'point';
   END LOOP;
   next_status:=CASE WHEN NOT EXISTS(SELECT FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id AND (ps.permission_end_at IS NULL OR ps.permission_end_at>now())) THEN 'ended' ELSE p.status END;
   UPDATE public.metering_permissions SET status=next_status,
    approved_end_date=CASE WHEN jsonb_array_length(before_sites)=1 AND (approved_end_at IS NULL OR end_time<approved_end_at) THEN end_day ELSE approved_end_date END,
    approved_end_at=CASE WHEN jsonb_array_length(before_sites)=1 THEN least(approved_end_at,end_time) ELSE approved_end_at END WHERE id=p.id AND company_id=m.company_id;
  END IF;
  UPDATE public.metering_permissions SET inbound_z15_message_id=m.id,market_state_version=market_state_version+1,updated_at=now(),updated_by=p_actor_user_id,
   metadata=coalesce(metadata,'{}')||jsonb_build_object('z15',jsonb_build_object('edielMessageId',m.id,'reason',reason,'objects',wire->'objects')) WHERE id=p.id AND company_id=m.company_id;
 END IF;
 IF wire->>'code'='Z14' THEN
  qualified_original:=origin.id;qualified_code:='Z14';
  UPDATE public.ediel_business_expectations SET status=CASE WHEN count_positive=0 THEN 'rejected' ELSE 'fulfilled' END,
   fulfilled_by_message_id=m.id,updated_at=now()
   WHERE company_id=m.company_id AND environment=m.environment AND source_message_id=origin.id
    AND expected_family='PRODAT' AND expected_code='Z14' AND status IN ('pending','timeout','manual_review');
 ELSIF reason=mode AND p.outbound_z18_message_id IS NOT NULL THEN
  SELECT * INTO termination FROM public.ediel_messages WHERE id=p.outbound_z18_message_id AND company_id=m.company_id AND environment=m.environment FOR SHARE;
  termination_wire:=gridex_received_sources.permission_wire_v1(termination.raw_payload);
  IF termination.direction='outbound' AND termination.status='sent' AND termination.message_sent_at IS NOT NULL AND termination.immutable_rendered_at IS NOT NULL
   AND termination.immutable_payload_hash=encode(sha256(convert_to(termination.raw_payload,'UTF8')),'hex')
   AND termination_wire->>'code'='Z18' AND termination_wire->>'sender'=wire->>'receiver' AND termination_wire->>'receiver'=wire->>'sender'
   AND jsonb_array_length(termination_wire->'objects')=jsonb_array_length(wire->'objects')
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(wire->'objects') own WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(termination_wire->'objects') requested WHERE requested->>'reason'=mode AND requested->>'li'=own->>'li' AND requested->>'point'=own->>'point' AND requested->>'permissionId'=own->>'permissionId' AND requested->>'permissionEnd'=own->>'permissionEnd'))
   THEN qualified_original:=termination.id;qualified_code:='Z15';
    UPDATE public.ediel_business_expectations SET status='fulfilled',fulfilled_by_message_id=m.id,updated_at=now()
    WHERE company_id=m.company_id AND environment=m.environment AND source_message_id=termination.id AND expected_family='PRODAT' AND expected_code='Z15' AND status IN ('pending','timeout','manual_review'); END IF;
 END IF;
 SELECT to_jsonb(mp) INTO after_state FROM public.metering_permissions mp WHERE id=p.id;
 INSERT INTO gridex_received_sources.permission_transitions(source_message_id,company_id,permission_id,payload_hash,previous_state,previous_sites,resulting_state,actor_user_id,resulting_sites,qualified_original_message_id,qualified_expected_message_code)
 VALUES(m.id,m.company_id,p.id,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),before_state,before_sites,after_state,p_actor_user_id,(SELECT coalesce(jsonb_agg(to_jsonb(ps) ORDER BY ps.id),'[]'::jsonb) FROM public.metering_permission_sites ps WHERE ps.company_id=m.company_id AND ps.metering_permission_id=p.id),qualified_original,qualified_code);
 RETURN jsonb_build_object('applied',true,'permissionId',p.id,'status',next_status,'stateVersion',after_state->'market_state_version');
END $$;
REVOKE ALL ON FUNCTION public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.ediel_advance_permission_deadlines_v1(p_actor_user_id uuid,p_company_id uuid DEFAULT NULL,p_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE p public.metering_permissions%rowtype; a jsonb; wire jsonb; raw text; changed integer:=0; rows_changed integer;
BEGIN
 FOR p IN SELECT mp.* FROM public.metering_permissions mp WHERE mp.status IN ('active','approved','partially_approved','z14_received')
  AND (p_company_id IS NULL OR mp.company_id=p_company_id)
  AND mp.inbound_z15_message_id IS NOT NULL
  AND coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,mp.company_id,'metering.write'),false)
  AND EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=mp.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL)
  AND EXISTS(SELECT FROM public.metering_permission_sites ps WHERE ps.company_id=mp.company_id AND ps.metering_permission_id=mp.id AND ps.status IN ('approved','active') AND ps.permission_end_at<=now())
  ORDER BY mp.updated_at,mp.id LIMIT least(greatest(coalesce(p_limit,100),1),200) FOR UPDATE SKIP LOCKED LOOP
  IF NOT coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p.company_id,'metering.write'),false)
   OR NOT EXISTS(SELECT FROM public.company_memberships cm WHERE cm.company_id=p.company_id AND cm.user_id=p_actor_user_id AND cm.status='active' AND cm.is_active AND cm.accepted_at IS NOT NULL) THEN CONTINUE; END IF;
  SELECT m.raw_payload INTO raw FROM public.ediel_messages m JOIN gridex_received_sources.permission_transitions tr ON tr.source_message_id=m.id AND tr.company_id=m.company_id AND tr.permission_id=p.id
   WHERE m.id=p.inbound_z15_message_id AND m.company_id=p.company_id AND tr.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex');
  wire:=gridex_received_sources.permission_wire_v1(raw);
  IF wire IS NULL OR wire->>'code' IS DISTINCT FROM 'Z15' THEN CONTINUE; END IF;
  FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects') o WHERE o->>'reason' IN ('S17','S18') AND o->>'status' IN ('A74','A75') LOOP
   UPDATE public.metering_permission_sites ps SET status='ended',updated_at=now()
    WHERE ps.company_id=p.company_id AND ps.metering_permission_id=p.id AND ps.facility_id=a->>'point' AND ps.metadata->>'permissionId'=a->>'permissionId'
     AND ps.status IN ('approved','active') AND ps.permission_end_at=gridex_received_sources.permission_time_v1(a->>'permissionEnd') AND ps.permission_end_at<=now();
   GET DIAGNOSTICS rows_changed=ROW_COUNT;changed:=changed+rows_changed;
  END LOOP;
  IF NOT EXISTS(SELECT FROM public.metering_permission_sites ps WHERE ps.company_id=p.company_id AND ps.metering_permission_id=p.id AND ps.status IN ('approved','active')) THEN
   UPDATE public.metering_permissions SET status='ended',updated_at=now(),updated_by=p_actor_user_id WHERE id=p.id AND company_id=p.company_id AND market_state_version=p.market_state_version;
  END IF;
 END LOOP;
 RETURN jsonb_build_object('updated',changed);
END $$;
REVOKE ALL ON FUNCTION public.ediel_advance_permission_deadlines_v1(uuid,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_advance_permission_deadlines_v1(uuid,uuid,integer) TO service_role;

CREATE FUNCTION public.ediel_permission_source_is_current_v1(p_company_id uuid,p_permission_id uuid,p_source_z14_message_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE p public.metering_permissions%rowtype; m public.ediel_messages%rowtype;
 basis gridex_received_sources.permission_transitions%rowtype; current_transition gridex_received_sources.permission_transitions%rowtype;
 wire jsonb; a jsonb; s public.metering_permission_sites%rowtype; fields text[]:=ARRAY['company_id','customer_id','status','source_z13_message_id','outbound_z13_message_id','source_z14_message_id','inbound_z14_message_id','inbound_z15_message_id','rff_li_reference','permission_id','permission_reference','approved_start_date','approved_end_date','approved_start_at','approved_end_at','product_code','market_state_version']; k text; ending jsonb; saved_site jsonb; site_fields text[]:=ARRAY['id','company_id','metering_permission_id','customer_id','customer_site_id','metering_point_id','facility_id','grid_area_code','start_date','end_date','start_at','end_at','permission_end_at','metadata'];
BEGIN
 SELECT * INTO p FROM public.metering_permissions WHERE id=p_permission_id AND company_id=p_company_id;
 IF NOT FOUND OR coalesce(p.inbound_z14_message_id,p.source_z14_message_id) IS DISTINCT FROM p_source_z14_message_id THEN RETURN false; END IF;
 SELECT * INTO basis FROM gridex_received_sources.permission_transitions WHERE source_message_id=p_source_z14_message_id AND permission_id=p.id AND company_id=p.company_id;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=basis.source_message_id AND company_id=p.company_id;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_family IS DISTINCT FROM 'PRODAT' OR basis.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments v WHERE v.source_message_id=m.id AND v.company_id=m.company_id AND v.environment=m.environment AND v.source_payload_hash=basis.payload_hash
  AND v.facts_text::jsonb->>'syntaxDecision'='accepted' AND v.facts_text::jsonb->>'applicationDecision'='accepted' AND v.facts_text::jsonb->>'functionalDecision'='accepted'
  AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=v.id)) THEN RETURN false; END IF;
 SELECT * INTO current_transition FROM gridex_received_sources.permission_transitions WHERE company_id=p.company_id AND permission_id=p.id ORDER BY (resulting_state->>'market_state_version')::bigint DESC LIMIT 1;
 IF NOT FOUND OR current_transition.resulting_sites IS NULL OR (current_transition.resulting_state->>'market_state_version')::bigint IS DISTINCT FROM p.market_state_version THEN RETURN false; END IF;
 FOREACH k IN ARRAY fields LOOP
  IF to_jsonb(p)->k IS DISTINCT FROM current_transition.resulting_state->k THEN RETURN false; END IF;
 END LOOP;
 IF p.metadata->'marketPermission' IS DISTINCT FROM current_transition.resulting_state#>'{metadata,marketPermission}' OR p.metadata->'z15' IS DISTINCT FROM current_transition.resulting_state#>'{metadata,z15}' THEN RETURN false; END IF;
 wire:=gridex_received_sources.permission_wire_v1(m.raw_payload);
 IF wire IS NULL OR wire->>'code' IS DISTINCT FROM 'Z14' THEN RETURN false; END IF;
 IF (SELECT count(*) FROM public.metering_permission_sites ps WHERE ps.company_id=p.company_id AND ps.metering_permission_id=p.id)<>(SELECT count(*) FROM jsonb_array_elements(wire->'objects') o WHERE o->>'status'='A74') THEN RETURN false; END IF;
 IF p.inbound_z15_message_id IS NOT NULL THEN
  SELECT gridex_received_sources.permission_wire_v1(msg.raw_payload) INTO ending FROM public.ediel_messages msg JOIN gridex_received_sources.permission_transitions tr ON tr.source_message_id=msg.id AND tr.permission_id=p.id AND tr.company_id=p.company_id
   WHERE msg.id=p.inbound_z15_message_id AND msg.company_id=p.company_id AND tr.payload_hash=encode(sha256(convert_to(msg.raw_payload,'UTF8')),'hex');
  IF ending IS NULL OR ending->>'code' IS DISTINCT FROM 'Z15' THEN RETURN false; END IF;
 END IF;
 FOR s IN SELECT ps.* FROM public.metering_permission_sites ps WHERE ps.company_id=p.company_id AND ps.metering_permission_id=p.id LOOP
  SELECT o INTO a FROM jsonb_array_elements(wire->'objects') o WHERE o->>'point'=s.facility_id AND o->>'permissionId'=s.metadata->>'permissionId' AND o->>'status'='A74';
  IF a IS NULL OR s.customer_id IS DISTINCT FROM p.customer_id OR s.metadata->>'source' IS DISTINCT FROM 'inbound_prodat_z14'
   OR s.metadata->>'edielMessageId' IS DISTINCT FROM m.id::text OR s.metadata->>'permissionId' IS DISTINCT FROM a->>'permissionId'
   OR s.metadata->>'mode' IS DISTINCT FROM a->>'reason' OR s.metadata->>'product' IS DISTINCT FROM a->>'product'
   OR s.start_at IS DISTINCT FROM gridex_received_sources.permission_time_v1(a->>'reportStart')
   OR s.start_date IS DISTINCT FROM gridex_received_sources.permission_date_v1(a->>'reportStart')
   OR s.grid_area_code IS DISTINCT FROM a->>'gridArea' THEN RETURN false; END IF;
  SELECT o INTO saved_site FROM jsonb_array_elements(current_transition.resulting_sites) o WHERE o->>'id'=s.id::text;
  IF saved_site IS NULL THEN RETURN false; END IF;
  FOREACH k IN ARRAY site_fields LOOP IF to_jsonb(s)->k IS DISTINCT FROM saved_site->k THEN RETURN false; END IF; END LOOP;
  -- The exact latest atomic snapshot includes a C's actual restored prior
  -- period, including earlier independent narrowings. Source Z14 bounds remain.
  IF gridex_received_sources.permission_time_v1(a->>'reportEnd') IS NOT NULL
   AND (s.end_at IS NULL OR s.end_at>gridex_received_sources.permission_time_v1(a->>'reportEnd')) THEN RETURN false; END IF;
  IF s.status IS DISTINCT FROM saved_site->>'status' AND (s.status='ended' AND saved_site->>'status' IN ('approved','active') AND s.permission_end_at<=now()) IS NOT TRUE THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.ediel_permission_source_is_current_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_permission_source_is_current_v1(uuid,uuid,uuid) TO service_role;
CREATE TRIGGER permission_transition_no_truncate BEFORE TRUNCATE ON gridex_received_sources.permission_transitions FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
COMMIT;
