-- Created with Supabase CLI 2.118.0. A positive ESCO ACK seals the actual
-- accepted transaction and the current native service grant. Replay never
-- discovers an assignment from parsed metadata or replaces a sealed receipt.
BEGIN;
CREATE TABLE gridex_ediel_ack_replay.positive_service_scope_receipts (
 company_id uuid NOT NULL REFERENCES public.companies(id), environment text NOT NULL CHECK(environment IN ('test','production')),
 source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id), ack_raw_hash text NOT NULL CHECK(length(ack_raw_hash)=64),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id), projection jsonb NOT NULL CHECK(jsonb_typeof(projection)='object'),
 recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(company_id,environment,source_message_id,ack_raw_hash)
);
ALTER TABLE gridex_ediel_ack_replay.positive_service_scope_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_ediel_ack_replay.positive_service_scope_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_ediel_ack_replay.positive_service_scope_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_ediel_ack_replay.service_scope_immutable_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'ediel_ack_service_scope_immutable';END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_replay.service_scope_immutable_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER positive_service_scope_immutable BEFORE UPDATE OR DELETE ON gridex_ediel_ack_replay.positive_service_scope_receipts FOR EACH ROW EXECUTE FUNCTION gridex_ediel_ack_replay.service_scope_immutable_v1();
CREATE TRIGGER positive_service_scope_no_truncate BEFORE TRUNCATE ON gridex_ediel_ack_replay.positive_service_scope_receipts FOR EACH STATEMENT EXECUTE FUNCTION gridex_ediel_ack_replay.service_scope_immutable_v1();

