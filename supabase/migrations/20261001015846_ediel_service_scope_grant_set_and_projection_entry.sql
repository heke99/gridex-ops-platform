-- Created using Supabase CLI2.118.0. One accepted upstream transaction/ACK
-- may serve several independently qualified internal service missions.
-- Historical migrations and immutable receipt versions are retained.
BEGIN;
CREATE FUNCTION gridex_ediel_ack_replay.current_service_grant_set_v2(c uuid,env text,ctx jsonb,sender text,point text,product text,v_period_start timestamptz,v_period_end timestamptz,contract jsonb,only_grant_ids uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE candidate uuid;candidates uuid[]:=ARRAY[]::uuid[];proofs jsonb:='[]';evidence jsonb;assessment jsonb;dso_ids text[];
 a public.ediel_service_assignments%rowtype;g public.ediel_data_access_grants%rowtype;l public.ediel_assignment_permission_links%rowtype;p public.metering_permissions%rowtype;site public.metering_permission_sites%rowtype;
BEGIN
 IF c IS NULL OR (env IN('test','production')) IS NOT TRUE OR ctx->>'companyId' IS DISTINCT FROM c::text OR ctx->>'environment' IS DISTINCT FROM env
 OR (ctx->>'actorRole' IN('energy_service_company','esco')) IS NOT TRUE OR ctx->>'family' IS DISTINCT FROM 'UTILTS' OR ctx->>'code' IS DISTINCT FROM 'E66'
 OR nullif(sender,'') IS NULL OR nullif(point,'') IS NULL OR nullif(product,'') IS NULL OR v_period_start IS NULL OR v_period_end IS NULL OR v_period_end<=v_period_start THEN RAISE EXCEPTION 'ediel_ack_service_scope_source_unqualified';END IF;
 IF only_grant_ids IS NOT NULL AND (cardinality(only_grant_ids)=0 OR array_position(only_grant_ids,NULL) IS NOT NULL OR cardinality(only_grant_ids)<>(SELECT count(DISTINCT x) FROM unnest(only_grant_ids)x)) THEN RAISE EXCEPTION 'ediel_ack_service_scope_captured_set_invalid';END IF;

  FOR candidate IN SELECT x.id FROM public.ediel_data_access_grants x JOIN public.ediel_service_assignments y ON y.company_id=x.company_id AND y.id=x.assignment_id
   WHERE x.company_id=c AND x.status='active' AND x.revoked_at IS NULL AND x.valid_from<=now() AND (x.valid_to IS NULL OR now()<x.valid_to)
   AND y.provider_actor_id::text=ctx->>'legalActorId' AND y.actor_profile_id::text=ctx#>>'{facts,profile,id}' AND y.environment=env
   AND (only_grant_ids IS NULL OR x.id=ANY(only_grant_ids)) AND point=ANY(x.object_ids) AND product=ANY(x.product_ids) AND v_period_start>=x.data_start AND (x.data_end IS NULL OR v_period_end<=x.data_end) ORDER BY x.id LOOP
   SELECT * INTO STRICT g FROM public.ediel_data_access_grants WHERE company_id=c AND id=candidate FOR SHARE;
   SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=c AND id=g.assignment_id FOR SHARE;
   IF g.beneficiary_company_id IS DISTINCT FROM a.beneficiary_company_id OR g.purpose IS DISTINCT FROM a.purpose OR NOT(g.object_ids <@ a.object_ids AND g.product_ids <@ a.product_ids AND g.fields <@ a.field_sets)
   OR g.data_start<a.data_start OR (a.data_end IS NOT NULL AND (g.data_end IS NULL OR g.data_end>a.data_end)) OR g.valid_from<a.valid_from OR (a.valid_to IS NOT NULL AND (g.valid_to IS NULL OR g.valid_to>a.valid_to))
   OR public.ediel_service_assignment_assessment_v1(c,a.id)->>'status' IS DISTINCT FROM 'authorized' THEN CONTINUE;END IF;
   IF contract#>>'{metering,capability}'='write' AND (contract#>>'{metering,customerId}' IS DISTINCT FROM a.customer_id::text
    OR NOT EXISTS(SELECT mp.id FROM public.metering_points mp WHERE mp.company_id=c AND mp.id::text=contract#>>'{metering,meteringPointId}' AND mp.customer_id=a.customer_id
      AND coalesce(nullif(mp.ediel_metering_point_id,''),nullif(mp.meter_point_id,''),mp.metering_point_id)=point
      AND (contract#>>'{metering,siteId}' IS NULL OR coalesce(mp.customer_site_id,mp.site_id)::text=contract#>>'{metering,siteId}') FOR SHARE)) THEN CONTINUE;END IF;
   IF contract#>>'{billing,capability}'='write' AND contract#>>'{billing,customerId}' IS DISTINCT FROM a.customer_id::text THEN CONTINUE;END IF;
   SELECT * INTO l FROM public.ediel_assignment_permission_links WHERE company_id=c AND id=g.permission_link_id AND assignment_id=a.id;IF NOT FOUND THEN CONTINUE;END IF;
   SELECT * INTO p FROM public.metering_permissions WHERE company_id=c AND id=l.permission_id;
   IF NOT FOUND OR (p.status IN('active','approved','partially_approved')) IS NOT TRUE OR p.customer_id IS DISTINCT FROM a.customer_id OR gridex_service_administration.permission_matches_assignment_v1(a,p) IS NOT TRUE THEN CONTINUE;END IF;
   SELECT array_agg(DISTINCT i.identifier_value ORDER BY i.identifier_value) INTO dso_ids FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date);
   IF cardinality(dso_ids) IS DISTINCT FROM 1 OR dso_ids[1] IS DISTINCT FROM sender THEN CONTINUE;END IF;
   IF public.ediel_permission_source_is_current_v1(c,p.id,coalesce(p.inbound_z14_message_id,p.source_z14_message_id)) IS NOT TRUE THEN CONTINUE;END IF;
   IF NOT EXISTS(SELECT FROM public.ediel_messages z WHERE z.company_id=c AND z.id=coalesce(p.inbound_z14_message_id,p.source_z14_message_id) AND z.environment=env AND z.direction='inbound' AND z.message_family='PRODAT' AND z.message_code='Z14') THEN CONTINUE;END IF;
   IF (SELECT count(*) FROM public.metering_permission_sites x WHERE x.company_id=c AND x.metering_permission_id=p.id AND x.customer_id=a.customer_id AND x.facility_id=point AND x.status IN('approved','active')
    AND x.metadata->>'source'='inbound_prodat_z14' AND x.metadata->>'edielMessageId'=coalesce(p.inbound_z14_message_id,p.source_z14_message_id)::text AND x.metadata->>'mode'=CASE a.mode WHEN 'V' THEN 'S17' ELSE 'S18' END AND x.metadata->>'product'=product AND x.start_at IS NOT NULL AND v_period_start>=x.start_at AND (x.end_at IS NULL OR v_period_end<=x.end_at))<>1 THEN CONTINUE;END IF;
   candidates:=array_append(candidates,candidate);
   SELECT * INTO STRICT site FROM public.metering_permission_sites x WHERE x.company_id=c AND x.metering_permission_id=p.id AND x.customer_id=a.customer_id AND x.facility_id=point AND x.status IN('approved','active') AND x.metadata->>'source'='inbound_prodat_z14' AND x.metadata->>'edielMessageId'=coalesce(p.inbound_z14_message_id,p.source_z14_message_id)::text AND x.metadata->>'mode'=CASE a.mode WHEN 'V' THEN 'S17' ELSE 'S18' END AND x.metadata->>'product'=product AND x.start_at IS NOT NULL AND v_period_start>=x.start_at AND (x.end_at IS NULL OR v_period_end<=x.end_at);
   SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) INTO evidence FROM public.ediel_service_evidence e WHERE e.company_id=c AND e.assignment_id=a.id AND e.status='verified' AND e.approved_assignment_version=a.scope_basis_version AND e.valid_from<=now() AND (e.valid_to IS NULL OR now()<e.valid_to) AND e.approved_at<=now();
   proofs:=proofs||jsonb_build_array(jsonb_build_object('assignment',to_jsonb(a),'grant',to_jsonb(g),'permissionLink',to_jsonb(l),'permission',to_jsonb(p),'site',to_jsonb(site),'evidence',evidence));
  END LOOP;

 IF cardinality(candidates)=0 THEN RAISE EXCEPTION 'ediel_ack_service_scope_current_grant_required' USING ERRCODE='42501';END IF;
 IF only_grant_ids IS NOT NULL AND cardinality(candidates)<>cardinality(only_grant_ids) THEN RAISE EXCEPTION 'ediel_ack_service_scope_captured_grant_not_current' USING ERRCODE='42501';END IF;
 -- Different beneficiaries/field sets/purposes are separate internal missions.
 -- Conflicting upstream customer or DSO relations cannot be guessed from GSRN.
 IF (SELECT count(DISTINCT jsonb_build_array(x#>>'{assignment,customer_id}',x#>>'{assignment,provider_actor_id}',x#>>'{assignment,dso_actor_id}',x#>>'{assignment,actor_profile_id}')) FROM jsonb_array_elements(proofs)x)<>1 THEN RAISE EXCEPTION 'ediel_ack_service_scope_upstream_relation_ambiguous' USING ERRCODE='42501';END IF;
 RETURN proofs;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_replay.current_service_grant_set_v2(uuid,text,jsonb,text,text,text,timestamptz,timestamptz,jsonb,uuid[]) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_ediel_ack_replay.positive_service_scope_projection_v2(c uuid,env text,sourceid uuid,ackraw text,sealed jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE ctx jsonb; origin_ctx jsonb; source public.ediel_messages%rowtype; origin public.ediel_messages%rowtype;
 tokens jsonb; t jsonb; current_erc text; positive_refs text[]:=ARRAY[]::text[]; tx text;
 reservation public.ediel_ack_transaction_results%rowtype; series public.meter_reading_series%rowtype;
 contract jsonb; stored gridex_utilts_binding.contracts%rowtype;
 a public.ediel_service_assignments%rowtype; g public.ediel_data_access_grants%rowtype;
 l public.ediel_assignment_permission_links%rowtype; p public.metering_permissions%rowtype;
 site public.metering_permission_sites%rowtype; candidate uuid; candidates uuid[];
 dso_ids text[]; sender text; origin_sender text; assessment jsonb; proofs jsonb:='[]'::jsonb; evidence jsonb;scopes jsonb;chosen jsonb;ids uuid[];base jsonb;sealed_version int;
BEGIN
 IF c IS NULL OR (env IN ('test','production')) IS NOT TRUE OR sourceid IS NULL OR ackraw IS NULL THEN RAISE EXCEPTION 'ediel_ack_service_scope_unavailable';END IF;
 -- Same graph locks as the atomic ACK owner; table locks prevent a newly
 -- inserted alternative grant or identity from racing unique-scope discovery.
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(c,env,sourceid);
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE company_id=c AND id=sourceid AND environment=env FOR SHARE;
 IF (ctx->>'actorRole' IN ('energy_service_company','esco')) IS NOT TRUE OR ctx->>'family' IS DISTINCT FROM 'UTILTS'
 OR source.direction IS DISTINCT FROM 'inbound' OR source.message_family IS DISTINCT FROM 'UTILTS' OR source.message_code IS DISTINCT FROM 'E66'
 OR ctx->>'code' IS DISTINCT FROM 'E66' OR ctx->>'applicationReference' IS DISTINCT FROM source.application_reference
 OR (ctx->>'applicationReference' ~ '^23-(DDQ|DGI)-E66-(S|T)$') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_ack_service_scope_source_unqualified';END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(ackraw);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='UNH' AND x#>>'{elements,2,0}'='APERAK')<>1
 OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='BGM' AND x#>>'{elements,1,0}'='312')<>1 THEN RAISE EXCEPTION 'ediel_ack_service_scope_ack_unqualified';END IF;
 -- ERC scopes its following ACW, rather than treating any ACW in a mixed
 -- positive/negative response as a positive transaction.
 FOR t IN SELECT value FROM jsonb_array_elements(tokens) WITH ORDINALITY x(value,n) ORDER BY n LOOP
  IF t->>'tag'='ERC' THEN current_erc:=t#>>'{elements,1,0}';
  ELSIF t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW' AND current_erc='100' THEN
   tx:=t#>>'{elements,1,1}';IF nullif(tx,'') IS NULL OR tx=ANY(positive_refs) THEN RAISE EXCEPTION 'ediel_ack_service_scope_positive_reference_invalid';END IF;
   positive_refs:=array_append(positive_refs,tx);
  END IF;
 END LOOP;
 IF sealed IS NOT NULL AND (jsonb_typeof(sealed->'transactions') IS DISTINCT FROM 'array' OR jsonb_array_length(sealed->'transactions')<>cardinality(positive_refs)) THEN RAISE EXCEPTION 'ediel_ack_service_scope_captured_set_invalid';END IF;
 IF cardinality(positive_refs)=0 THEN RAISE EXCEPTION 'ediel_ack_service_scope_positive_reference_unavailable';END IF;
 SELECT min(x#>>'{elements,2,0}') INTO sender FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(source.raw_payload)) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MS';
 IF sender IS NULL OR (SELECT count(*) FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(source.raw_payload)) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MS')<>1 THEN RAISE EXCEPTION 'ediel_ack_service_scope_dso_unqualified';END IF;
 FOREACH tx IN ARRAY positive_refs LOOP
  PERFORM public.gridex_require_utilts_positive_ack_authority_v1(c,env,sourceid,tx,NULL,NULL);
  SELECT * INTO STRICT reservation FROM public.ediel_ack_transaction_results WHERE company_id=c AND environment=env AND source_message_id=sourceid AND source_transaction_id=tx FOR SHARE;
  SELECT * INTO STRICT series FROM public.meter_reading_series WHERE company_id=c AND id=reservation.persisted_series_id FOR SHARE;
  SELECT * INTO STRICT stored FROM gridex_utilts_binding.contracts WHERE company_id=c AND series_id=series.id;
  contract:=gridex_utilts_binding.stored_contract_v1(c,series.source_ediel_message_id,stored.transaction_id);
  origin_ctx:=gridex_ediel_inbound_context.require_v1(c,series.source_ediel_message_id);
  SELECT * INTO STRICT origin FROM public.ediel_messages WHERE company_id=c AND id=series.source_ediel_message_id;
  -- Earlier genuine accepted origin reuse remains valid. The private contract
  -- and both original/current DSO identities still have to agree.
  IF contract IS DISTINCT FROM stored.contract OR contract->>'seriesKind' IS DISTINCT FROM 'actual' OR contract->>'messageCode' IS DISTINCT FROM 'E66'
  OR series.series_kind IS DISTINCT FROM 'actual' OR series.message_code IS DISTINCT FROM 'E66' OR series.period_start IS NULL OR series.period_end IS NULL OR series.period_end<=series.period_start
  OR origin.environment IS DISTINCT FROM env OR origin_ctx->>'legalActorId' IS DISTINCT FROM ctx->>'legalActorId' OR origin_ctx->>'legalEdielId' IS DISTINCT FROM ctx->>'legalEdielId'
  OR (origin_ctx->>'actorRole' IN ('energy_service_company','esco')) IS NOT TRUE OR origin_ctx->>'family' IS DISTINCT FROM 'UTILTS' OR origin_ctx->>'code' IS DISTINCT FROM 'E66'
  OR EXISTS(SELECT FROM jsonb_array_elements(contract->'observations') o WHERE o->>'externalPoint' IS DISTINCT FROM series.external_metering_point_id OR o->>'productCode' IS DISTINCT FROM series.product_id) THEN RAISE EXCEPTION 'ediel_ack_service_scope_contract_unqualified';END IF;
  SELECT min(x#>>'{elements,2,0}') INTO origin_sender FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(origin.raw_payload)) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MS';
  IF origin_sender IS DISTINCT FROM sender OR (SELECT count(*) FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(origin.raw_payload)) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MS')<>1 THEN RAISE EXCEPTION 'ediel_ack_service_scope_dso_unqualified';END IF;
  ids:=NULL;chosen:=NULL;
  IF sealed IS NOT NULL THEN
   SELECT x INTO STRICT chosen FROM jsonb_array_elements(sealed->'transactions')x WHERE x->>'transactionId'=tx;
   sealed_version:=(sealed->>'version')::int;
   IF sealed_version=1 THEN ids:=ARRAY[(chosen#>>'{grant,id}')::uuid];
   ELSIF sealed_version=2 THEN SELECT array_agg((x#>>'{grant,id}')::uuid ORDER BY x#>>'{grant,id}') INTO ids FROM jsonb_array_elements(chosen->'scopes')x;
   ELSE RAISE EXCEPTION 'ediel_ack_service_scope_captured_set_invalid';END IF;
  END IF;
  scopes:=gridex_ediel_ack_replay.current_service_grant_set_v2(c,env,ctx,sender,series.external_metering_point_id,series.product_id,series.period_start,series.period_end,contract,ids);
  base:=jsonb_build_object('transactionId',tx,'seriesId',series.id,'originMessageId',origin.id,'originRawHash',encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex'),'contractHash',stored.contract_hash,'originContext',origin_ctx);
  IF sealed IS NOT NULL AND sealed_version=1 THEN
   IF jsonb_array_length(scopes)<>1 THEN RAISE EXCEPTION 'ediel_ack_service_scope_captured_set_invalid';END IF;
   proofs:=proofs||jsonb_build_array(base||(scopes->0));
  ELSE proofs:=proofs||jsonb_build_array(base||jsonb_build_object('scopes',scopes));END IF;

 END LOOP;
 RETURN jsonb_build_object('version',CASE WHEN sealed IS NULL THEN 2 ELSE (sealed->>'version')::int END,'companyId',c,'environment',env,'sourceMessageId',sourceid,'sourceRawHash',encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex'),'ackRawHash',encode(sha256(convert_to(ackraw,'UTF8')),'hex'),'sourceContext',ctx,'transactions',proofs);
END $$;

REVOKE ALL ON FUNCTION gridex_ediel_ack_replay.positive_service_scope_projection_v2(uuid,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Preserve the old private API; new captures use the version2 grant-set facet.
CREATE OR REPLACE FUNCTION gridex_ediel_ack_replay.positive_service_scope_projection_v1(c uuid,env text,sourceid uuid,ackraw text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_ediel_ack_replay.positive_service_scope_projection_v2(c,env,sourceid,ackraw,NULL)$$;

-- An ESCO's prescribed positive PRODAT permission ACK is confirmation of
-- processed own-original data. It is never a positive UTILTS data-access grant.
CREATE FUNCTION gridex_ediel_ack_replay.prodat_permission_scope_projection_v2(c uuid,env text,sourceid uuid,ackraw text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ctx jsonb;s public.ediel_messages%rowtype;outcomes jsonb;transitions jsonb;source_rules jsonb;h text;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(c,env,sourceid);
 SELECT * INTO STRICT s FROM public.ediel_messages WHERE company_id=c AND id=sourceid AND environment=env AND direction='inbound' FOR SHARE;
 IF (ctx->>'actorRole' IN('energy_service_company','esco')) IS NOT TRUE OR ctx->>'family' IS DISTINCT FROM 'PRODAT' OR s.message_family IS DISTINCT FROM 'PRODAT' OR s.message_code NOT IN('Z14','Z15') OR ctx->>'code' IS DISTINCT FROM s.message_code THEN RAISE EXCEPTION 'ediel_ack_service_scope_source_unqualified';END IF;
 source_rules:=gridex_ediel_source_rules.require_v1(c,sourceid);
 outcomes:=gridex_ediel_ack_guide.prodat_outcomes_v1(ackraw,s.raw_payload);
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(outcomes)x WHERE x->>'outcome'='positive') THEN RAISE EXCEPTION 'ediel_ack_service_scope_positive_reference_unavailable';END IF;
 h:=encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex');
 SELECT jsonb_agg(to_jsonb(t) ORDER BY t.permission_id) INTO transitions FROM gridex_received_sources.permission_transitions t WHERE t.company_id=c AND t.source_message_id=sourceid AND t.payload_hash=h AND t.qualified_expected_message_code=s.message_code AND t.qualified_original_message_id IS NOT NULL;
 IF transitions IS NULL THEN RAISE EXCEPTION 'ediel_ack_service_scope_prodat_own_commit_required';END IF;
 RETURN jsonb_build_object('version',2,'scopeKind','prescribed_prodat_permission_ack','companyId',c,'environment',env,'sourceMessageId',sourceid,'sourceRawHash',h,'ackRawHash',encode(sha256(convert_to(ackraw,'UTF8')),'hex'),'sourceContext',ctx,'sourceRuleEvidence',source_rules,'outcomes',outcomes,'permissionTransitions',transitions,'dataAccessGranted',false);
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_replay.prodat_permission_scope_projection_v2(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION gridex_ediel_ack_replay.capture_positive_service_scope_v1(c uuid,env text,sourceid uuid,ackraw text,actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE projection jsonb;existing gridex_ediel_ack_replay.positive_service_scope_receipts%rowtype;h text;ctx jsonb;
BEGIN
 PERFORM gridex_ediel_ack_replay.require_current_service_actor_v1(c,actor);
 h:=encode(sha256(convert_to(ackraw,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended('ediel_ack_service_scope:'||c::text||':'||env||':'||sourceid::text||':'||h,0));
 SELECT * INTO existing FROM gridex_ediel_ack_replay.positive_service_scope_receipts r WHERE r.company_id=c AND r.environment=env AND r.source_message_id=sourceid AND r.ack_raw_hash=h;
 ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(c,env,sourceid);
 IF ctx->>'family'='PRODAT' THEN projection:=gridex_ediel_ack_replay.prodat_permission_scope_projection_v2(c,env,sourceid,ackraw);
 ELSE projection:=gridex_ediel_ack_replay.positive_service_scope_projection_v2(c,env,sourceid,ackraw,CASE WHEN existing.source_message_id IS NOT NULL THEN existing.projection ELSE NULL END);END IF;
 IF existing.source_message_id IS NOT NULL THEN
  IF existing.projection IS DISTINCT FROM projection OR existing.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'ediel_ack_service_scope_receipt_conflict';END IF;
  RETURN;
 END IF;
 INSERT INTO gridex_ediel_ack_replay.positive_service_scope_receipts(company_id,environment,source_message_id,ack_raw_hash,actor_user_id,projection) VALUES(c,env,sourceid,h,actor,projection);
END $$;
CREATE OR REPLACE FUNCTION gridex_ediel_ack_replay.require_positive_service_scope_v1(c uuid,env text,sourceid uuid,ackraw text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing gridex_ediel_ack_replay.positive_service_scope_receipts%rowtype;projection jsonb;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO existing FROM gridex_ediel_ack_replay.positive_service_scope_receipts r WHERE r.company_id=c AND r.environment=env AND r.source_message_id=sourceid AND r.ack_raw_hash=encode(sha256(convert_to(ackraw,'UTF8')),'hex');
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ack_service_scope_receipt_unavailable';END IF;
 PERFORM gridex_ediel_ack_replay.require_current_service_actor_v1(c,existing.actor_user_id);
 IF existing.projection->>'scopeKind'='prescribed_prodat_permission_ack' THEN projection:=gridex_ediel_ack_replay.prodat_permission_scope_projection_v2(c,env,sourceid,ackraw);
 ELSE projection:=gridex_ediel_ack_replay.positive_service_scope_projection_v2(c,env,sourceid,ackraw,existing.projection);END IF;
 IF projection IS DISTINCT FROM existing.projection THEN RAISE EXCEPTION 'ediel_ack_service_scope_receipt_changed';END IF;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_replay.capture_positive_service_scope_v1(uuid,text,uuid,text,uuid),gridex_ediel_ack_replay.require_positive_service_scope_v1(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION gridex_utilts_binding.require_current_esco_storage_v1(c uuid,env text,sourceid uuid,transactions jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE ctx jsonb;source public.ediel_messages%rowtype;tokens jsonb;item jsonb;contract jsonb;point text;product text;period text;offset_value text;v_period_start timestamptz;v_period_end timestamptz;
 own_start int;own_end int;header_end int;sender text;candidate uuid;candidates uuid[];
 a public.ediel_service_assignments%rowtype;g public.ediel_data_access_grants%rowtype;l public.ediel_assignment_permission_links%rowtype;p public.metering_permissions%rowtype;dso_ids text[];
BEGIN
 -- The private receipt decides the legal role; caller JSON cannot opt out.
 SELECT context INTO ctx FROM gridex_ediel_inbound_context.receipts WHERE company_id=c AND source_message_id=sourceid AND environment=env AND status='ready';
 IF ctx IS NULL THEN
  IF EXISTS(SELECT FROM jsonb_array_elements(transactions) x WHERE x->>'disposition'='accepted') THEN PERFORM gridex_ediel_inbound_context.require_v1(c,sourceid);END IF;
  RETURN;
 END IF;
 ctx:=gridex_ediel_inbound_context.require_v1(c,sourceid);
 IF (ctx->>'actorRole' IN ('energy_service_company','esco')) IS NOT TRUE THEN RETURN;END IF;
 ctx:=gridex_ediel_ack_replay.require_current_source_role_v2(c,env,sourceid);
 SELECT * INTO STRICT source FROM public.ediel_messages WHERE company_id=c AND id=sourceid AND environment=env FOR SHARE;
 IF ctx->>'family' IS DISTINCT FROM 'UTILTS' OR ctx->>'code' IS DISTINCT FROM 'E66' OR source.direction IS DISTINCT FROM 'inbound'
 OR source.message_family IS DISTINCT FROM 'UTILTS' OR source.message_code IS DISTINCT FROM 'E66'
 OR ctx->>'applicationReference' IS DISTINCT FROM source.application_reference OR (ctx->>'applicationReference' ~ '^23-(DDQ|DGI)-E66-(S|T)$') IS NOT TRUE THEN RAISE EXCEPTION 'utilts_esco_source_scope_unqualified' USING ERRCODE='42501';END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(source.raw_payload);
 SELECT min(x#>>'{elements,2,0}') INTO sender FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MS';
 IF sender IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='NAD' AND x#>>'{elements,1,0}'='MS')<>1 THEN RAISE EXCEPTION 'utilts_esco_source_dso_unqualified' USING ERRCODE='42501';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(transactions) LOOP
  -- Every requested outcome must be the actual canonical private own-IDE facet.
  PERFORM gridex_received_sources.require_utilts_transaction_v1(c,sourceid,item->>'transactionId',item->>'disposition',item->>'responseType',item->'issueCodes');
  -- A protocol-prescribed negative own-original response needs communication
  -- authority/current local role, but does not authorize positive business data.
  IF item->>'disposition'<>'accepted' THEN CONTINUE;END IF;
  PERFORM gridex_ediel_source_rules.require_v1(c,sourceid);
  contract:=item->'consumptionContract';
  IF NOT coalesce(gridex_utilts_binding.validate_contract_v1(contract),false) OR contract->>'companyId' IS DISTINCT FROM c::text OR contract->>'environment' IS DISTINCT FROM env OR contract->>'messageCode' IS DISTINCT FROM 'E66' OR contract->>'seriesKind' IS DISTINCT FROM 'actual' OR item->>'seriesKind' IS DISTINCT FROM 'actual' OR contract->>'transactionId' IS DISTINCT FROM item->>'transactionId' THEN RAISE EXCEPTION 'utilts_esco_contract_scope_unqualified' USING ERRCODE='42501';END IF;
  point:=gridex_utilts_binding.supported_point_v1(tokens,item->>'transactionId');
  SELECT (x->>'index')::int INTO STRICT own_start FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='IDE' AND x#>>'{elements,2,0}'=item->>'transactionId';
  SELECT min((x->>'index')::int) INTO own_end FROM jsonb_array_elements(tokens) x WHERE (x->>'index')::int>own_start AND x->>'tag' IN('IDE','UNT');
  SELECT coalesce(min((x->>'index')::int),own_end) INTO header_end FROM jsonb_array_elements(tokens) x WHERE (x->>'index')::int>own_start AND (x->>'index')::int<own_end AND x->>'tag'='SEQ';
  SELECT x#>>'{elements,3,0}' INTO STRICT product FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='LIN' AND (x->>'index')::int>own_start AND (x->>'index')::int<header_end AND x#>>'{elements,3,3}'='9';
  SELECT x#>>'{elements,1,1}' INTO STRICT period FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='DTM' AND (x->>'index')::int>own_start AND (x->>'index')::int<header_end AND x#>>'{elements,1,0}'='324' AND x#>>'{elements,1,2}'='719';
  SELECT x#>>'{elements,1,1}' INTO STRICT offset_value FROM jsonb_array_elements(tokens) x WHERE x->>'tag'='DTM' AND (x->>'index')::int<own_start AND x#>>'{elements,1,0}'='735' AND x#>>'{elements,1,2}'='406';
  v_period_start:=gridex_utilts_binding.esco_local_time_v1(substr(period,1,12),offset_value);v_period_end:=gridex_utilts_binding.esco_local_time_v1(substr(period,13,12),offset_value);
  IF point IS NULL OR period !~ '^[0-9]{24}$' OR nullif(product,'') IS NULL OR v_period_start IS NULL OR v_period_end IS NULL OR v_period_end<=v_period_start
  OR item->>'externalMeteringPointId' IS DISTINCT FROM point OR item->>'productId' IS DISTINCT FROM product OR (item->>'periodStart')::timestamptz IS DISTINCT FROM v_period_start OR (item->>'periodEnd')::timestamptz IS DISTINCT FROM v_period_end
  OR (contract#>>'{interpretation,localPeriodStart}')::timestamp IS DISTINCT FROM (v_period_start+make_interval(mins=>(substr(offset_value,2,2)::int*60+substr(offset_value,4,2)::int)*CASE left(offset_value,1) WHEN '-' THEN -1 ELSE 1 END)) AT TIME ZONE 'UTC' OR (contract#>>'{interpretation,localPeriodEnd}')::timestamp IS DISTINCT FROM (v_period_end+make_interval(mins=>(substr(offset_value,2,2)::int*60+substr(offset_value,4,2)::int)*CASE left(offset_value,1) WHEN '-' THEN -1 ELSE 1 END)) AT TIME ZONE 'UTC' OR contract#>>'{interpretation,timezoneRaw}' IS DISTINCT FROM offset_value
  OR EXISTS(SELECT FROM jsonb_array_elements(contract->'observations') o WHERE o->>'externalPoint' IS DISTINCT FROM point OR o->>'productCode' IS DISTINCT FROM product OR (o->>'periodStart')::timestamptz<v_period_start OR (o->>'periodEnd')::timestamptz>v_period_end) THEN RAISE EXCEPTION 'utilts_esco_physical_scope_unqualified' USING ERRCODE='42501';END IF;
  PERFORM gridex_ediel_ack_replay.current_service_grant_set_v2(c,env,ctx,sender,point,product,v_period_start,v_period_end,contract,NULL);

 END LOOP;
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'utilts_esco_physical_scope_unqualified' USING ERRCODE='42501';END $$;

CREATE FUNCTION gridex_ediel_ack_replay.beneficiary_series_page_filtered_v2(p_beneficiary_company_id uuid,p_actor_user_id uuid,p_grant_id uuid,p_expected_grant_version bigint,p_purpose text,p_series_id uuid,p_fields text[],p_start timestamptz,p_end timestamptz,p_limit integer default 100,p_after_at timestamptz default null,p_after_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g public.ediel_data_access_grants%rowtype; a public.ediel_service_assignments%rowtype; l public.ediel_assignment_permission_links%rowtype; p public.metering_permissions%rowtype; s public.meter_reading_series%rowtype; payload jsonb; next_cursor jsonb; source_id uuid; source_context jsonb; source_row public.ediel_messages%rowtype; bound_contract jsonb; selected_contract jsonb; source_transaction text; source_sender text; dso_id text;
begin
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=p_beneficiary_company_id AND m.user_id=p_actor_user_id FOR SHARE;
 if not exists(select 1 from public.company_memberships m where m.company_id=p_beneficiary_company_id and m.user_id=p_actor_user_id and m.status='active' and m.is_active and m.accepted_at is not null) or not exists(select 1 from public.user_profiles u where u.id=p_actor_user_id and u.user_status='active') or not coalesce(public.gridex_actor_has_company_permission(p_actor_user_id,p_beneficiary_company_id,'metering.read'),false) then raise exception 'ediel_beneficiary_forbidden' using errcode='42501'; end if;
 if p_start is null or p_end is null or p_end<=p_start or p_limit is null or p_limit<1 or p_limit>500 or (p_after_at is null)<>(p_after_id is null) or p_fields is null or cardinality(p_fields)=0 or array_position(p_fields,null) is not null then raise exception 'ediel_projection_request_invalid'; end if;
 -- Match the command's assignment-before-grant lock order. Identity is immutable.
 select * into strict g from public.ediel_data_access_grants where id=p_grant_id and beneficiary_company_id=p_beneficiary_company_id;
 -- Discover the owned immutable source first, then lock it before assignment/grant:
 -- the shared legal-context authority takes the same source FOR UPDATE lock.
 SELECT source_ediel_message_id INTO STRICT source_id FROM public.meter_reading_series WHERE company_id=g.company_id AND id=p_series_id;
 source_context:=gridex_ediel_inbound_context.require_v1(g.company_id,source_id);
 SELECT * INTO STRICT source_row FROM public.ediel_messages WHERE company_id=g.company_id AND id=source_id;
 source_context:=gridex_ediel_ack_replay.require_current_source_role_v2(g.company_id,source_row.environment,source_id);
 select * into strict a from public.ediel_service_assignments where company_id=g.company_id and id=g.assignment_id for share;
 select * into strict g from public.ediel_data_access_grants where id=p_grant_id and beneficiary_company_id=p_beneficiary_company_id for share;
 if p_expected_grant_version is null or p_expected_grant_version<1 or g.version is distinct from p_expected_grant_version or g.status<>'active' or g.revoked_at is not null or g.valid_from>now() or (g.valid_to is not null and g.valid_to<=now()) then raise exception 'ediel_grant_not_current'; end if;
 if g.beneficiary_company_id is distinct from a.beneficiary_company_id or g.purpose is distinct from a.purpose or not(g.object_ids <@ a.object_ids and g.product_ids <@ a.product_ids and g.fields <@ a.field_sets) or g.data_start<a.data_start or (a.data_end is not null and (g.data_end is null or g.data_end>a.data_end)) or g.valid_from<a.valid_from or (a.valid_to is not null and (g.valid_to is null or g.valid_to>a.valid_to)) then raise exception 'ediel_grant_basis_changed'; end if;
 if public.ediel_service_assignment_assessment_v1(a.company_id,a.id)->>'status' is distinct from 'authorized' then raise exception 'ediel_assignment_not_authorized'; end if;
 if p_purpose is null or p_purpose<>g.purpose or not(p_fields <@ g.fields) or p_start<g.data_start or (g.data_end is not null and p_end>g.data_end) then raise exception 'ediel_projection_outside_grant'; end if;
 select * into strict l from public.ediel_assignment_permission_links where company_id=g.company_id and id=g.permission_link_id and assignment_id=g.assignment_id for share;
 select * into strict p from public.metering_permissions where company_id=g.company_id and id=l.permission_id for share;
 if (p.status in ('active','approved','partially_approved')) is not true or p.customer_id is distinct from a.customer_id or p.source_z14_message_id is null and p.inbound_z14_message_id is null then raise exception 'ediel_market_permission_not_approved'; end if;
 PERFORM x.id FROM public.metering_permission_sites x WHERE x.company_id=g.company_id AND x.metering_permission_id=p.id ORDER BY x.id FOR SHARE;
 if public.ediel_permission_source_is_current_v1(g.company_id,p.id,coalesce(p.inbound_z14_message_id,p.source_z14_message_id)) is not true then raise exception 'ediel_permission_source_not_current'; end if;
 if gridex_service_administration.permission_matches_assignment_v1(a,p) is not true then raise exception 'ediel_permission_legal_actor_mismatch';end if;
 select * into strict s from public.meter_reading_series where company_id=g.company_id and id=p_series_id for share;
 if s.message_code is distinct from 'E66' or s.series_kind is distinct from 'actual' or (s.external_metering_point_id=any(g.object_ids)) is not true or (s.product_id=any(g.product_ids)) is not true or s.period_start is null or s.period_end is null or p_start<s.period_start or p_end>s.period_end then raise exception 'ediel_series_outside_grant'; end if;
 if s.source_ediel_message_id IS DISTINCT FROM source_id OR source_row.environment IS DISTINCT FROM a.environment OR source_row.direction IS DISTINCT FROM 'inbound' OR source_row.message_family IS DISTINCT FROM 'UTILTS' OR source_row.message_code IS DISTINCT FROM 'E66' OR source_context->>'legalActorId' IS DISTINCT FROM a.provider_actor_id::text OR source_context->>'actorRole' IS DISTINCT FROM 'energy_service_company' OR source_context->>'environment' IS DISTINCT FROM a.environment OR source_context->>'direction' IS DISTINCT FROM 'inbound' OR source_context->>'family' IS DISTINCT FROM 'UTILTS' OR source_context->>'code' IS DISTINCT FROM 'E66' THEN RAISE EXCEPTION 'ediel_series_source_actor_not_qualified'; END IF;
 -- Bind the series to its private accepted transaction, never parsed metadata.
 SELECT c.transaction_id,c.contract INTO STRICT source_transaction,selected_contract FROM gridex_utilts_binding.contracts c WHERE c.company_id=g.company_id AND c.series_id=s.id AND c.source_message_id=source_id;
 bound_contract:=gridex_utilts_binding.stored_contract_v1(g.company_id,source_id,source_transaction);
 IF bound_contract IS DISTINCT FROM selected_contract OR bound_contract->>'seriesKind' IS DISTINCT FROM 'actual' OR bound_contract->>'messageCode' IS DISTINCT FROM 'E66' OR EXISTS(SELECT FROM jsonb_array_elements(bound_contract->'observations') o WHERE o->>'externalPoint' IS DISTINCT FROM s.external_metering_point_id OR o->>'productCode' IS DISTINCT FROM s.product_id) THEN RAISE EXCEPTION 'ediel_series_source_contract_mismatch';END IF;
 SELECT min(t#>>'{elements,2,0}') INTO source_sender FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(source_row.raw_payload)) t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='MS';
 SELECT min(i.identifier_value) INTO dso_id FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN ('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date);
 IF source_sender IS NULL OR source_sender IS DISTINCT FROM dso_id OR (SELECT count(*) FROM jsonb_array_elements(gridex_utilts_binding.wire_tokens_v1(source_row.raw_payload)) t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='MS')<>1 THEN RAISE EXCEPTION 'ediel_series_source_dso_not_qualified';END IF;
 if not exists(select 1 from public.ediel_messages z14 where z14.id=coalesce(p.inbound_z14_message_id,p.source_z14_message_id) and z14.company_id=g.company_id and z14.environment=a.environment and z14.direction='inbound' and z14.message_family='PRODAT' and z14.message_code='Z14') then raise exception 'ediel_permission_source_not_qualified'; end if;
 if not exists(select 1 from public.metering_permission_sites x where x.company_id=g.company_id and x.metering_permission_id=p.id and x.customer_id=a.customer_id and x.facility_id=s.external_metering_point_id and x.status in ('approved','active') and x.metadata->>'source'='inbound_prodat_z14' and x.metadata->>'edielMessageId'=coalesce(p.inbound_z14_message_id,p.source_z14_message_id)::text and x.metadata->>'mode'=case a.mode when 'V' then 'S17' else 'S18' end and x.metadata->>'product'=s.product_id and x.start_at is not null and p_start>=x.start_at and (x.end_at is null or p_end<=x.end_at)) then raise exception 'ediel_permission_object_not_approved'; end if;
 -- Field whitelist is the full projection: raw_transaction/metadata/raw EML are never returned.
 with page as (
  select v.id,v.reading_at,(select jsonb_object_agg(k,value) from jsonb_each(jsonb_build_object('reading_at',v.reading_at,'quantity',v.quantity::text,'unit',v.unit,'quality',v.quality,'qualifier',v.qualifier,'registration_date',s.registration_date,'resolution',s.resolution,'product_id',s.product_id)) as allowed(k,value) where k=any(p_fields)) as projected
  from public.meter_reading_values v where v.company_id=g.company_id and v.series_id=s.id and v.reading_at>=p_start and v.reading_at<p_end and (p_after_at is null or (v.reading_at,v.id)>(p_after_at,p_after_id)) order by v.reading_at,v.id limit p_limit
 ) select coalesce(jsonb_agg(projected order by reading_at,id),'[]'::jsonb),(select jsonb_build_object('readingAt',reading_at,'valueId',id) from page order by reading_at desc,id desc limit 1) into payload,next_cursor from page;
 return jsonb_build_object('grantId',g.id,'grantVersion',g.version,'seriesId',s.id,'rows',payload,'next',case when jsonb_array_length(payload)=p_limit then next_cursor else null end);
end;
$$;


REVOKE ALL ON FUNCTION gridex_ediel_ack_replay.beneficiary_series_page_filtered_v2(uuid,uuid,uuid,bigint,text,uuid,text[],timestamptz,timestamptz,integer,timestamptz,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.ediel_beneficiary_series_page_v1(p_beneficiary_company_id uuid,p_actor_user_id uuid,p_grant_id uuid,p_expected_grant_version bigint,p_purpose text,p_series_id uuid,p_fields text[],p_start timestamptz,p_end timestamptz,p_limit integer DEFAULT 100,p_after_at timestamptz DEFAULT NULL,p_after_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 -- Acquire the common current authority graph before any actor/source/grant
 -- read. This prevents DENY phantoms and source-to-graph lock inversion.
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 RETURN gridex_ediel_ack_replay.beneficiary_series_page_filtered_v2(p_beneficiary_company_id,p_actor_user_id,p_grant_id,p_expected_grant_version,p_purpose,p_series_id,p_fields,p_start,p_end,p_limit,p_after_at,p_after_id);
END $$;
COMMIT;
