-- P-09 / AT-Z06E: an incoming customer facet has its own immutable valid-time
-- owner. It cannot be approved by structural review or mutable parsed fields.
-- No existing customer/masterpoint/supply rows are overwritten or backfilled.
BEGIN;
ALTER TABLE gridex_requested_changes.confirmed_customer_versions
 ADD COLUMN canonical_assessment_id uuid REFERENCES gridex_received_sources.validation_assessments(id),
 ADD COLUMN supply_period_id uuid REFERENCES public.customer_supply_periods(id),
 ADD COLUMN site_id uuid REFERENCES public.customer_sites(id),
 ADD COLUMN object_id text, ADD COLUMN identity_agency text,
 ADD COLUMN legal_sender text, ADD COLUMN legal_receiver text,
 ADD COLUMN created_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
 ADD COLUMN result jsonb;
CREATE TABLE gridex_requested_changes.customer_version_availability (
 source_message_id uuid PRIMARY KEY REFERENCES gridex_requested_changes.confirmed_customer_versions(source_message_id) ON DELETE RESTRICT,
 company_id uuid NOT NULL,environment text NOT NULL,payload_hash text NOT NULL,
 visibility_snapshot text NOT NULL,observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE gridex_requested_changes.customer_version_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_requested_changes.customer_version_availability FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_requested_changes.customer_version_availability FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER customer_version_availability_immutable BEFORE UPDATE OR DELETE ON gridex_requested_changes.customer_version_availability FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();
CREATE TRIGGER customer_version_availability_no_truncate BEFORE TRUNCATE ON gridex_requested_changes.customer_version_availability FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.permission_transition_immutable_v1();

CREATE FUNCTION public.ediel_apply_reviewed_customer_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;src gridex_received_sources.sources%rowtype;
 canonical gridex_received_sources.validation_assessments%rowtype;prior gridex_requested_changes.confirmed_customer_versions%rowtype;
 candidate gridex_requested_changes.events%rowtype;e gridex_requested_changes.events%rowtype;point public.metering_points%rowtype;
 tokens jsonb;own_tokens jsonb;ud jsonb;dtm jsonb;lin jsonb;physical_at timestamptz;party jsonb;b jsonb;result jsonb;
 n integer;qualified_count integer:=0;first_lin integer;end_lin integer;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_source_service_required' USING ERRCODE='42501';END IF;
 IF gridex_requested_changes.actor_v1(p_company_id,p_actor_user_id,'archive','death') IS NOT TRUE THEN RAISE EXCEPTION 'customer_source_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO m FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id FOR UPDATE;
 IF NOT FOUND OR m.direction IS DISTINCT FROM 'inbound' OR m.message_standard IS DISTINCT FROM 'edifact' OR m.message_family IS DISTINCT FROM 'PRODAT' OR m.message_code IS DISTINCT FROM 'Z06' THEN RAISE EXCEPTION 'customer_source_original_required';END IF;
 PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,m.id);
 PERFORM gridex_ediel_source_rules.require_v1(p_company_id,m.id);
 SELECT * INTO src FROM gridex_received_sources.sources WHERE source_message_id=m.id AND company_id=p_company_id AND environment=m.environment FOR UPDATE;
 IF src.source_message_id IS NULL OR src.raw_payload IS DISTINCT FROM m.raw_payload OR src.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR src.source_received_at IS NULL OR src.source_received_at IS DISTINCT FROM m.message_received_at THEN RAISE EXCEPTION 'customer_source_immutable_original_required';END IF;
 SELECT count(*) INTO n FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=p_company_id AND a.environment=m.environment AND a.source_payload_hash=src.payload_hash AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id);
 IF n<>1 THEN RETURN jsonb_build_object('applied',false,'reason','customer_source_canonical_ambiguous');END IF;
 SELECT * INTO canonical FROM gridex_received_sources.validation_assessments a WHERE a.source_message_id=m.id AND a.company_id=p_company_id AND a.environment=m.environment AND a.source_payload_hash=src.payload_hash AND NOT EXISTS(SELECT FROM gridex_received_sources.validation_assessments child WHERE child.previous_assessment_id=a.id) FOR SHARE;
 IF canonical.facts_text::jsonb->>'syntaxDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb->>'applicationDecision' IS DISTINCT FROM 'accepted' OR canonical.facts_text::jsonb->>'functionalDecision' IS DISTINCT FROM 'accepted' THEN RETURN jsonb_build_object('applied',false,'reason','customer_source_canonical_not_accepted');END IF;
 tokens:=gridex_received_sources.closure_wire_tokens_v2(src.raw_payload);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='Z06' AND coalesce(t#>>'{elements,3,0}','9')='9')<>1 OR (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN')<>1 THEN RAISE EXCEPTION 'customer_source_whole_original_required';END IF;
 SELECT t INTO lin FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='LIN';first_lin:=(lin->>'index')::integer;
 SELECT min((t->>'index')::integer) INTO end_lin FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer>first_lin AND t->>'tag' IN('UNT','UNZ','UNH','LIN');
 SELECT jsonb_agg(t ORDER BY (t->>'index')::integer) INTO own_tokens FROM jsonb_array_elements(tokens) t WHERE (t->>'index')::integer>first_lin AND (end_lin IS NULL OR (t->>'index')::integer<end_lin);
 -- Exact CCI parent and first own CAV; an unrelated code anywhere in a raw
 -- message cannot create death authority. Other E34 processes retain a hold.
 IF (SELECT count(*) FROM jsonb_array_elements(own_tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}'='E34' AND (SELECT p#>>'{elements,2,0}' FROM jsonb_array_elements(own_tokens) p WHERE p->>'tag'='CCI' AND (p->>'index')::integer<(t->>'index')::integer ORDER BY (p->>'index')::integer DESC LIMIT 1)='Z13')<>1 THEN RAISE EXCEPTION 'customer_source_z06e_required';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(own_tokens) t WHERE t->>'tag'='CAV' AND t#>>'{elements,1,0}'='Z41' AND (SELECT p#>>'{elements,2,0}' FROM jsonb_array_elements(own_tokens) p WHERE p->>'tag'='CCI' AND (p->>'index')::integer<(t->>'index')::integer ORDER BY (p->>'index')::integer DESC LIMIT 1)='Z17')<>1 THEN RETURN jsonb_build_object('applied',false,'reason','customer_source_separate_bilateral_non_death_ground_required');END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(own_tokens) t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='UD')<>1 OR (SELECT count(*) FROM jsonb_array_elements(own_tokens) t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='157' AND t#>>'{elements,1,2}'='203')<>1 OR (SELECT count(*) FROM jsonb_array_elements(own_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='LI' AND nullif(t#>>'{elements,1,1}','') IS NOT NULL)<>1 THEN RAISE EXCEPTION 'customer_source_own_customer_clock_reference_required';END IF;
 SELECT t INTO ud FROM jsonb_array_elements(own_tokens) t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='UD';
 SELECT t INTO dtm FROM jsonb_array_elements(own_tokens) t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='157';
 physical_at:=gridex_received_sources.permission_time_v1(dtm#>>'{elements,1,1}');
 IF physical_at IS NULL OR nullif(gridex_ai_processing.party_text_v1(ud,4,2),'') IS NULL THEN RAISE EXCEPTION 'customer_source_party_or_clock_invalid';END IF;
 FOR candidate IN SELECT * FROM gridex_requested_changes.events x WHERE x.company_id=p_company_id AND x.environment=m.environment AND x.variant='E' AND x.event_kind='death' AND x.point_id=lin#>>'{elements,3,0}' AND x.identity_agency=lin#>>'{elements,3,3}' AND x.effective_at=physical_at AND x.customer_identity->>'id'=ud#>>'{elements,2,0}' ORDER BY x.id FOR SHARE LOOP
  b:=gridex_requested_changes.context_v1(p_company_id,candidate.id,p_actor_user_id,'communication.write');
  IF b->>'status'='authorized' AND ud#>'{elements,2}'=jsonb_build_array(candidate.customer_identity->>'id',candidate.customer_identity->>'qualifier',candidate.customer_identity->>'agency')
   AND m.sender_ediel_id=candidate.legal_receiver_id AND m.receiver_ediel_id=candidate.legal_sender_id
   AND (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='NAD' AND (t->>'index')::integer<first_lin AND t#>>'{elements,1,0}'='FR' AND t#>'{elements,2}'=jsonb_build_array(candidate.legal_receiver_id,'160','SVK'))=1
   AND (SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='NAD' AND (t->>'index')::integer<first_lin AND t#>>'{elements,1,0}'='DO' AND t#>'{elements,2}'=jsonb_build_array(candidate.legal_sender_id,'160','SVK'))=1 THEN qualified_count:=qualified_count+1;e:=candidate;END IF;
 END LOOP;
 IF qualified_count<>1 THEN RETURN jsonb_build_object('applied',false,'reason',CASE WHEN qualified_count>1 THEN 'customer_source_life_event_ambiguous' ELSE 'customer_source_qualified_life_event_missing' END);END IF;
 SELECT * INTO point FROM public.metering_points WHERE id=e.metering_point_id AND company_id=p_company_id AND customer_id=e.customer_id FOR SHARE;
 IF point.id IS NULL OR coalesce(point.customer_site_id,point.site_id) IS NULL THEN RAISE EXCEPTION 'customer_source_owned_site_required';END IF;
 PERFORM s.id FROM public.customer_sites s WHERE s.id=coalesce(point.customer_site_id,point.site_id) AND s.company_id=p_company_id AND s.customer_id=e.customer_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'customer_source_owned_site_required';END IF;
 party:=jsonb_build_object('id',ud#>>'{elements,2,0}','qualifier',ud#>>'{elements,2,1}','agency',ud#>>'{elements,2,2}','name',gridex_ai_processing.party_text_v1(ud,4,2),'nameLines',ud#>'{elements,4}','addressLines',ud#>'{elements,5}','city',ud#>>'{elements,6,0}','postalCode',ud#>>'{elements,8,0}','country',ud#>>'{elements,9,0}','deathStatus','Z41');
 SELECT * INTO prior FROM gridex_requested_changes.confirmed_customer_versions WHERE source_message_id=m.id FOR SHARE;
 IF FOUND THEN IF prior.payload_hash IS DISTINCT FROM src.payload_hash OR prior.event_id IS DISTINCT FROM e.id OR prior.canonical_assessment_id IS DISTINCT FROM canonical.id OR prior.party IS DISTINCT FROM party THEN RAISE EXCEPTION 'customer_source_replay_conflict';END IF;RETURN prior.result;END IF;
 result:=jsonb_build_object('applied',true,'sourceMessageId',m.id,'appliedCount',1,'owner','confirmed-customer-source-v1','payloadHash',src.payload_hash,'eventId',e.id,'objects',jsonb_build_array(jsonb_build_object('meteringPointId',point.id,'siteId',coalesce(point.customer_site_id,point.site_id),'effectiveAt',physical_at,'sourceReceivedAt',src.source_received_at)));
 INSERT INTO gridex_requested_changes.confirmed_customer_versions(source_message_id,event_id,company_id,environment,payload_hash,customer_id,metering_point_id,effective_at,received_at,party,actor_user_id,canonical_assessment_id,supply_period_id,site_id,object_id,identity_agency,legal_sender,legal_receiver,result)
 VALUES(m.id,e.id,p_company_id,m.environment,src.payload_hash,e.customer_id,e.metering_point_id,physical_at,src.source_received_at,party,p_actor_user_id,canonical.id,e.supply_period_id,coalesce(point.customer_site_id,point.site_id),e.point_id,e.identity_agency,e.legal_receiver_id,e.legal_sender_id,result);
 INSERT INTO public.ediel_message_events(company_id,ediel_message_id,message_id,event_type,event_status,message,payload,event_payload,created_by)
 VALUES(p_company_id,m.id,m.id,'manual_note','success','Källbunden kundversion granskad.',jsonb_build_object('safeApply',true,'safeApplyDecision','applied','appliedCount',1,'customerVersionSourceId',m.id,'appliedAutomatically',false),jsonb_build_object('safeApply',true,'safeApplyDecision','applied','appliedCount',1,'customerVersionSourceId',m.id,'appliedAutomatically',false),p_actor_user_id);
 RETURN result;
END$$;
CREATE FUNCTION public.ediel_witness_confirmed_customer_source_v1(p_company_id uuid,p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v gridex_requested_changes.confirmed_customer_versions%rowtype;w gridex_requested_changes.customer_version_availability%rowtype;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'customer_source_service_required' USING ERRCODE='42501';END IF;
 IF gridex_requested_changes.actor_v1(p_company_id,p_actor_user_id,'archive','death') IS NOT TRUE THEN RAISE EXCEPTION 'customer_source_actor_forbidden' USING ERRCODE='42501';END IF;
 SELECT * INTO v FROM gridex_requested_changes.confirmed_customer_versions WHERE source_message_id=p_source_message_id AND company_id=p_company_id AND canonical_assessment_id IS NOT NULL AND created_xid<>pg_current_xact_id() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'customer_source_committed_version_required';END IF;
 INSERT INTO gridex_requested_changes.customer_version_availability(source_message_id,company_id,environment,payload_hash,visibility_snapshot) VALUES(v.source_message_id,v.company_id,v.environment,v.payload_hash,pg_current_snapshot()::text) ON CONFLICT DO NOTHING;
 SELECT * INTO w FROM gridex_requested_changes.customer_version_availability WHERE source_message_id=v.source_message_id;
 RETURN jsonb_build_object('owner','confirmed-customer-source-availability-v1','sourceMessageId',v.source_message_id,'payloadHash',w.payload_hash,'availableAt',w.observed_at);
END$$;
REVOKE ALL ON FUNCTION public.ediel_apply_reviewed_customer_source_v1(uuid,uuid,uuid),public.ediel_witness_confirmed_customer_source_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_apply_reviewed_customer_source_v1(uuid,uuid,uuid),public.ediel_witness_confirmed_customer_source_v1(uuid,uuid,uuid) TO service_role;
COMMIT;