CREATE FUNCTION gridex_ediel_ack_replay.positive_service_scope_projection_v1(c uuid,env text,sourceid uuid,ackraw text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE ctx jsonb; origin_ctx jsonb; source public.ediel_messages%rowtype; origin public.ediel_messages%rowtype;
 tokens jsonb; t jsonb; current_erc text; positive_refs text[]:=ARRAY[]::text[]; tx text;
 reservation public.ediel_ack_transaction_results%rowtype; series public.meter_reading_series%rowtype;
 contract jsonb; stored gridex_utilts_binding.contracts%rowtype;
 a public.ediel_service_assignments%rowtype; g public.ediel_data_access_grants%rowtype;
 l public.ediel_assignment_permission_links%rowtype; p public.metering_permissions%rowtype;
 site public.metering_permission_sites%rowtype; candidate uuid; candidates uuid[];
 dso_ids text[]; sender text; origin_sender text; assessment jsonb; proofs jsonb:='[]'::jsonb; evidence jsonb;
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
  -- Discover only from actual point/product/period and retained provider role.
  -- Fully assess every eligible candidate; ambiguity is a hold, not LIMIT 1.
  candidates:=ARRAY[]::uuid[];
  FOR candidate IN SELECT x.id FROM public.ediel_data_access_grants x JOIN public.ediel_service_assignments y ON y.company_id=x.company_id AND y.id=x.assignment_id
   WHERE x.company_id=c AND x.status='active' AND x.revoked_at IS NULL AND x.valid_from<=now() AND (x.valid_to IS NULL OR now()<x.valid_to)
   AND y.provider_actor_id::text=ctx->>'legalActorId' AND y.actor_profile_id::text=ctx#>>'{facts,profile,id}' AND y.environment=env
   AND series.external_metering_point_id=ANY(x.object_ids) AND series.product_id=ANY(x.product_ids)
   AND series.period_start>=x.data_start AND (x.data_end IS NULL OR series.period_end<=x.data_end) ORDER BY x.id LOOP
   SELECT * INTO STRICT g FROM public.ediel_data_access_grants WHERE company_id=c AND id=candidate FOR SHARE;
   SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=c AND id=g.assignment_id FOR SHARE;
   IF g.beneficiary_company_id IS DISTINCT FROM a.beneficiary_company_id OR g.purpose IS DISTINCT FROM a.purpose OR NOT(g.object_ids <@ a.object_ids AND g.product_ids <@ a.product_ids AND g.fields <@ a.field_sets)
   OR g.data_start<a.data_start OR (a.data_end IS NOT NULL AND (g.data_end IS NULL OR g.data_end>a.data_end)) OR g.valid_from<a.valid_from OR (a.valid_to IS NOT NULL AND (g.valid_to IS NULL OR g.valid_to>a.valid_to)) THEN CONTINUE;END IF;
   assessment:=public.ediel_service_assignment_assessment_v1(c,a.id);IF assessment->>'status' IS DISTINCT FROM 'authorized' THEN CONTINUE;END IF;
   SELECT * INTO l FROM public.ediel_assignment_permission_links WHERE company_id=c AND id=g.permission_link_id AND assignment_id=a.id;
   IF NOT FOUND THEN CONTINUE;END IF;
   SELECT * INTO p FROM public.metering_permissions WHERE company_id=c AND id=l.permission_id;
   IF NOT FOUND OR (p.status IN ('active','approved','partially_approved')) IS NOT TRUE OR p.customer_id IS DISTINCT FROM a.customer_id
   OR gridex_service_administration.permission_matches_assignment_v1(a,p) IS NOT TRUE THEN CONTINUE;END IF;
   SELECT array_agg(DISTINCT i.identifier_value ORDER BY i.identifier_value) INTO dso_ids FROM public.platform_actor_identifiers i WHERE i.actor_id=a.dso_actor_id AND lower(i.identifier_type) IN ('edielid','ediel_id') AND i.is_verified AND (i.valid_from IS NULL OR i.valid_from<=current_date) AND (i.valid_to IS NULL OR i.valid_to>=current_date);
   IF cardinality(dso_ids) IS DISTINCT FROM 1 OR dso_ids[1] IS DISTINCT FROM sender THEN CONTINUE;END IF;
   IF NOT EXISTS(SELECT FROM public.ediel_messages z WHERE z.company_id=c AND z.id=coalesce(p.inbound_z14_message_id,p.source_z14_message_id) AND z.environment=env AND z.direction='inbound' AND z.message_family='PRODAT' AND z.message_code='Z14') THEN CONTINUE;END IF;
   IF (SELECT count(*) FROM public.metering_permission_sites x WHERE x.company_id=c AND x.metering_permission_id=p.id AND x.customer_id=a.customer_id AND x.facility_id=series.external_metering_point_id
    AND x.status IN ('approved','active') AND x.metadata->>'source'='inbound_prodat_z14' AND x.metadata->>'edielMessageId'=coalesce(p.inbound_z14_message_id,p.source_z14_message_id)::text
    AND x.metadata->>'mode'=CASE a.mode WHEN 'V' THEN 'S17' ELSE 'S18' END AND x.metadata->>'product'=series.product_id AND x.start_at IS NOT NULL AND series.period_start>=x.start_at AND (x.end_at IS NULL OR series.period_end<=x.end_at))<>1 THEN CONTINUE;END IF;
   candidates:=array_append(candidates,candidate);
  END LOOP;
  IF cardinality(candidates)<>1 THEN RAISE EXCEPTION 'ediel_ack_service_scope_unique_current_grant_required';END IF;
  SELECT * INTO STRICT g FROM public.ediel_data_access_grants WHERE company_id=c AND id=candidates[1];
  SELECT * INTO STRICT a FROM public.ediel_service_assignments WHERE company_id=c AND id=g.assignment_id;
  SELECT * INTO STRICT l FROM public.ediel_assignment_permission_links WHERE company_id=c AND id=g.permission_link_id AND assignment_id=a.id;
  SELECT * INTO STRICT p FROM public.metering_permissions WHERE company_id=c AND id=l.permission_id;
  SELECT * INTO STRICT site FROM public.metering_permission_sites x WHERE x.company_id=c AND x.metering_permission_id=p.id AND x.customer_id=a.customer_id AND x.facility_id=series.external_metering_point_id AND x.status IN ('approved','active') AND x.metadata->>'source'='inbound_prodat_z14' AND x.metadata->>'edielMessageId'=coalesce(p.inbound_z14_message_id,p.source_z14_message_id)::text AND x.metadata->>'mode'=CASE a.mode WHEN 'V' THEN 'S17' ELSE 'S18' END AND x.metadata->>'product'=series.product_id AND x.start_at IS NOT NULL AND series.period_start>=x.start_at AND (x.end_at IS NULL OR series.period_end<=x.end_at);
  SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) INTO evidence FROM public.ediel_service_evidence e WHERE e.company_id=c AND e.assignment_id=a.id AND e.status='verified' AND e.approved_assignment_version=a.scope_basis_version AND e.valid_from<=now() AND (e.valid_to IS NULL OR now()<e.valid_to) AND e.approved_at<=now();
  proofs:=proofs||jsonb_build_array(jsonb_build_object('transactionId',tx,'seriesId',series.id,'originMessageId',origin.id,'originRawHash',encode(sha256(convert_to(origin.raw_payload,'UTF8')),'hex'),'contractHash',stored.contract_hash,'originContext',origin_ctx,
   'assignment',to_jsonb(a),'grant',to_jsonb(g),'permissionLink',to_jsonb(l),'permission',to_jsonb(p),'site',to_jsonb(site),'evidence',evidence));
 END LOOP;
 RETURN jsonb_build_object('version',1,'companyId',c,'environment',env,'sourceMessageId',sourceid,'sourceRawHash',encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex'),'ackRawHash',encode(sha256(convert_to(ackraw,'UTF8')),'hex'),'sourceContext',ctx,'transactions',proofs);
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_replay.positive_service_scope_projection_v1(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_ediel_ack_replay.require_current_service_actor_v1(c uuid,actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 IF c IS NULL OR actor IS NULL OR NOT EXISTS(SELECT FROM public.companies co WHERE co.id=c AND co.status='active')
 OR NOT EXISTS(SELECT FROM public.user_profiles u WHERE u.id=actor AND u.user_status='active')
 OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=actor AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL)
 OR public.gridex_actor_has_company_permission(actor,c,'communication.write') IS NOT TRUE THEN RAISE EXCEPTION 'ediel_ack_service_actor_not_authorized' USING ERRCODE='42501';END IF;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_replay.require_current_service_actor_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION gridex_ediel_ack_replay.capture_positive_service_scope_v1(c uuid,env text,sourceid uuid,ackraw text,actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE projection jsonb;existing gridex_ediel_ack_replay.positive_service_scope_receipts%rowtype;h text;
BEGIN
 PERFORM gridex_ediel_ack_replay.require_current_service_actor_v1(c,actor);
 projection:=gridex_ediel_ack_replay.positive_service_scope_projection_v1(c,env,sourceid,ackraw);h:=projection->>'ackRawHash';
 PERFORM pg_advisory_xact_lock(hashtextextended('ediel_ack_service_scope:'||c::text||':'||env||':'||sourceid::text||':'||h,0));
 SELECT * INTO existing FROM gridex_ediel_ack_replay.positive_service_scope_receipts r WHERE r.company_id=c AND r.environment=env AND r.source_message_id=sourceid AND r.ack_raw_hash=h;
 IF FOUND THEN
  IF existing.projection IS DISTINCT FROM projection OR existing.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION 'ediel_ack_service_scope_receipt_conflict';END IF;
  RETURN;
 END IF;
 INSERT INTO gridex_ediel_ack_replay.positive_service_scope_receipts(company_id,environment,source_message_id,ack_raw_hash,actor_user_id,projection) VALUES(c,env,sourceid,h,actor,projection);
END $$;
CREATE FUNCTION gridex_ediel_ack_replay.require_positive_service_scope_v1(c uuid,env text,sourceid uuid,ackraw text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing gridex_ediel_ack_replay.positive_service_scope_receipts%rowtype;projection jsonb;
BEGIN
 SELECT * INTO existing FROM gridex_ediel_ack_replay.positive_service_scope_receipts r WHERE r.company_id=c AND r.environment=env AND r.source_message_id=sourceid AND r.ack_raw_hash=encode(sha256(convert_to(ackraw,'UTF8')),'hex');
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_ack_service_scope_receipt_unavailable';END IF;
 PERFORM gridex_ediel_ack_replay.require_current_service_actor_v1(c,existing.actor_user_id);
 projection:=gridex_ediel_ack_replay.positive_service_scope_projection_v1(c,env,sourceid,ackraw);
 IF projection IS DISTINCT FROM existing.projection THEN RAISE EXCEPTION 'ediel_ack_service_scope_receipt_changed';END IF;
END $$;
REVOKE ALL ON FUNCTION gridex_ediel_ack_replay.capture_positive_service_scope_v1(uuid,text,uuid,text,uuid),gridex_ediel_ack_replay.require_positive_service_scope_v1(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
