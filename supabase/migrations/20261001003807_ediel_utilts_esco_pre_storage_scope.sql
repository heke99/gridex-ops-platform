-- Supabase CLI 2.118.0 prospective owner: current ESCO authority precedes
-- every private binding, reservation, revision, business series and audit write.
-- Original persistence/precision functions and their OIDs remain unchanged.
BEGIN;
CREATE FUNCTION gridex_utilts_binding.lock_storage_graph_v1() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 -- Identical prefix/order to ACK replay. Writers take their final compatible
 -- table mode before any source or shared graph read; no SHARE-to-write upgrade.
 LOCK TABLE auth.users,public.user_profiles,public.companies,public.company_memberships,public.admin_users,
 public.user_roles,public.roles,public.role_permissions,public.permissions,public.user_permissions,public.user_permission_overrides,
 public.tenant_actor_identifiers,public.tenant_actor_roles,public.tenant_ediel_profiles,public.tenant_counterparty_relations,public.platform_actor_identifiers,
 public.ediel_service_assignments,public.ediel_service_evidence,public.ediel_data_access_grants,public.ediel_assignment_permission_links,
 public.metering_permissions,public.metering_permission_sites IN SHARE MODE;
 LOCK TABLE public.ediel_ack_transaction_results,public.meter_reading_series,gridex_utilts_binding.receipts,gridex_utilts_binding.contracts IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE gridex_service_administration.scope_versions,gridex_received_sources.permission_transitions,gridex_received_sources.validation_assessments IN SHARE MODE;
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();
END $$;
CREATE FUNCTION gridex_utilts_binding.esco_local_time_v1(value text,offset_value text) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE local_value timestamp;offset_minutes int;BEGIN
 IF value !~ '^[0-9]{12}$' OR offset_value !~ '^[+-][0-9]{4}$' OR substr(offset_value,4,2)::int>59 OR substr(offset_value,2,2)::int>14 OR (substr(offset_value,2,2)::int=14 AND substr(offset_value,4,2)::int<>0) THEN RETURN NULL;END IF;
 local_value:=make_timestamp(substr(value,1,4)::int,substr(value,5,2)::int,substr(value,7,2)::int,substr(value,9,2)::int,substr(value,11,2)::int,0);
 offset_minutes:=(substr(offset_value,2,2)::int*60+substr(offset_value,4,2)::int)*CASE left(offset_value,1) WHEN '-' THEN -1 ELSE 1 END;
 RETURN (local_value-make_interval(mins=>offset_minutes)) AT TIME ZONE 'UTC';
EXCEPTION WHEN OTHERS THEN RETURN NULL;END $$;
CREATE FUNCTION gridex_utilts_binding.require_current_esco_storage_v1(c uuid,env text,sourceid uuid,transactions jsonb) RETURNS void
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
  candidates:=ARRAY[]::uuid[];
  FOR candidate IN SELECT x.id FROM public.ediel_data_access_grants x JOIN public.ediel_service_assignments y ON y.company_id=x.company_id AND y.id=x.assignment_id
   WHERE x.company_id=c AND x.status='active' AND x.revoked_at IS NULL AND x.valid_from<=now() AND (x.valid_to IS NULL OR now()<x.valid_to)
   AND y.provider_actor_id::text=ctx->>'legalActorId' AND y.actor_profile_id::text=ctx#>>'{facts,profile,id}' AND y.environment=env
   AND point=ANY(x.object_ids) AND product=ANY(x.product_ids) AND v_period_start>=x.data_start AND (x.data_end IS NULL OR v_period_end<=x.data_end) ORDER BY x.id LOOP
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
   IF (SELECT count(*) FROM public.metering_permission_sites x WHERE x.company_id=c AND x.metering_permission_id=p.id AND x.customer_id=a.customer_id AND x.facility_id=point AND x.status IN('approved','active')
    AND x.metadata->>'source'='inbound_prodat_z14' AND x.metadata->>'edielMessageId'=coalesce(p.inbound_z14_message_id,p.source_z14_message_id)::text AND x.metadata->>'mode'=CASE a.mode WHEN 'V' THEN 'S17' ELSE 'S18' END AND x.metadata->>'product'=product AND x.start_at IS NOT NULL AND v_period_start>=x.start_at AND (x.end_at IS NULL OR v_period_end<=x.end_at))<>1 THEN CONTINUE;END IF;
   candidates:=array_append(candidates,candidate);
  END LOOP;
  IF cardinality(candidates)<>1 THEN RAISE EXCEPTION 'utilts_esco_unique_current_grant_required' USING ERRCODE='42501';END IF;
 END LOOP;
EXCEPTION WHEN no_data_found OR too_many_rows THEN RAISE EXCEPTION 'utilts_esco_physical_scope_unqualified' USING ERRCODE='42501';END $$;
REVOKE ALL ON FUNCTION gridex_utilts_binding.lock_storage_graph_v1(),gridex_utilts_binding.esco_local_time_v1(text,text),gridex_utilts_binding.require_current_esco_storage_v1(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Fresh source-derived metadata must not rewrite an authentic committed
-- logical series. Retain only on exact full original private comparison.
CREATE FUNCTION gridex_utilts_binding.preserve_committed_projection_v1(c uuid,env text,sid uuid,transactions jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE s public.ediel_messages%rowtype;item jsonb;old_item jsonb;adapted jsonb;answer jsonb:='[]';r gridex_utilts_binding.receipts%rowtype;v public.meter_reading_series%rowtype;
BEGIN
 SELECT * INTO STRICT s FROM public.ediel_messages WHERE company_id=c AND id=sid AND environment=env;
 SELECT * INTO r FROM gridex_utilts_binding.receipts WHERE source_message_id=sid AND company_id=c AND environment=env;
 IF r.source_message_id IS NULL OR r.raw_hash IS DISTINCT FROM encode(sha256(convert_to(s.raw_payload,'UTF8')),'hex') OR r.source_context IS DISTINCT FROM gridex_utilts_binding.source_context_v1(s) THEN RETURN transactions;END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(transactions) LOOP
  SELECT series.* INTO v FROM public.ediel_ack_transaction_results a JOIN public.meter_reading_series series ON series.id=a.persisted_series_id AND series.company_id=a.company_id
   WHERE a.company_id=c AND a.environment=env AND a.source_message_id=sid AND a.source_transaction_id=item->>'transactionId'
    AND a.disposition='accepted' AND a.persistence_status='persisted' AND a.planned_response_type='positive_aperak' FOR SHARE OF a,series;
  IF FOUND AND v.immutable_hash=encode(sha256(convert_to(v.raw_transaction::text,'UTF8')),'hex') THEN
   old_item:=v.raw_transaction;
   -- Only the newly introduced metadata fields differ. V1's existing numeric
   -- comparison remains the immutable private owner's exact original shape.
   adapted:=(item-'productId')||jsonb_build_object('periodStart',item#>'{consumptionContract,interpretation,localPeriodStart}','periodEnd',item#>'{consumptionContract,interpretation,localPeriodEnd}');
   IF r.contract_version=1 THEN adapted:=gridex_utilts_binding.legacy_retry_item_v1(adapted);END IF;
   IF adapted IS NOT DISTINCT FROM old_item THEN item:=adapted;END IF;
  END IF;
  answer:=answer||jsonb_build_array(item);
 END LOOP;
 RETURN answer;
END $$;
REVOKE ALL ON FUNCTION gridex_utilts_binding.preserve_committed_projection_v1(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.gridex_persist_utilts_consumption_v1(p_company_id uuid,p_environment text,p_source_message_id uuid,p_message_code text,p_raw_payload text,p_transactions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.ediel_messages%rowtype;item jsonb;rules jsonb;hash text;committed boolean;mark text;
BEGIN
 IF coalesce(current_setting('role',true),'')<>'service_role' AND current_user<>'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501'; END IF;
 PERFORM gridex_utilts_binding.lock_storage_graph_v1();
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id FOR UPDATE;
 IF source.id IS NULL OR source.company_id IS DISTINCT FROM p_company_id OR source.environment IS DISTINCT FROM p_environment OR source.message_code IS DISTINCT FROM p_message_code
  OR source.direction IS DISTINCT FROM 'inbound' OR source.message_family IS DISTINCT FROM 'UTILTS' OR source.raw_payload IS DISTINCT FROM p_raw_payload OR jsonb_typeof(p_transactions) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'utilts_source_binding_conflict' USING ERRCODE='P0U01'; END IF;
 PERFORM gridex_utilts_binding.require_current_esco_storage_v1(p_company_id,p_environment,p_source_message_id,p_transactions);
 p_transactions:=gridex_utilts_binding.preserve_committed_projection_v1(p_company_id,p_environment,p_source_message_id,p_transactions);
 hash:=encode(sha256(convert_to(source.raw_payload,'UTF8')),'hex');mark:=CASE WHEN left(source.raw_payload,3)='UNA' THEN substring(source.raw_payload,6,1) ELSE '.' END;
 FOR item IN SELECT value FROM jsonb_array_elements(p_transactions) LOOP
  SELECT EXISTS(SELECT FROM gridex_utilts_binding.receipts r JOIN public.ediel_ack_transaction_results a ON a.source_message_id=r.source_message_id
   WHERE r.source_message_id=source.id AND r.company_id=p_company_id AND r.environment=p_environment AND r.raw_hash=hash
    AND a.company_id=p_company_id AND a.environment=p_environment AND a.source_transaction_id=item->>'transactionId'
    AND a.disposition IS NOT DISTINCT FROM item->>'disposition' AND a.planned_response_type IS NOT DISTINCT FROM item->>'responseType'
    AND ((a.disposition='accepted' AND a.persistence_status='persisted' AND a.planned_response_type='positive_aperak') OR (a.disposition<>'accepted' AND a.finalized_at IS NOT NULL))) INTO committed;
  -- Authentic committed V1/V2 replay is validated by the retained owner below;
  -- these new rules cannot rewrite a prior final ACK/contract interpretation.
  IF committed THEN CONTINUE; END IF;
  PERFORM gridex_received_sources.require_utilts_transaction_v1(p_company_id,source.id,item->>'transactionId',item->>'disposition',item->>'responseType',item->'issueCodes');
  IF item->>'disposition'<>'accepted' THEN CONTINUE; END IF;
  PERFORM gridex_ediel_inbound_context.require_v1(p_company_id,source.id);
  PERFORM gridex_ediel_source_rules.require_v1(p_company_id,source.id);
  rules:=gridex_utilts_binding.decimal_rules_v1(gridex_utilts_binding.wire_tokens_v1(source.raw_payload),item->>'transactionId',mark);
  IF rules IS NULL OR jsonb_array_length(rules->'guide')<>0 OR jsonb_array_length(rules->'functional')<>0 THEN RAISE EXCEPTION 'utilts_source_decimal_or_unit_rules_failed' USING ERRCODE='P0U01'; END IF;
 END LOOP;
 RETURN gridex_utilts_binding.persist_consumption_before_precision_v1(p_company_id,p_environment,p_source_message_id,p_message_code,p_raw_payload,p_transactions);
END $$;
REVOKE ALL ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.gridex_persist_utilts_consumption_v1(uuid,text,uuid,text,text,jsonb) TO service_role;
-- SEND requalifies the sealed current service authority only for an actual
-- own ACK. Projection calls the source-only NULL-ACK port: no recursion.
CREATE OR REPLACE FUNCTION public.gridex_require_utilts_positive_ack_authority_v1(
 p_company_id uuid, p_environment text, p_source_message_id uuid,
 p_transaction_id text, p_ack_message_id uuid DEFAULT NULL, p_ack_raw_payload text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,extensions SET timezone='UTC' AS $$
DECLARE
 source public.ediel_messages%rowtype; ack public.ediel_messages%rowtype;
 receipt gridex_utilts_binding.receipts%rowtype; origin gridex_utilts_binding.receipts%rowtype;
 reservation public.ediel_ack_transaction_results%rowtype;
 series public.meter_reading_series%rowtype; stored gridex_utilts_binding.contracts%rowtype;
 tokens jsonb; ack_tokens jsonb; source_hash text; ack_hash text; document_id text;
BEGIN
 IF p_company_id IS NULL OR p_environment NOT IN ('test','production') OR p_source_message_id IS NULL
 OR nullif(p_transaction_id,'') IS NULL OR (p_ack_message_id IS NULL)<>(p_ack_raw_payload IS NULL) THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01';
 END IF;
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 SELECT * INTO source FROM public.ediel_messages WHERE id=p_source_message_id AND company_id=p_company_id AND environment=p_environment FOR SHARE;
 IF NOT FOUND OR source.direction<>'inbound' OR source.message_family<>'UTILTS' OR source.raw_payload IS NULL THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 source_hash:=encode(digest(convert_to(source.raw_payload,'UTF8'),'sha256'),'hex');
 SELECT * INTO receipt FROM gridex_utilts_binding.receipts WHERE source_message_id=source.id;
 IF NOT FOUND OR receipt.company_id IS DISTINCT FROM p_company_id OR receipt.environment IS DISTINCT FROM p_environment
 OR receipt.raw_hash IS DISTINCT FROM source_hash OR receipt.source_context IS DISTINCT FROM gridex_utilts_binding.source_context_v1(source)
 OR NOT receipt.membership ? p_transaction_id THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(source.raw_payload);
 IF tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(tokens) t
  WHERE t->>'tag'='IDE' AND t#>>'{elements,1,0}'='24' AND t#>>'{elements,2,0}'=p_transaction_id)<>1 THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT * INTO reservation FROM public.ediel_ack_transaction_results WHERE company_id=p_company_id AND environment=p_environment
  AND source_message_id=source.id AND source_transaction_id=p_transaction_id FOR SHARE;
 IF NOT FOUND OR reservation.disposition IS DISTINCT FROM 'accepted' OR reservation.planned_response_type IS DISTINCT FROM 'positive_aperak'
 OR reservation.persistence_status IS DISTINCT FROM 'persisted' OR reservation.persisted_series_id IS NULL
 OR (reservation.final_response_type IS NOT NULL AND reservation.final_response_type<>'positive_aperak') THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 SELECT * INTO series FROM public.meter_reading_series WHERE id=reservation.persisted_series_id AND company_id=p_company_id FOR SHARE;
 IF NOT FOUND OR series.message_code IS DISTINCT FROM source.message_code OR series.source_transaction_reference IS DISTINCT FROM p_transaction_id
 OR jsonb_typeof(series.raw_transaction) IS DISTINCT FROM 'object'
 OR series.immutable_hash IS DISTINCT FROM encode(digest(convert_to(series.raw_transaction::text,'UTF8'),'sha256'),'hex') THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 -- Identical old/late accepted data can legitimately reuse an earlier series.
 -- Its genuine source/contract origin stays authoritative; is_current is not an
 -- acceptance criterion and must not silently reject old-late-positive ACKs.
 SELECT * INTO origin FROM gridex_utilts_binding.receipts WHERE source_message_id=series.source_ediel_message_id;
 SELECT * INTO stored FROM gridex_utilts_binding.contracts WHERE series_id=series.id;
 IF origin.source_message_id IS NULL OR stored.series_id IS NULL OR origin.company_id IS DISTINCT FROM p_company_id
 OR origin.environment IS DISTINCT FROM p_environment OR origin.message_code IS DISTINCT FROM source.message_code
 OR stored.company_id IS DISTINCT FROM p_company_id OR stored.environment IS DISTINCT FROM p_environment
 OR stored.source_message_id IS DISTINCT FROM origin.source_message_id OR stored.transaction_id IS DISTINCT FROM p_transaction_id
 OR stored.contract_version NOT IN (1,2) OR stored.contract->>'version' IS DISTINCT FROM stored.contract_version::text
 OR NOT coalesce(gridex_utilts_binding.validate_contract_v1(stored.contract),false)
 OR stored.contract_hash IS DISTINCT FROM encode(digest(convert_to(stored.contract::text,'UTF8'),'sha256'),'hex')
 OR stored.contract IS DISTINCT FROM series.raw_transaction->'consumptionContract' THEN
  RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
 IF p_ack_message_id IS NOT NULL THEN
  SELECT * INTO ack FROM public.ediel_messages WHERE id=p_ack_message_id AND company_id=p_company_id AND environment=p_environment FOR SHARE;
  IF NOT FOUND OR ack.direction<>'outbound' OR ack.message_family<>'APERAK' OR ack.related_message_id IS DISTINCT FROM source.id
  OR ack.raw_payload IS DISTINCT FROM p_ack_raw_payload OR reservation.final_response_type IS DISTINCT FROM 'positive_aperak'
  OR reservation.response_message_id IS DISTINCT FROM ack.id OR reservation.finalized_at IS NULL THEN
   RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
  ack_tokens:=gridex_utilts_binding.wire_tokens_v1(ack.raw_payload);
  SELECT t#>>'{elements,2,0}' INTO document_id FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='BGM';
  IF ack_tokens IS NULL OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='UNH'
    AND t#>>'{elements,2,0}'='APERAK' AND t#>>'{elements,2,2}'='04A' AND t#>>'{elements,2,4}'='E5SE5A')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='312')<>1
   OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW' AND t#>>'{elements,1,1}'=p_transaction_id)<>1
   OR NOT EXISTS(SELECT FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW' AND t#>>'{elements,1,1}'=p_transaction_id)
   OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='DM')
      <>(SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='ACW')
   OR EXISTS(SELECT FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='DM'
       AND (nullif(t#>>'{elements,1,1}','') IS NULL OR length(t#>>'{elements,1,1}')>35 OR btrim(t#>>'{elements,1,1}') IS DISTINCT FROM t#>>'{elements,1,1}'))
   OR EXISTS(SELECT t#>>'{elements,1,1}' FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='DM'
       GROUP BY t#>>'{elements,1,1}' HAVING count(*)>1)
   OR (SELECT count(*) FROM jsonb_array_elements(ack_tokens) t WHERE t->>'tag'='DOC' AND t#>>'{elements,2,0}'=document_id)<>1 THEN
   RAISE EXCEPTION 'utilts_positive_ack_storage_unavailable' USING ERRCODE='P0U01'; END IF;
  ack_hash:=encode(digest(convert_to(ack.raw_payload,'UTF8'),'sha256'),'hex');
 END IF;
 IF p_ack_message_id IS NOT NULL AND EXISTS(SELECT FROM gridex_ediel_inbound_context.receipts x WHERE x.company_id=p_company_id AND x.source_message_id=source.id AND x.environment=p_environment AND x.status='ready' AND x.context->>'actorRole' IN('energy_service_company','esco')) THEN
  PERFORM gridex_ediel_ack_replay.require_positive_service_scope_v1(p_company_id,p_environment,source.id,ack.raw_payload);
 END IF;
 RETURN jsonb_build_object('authorityVersion',1,'companyId',p_company_id,'environment',p_environment,'sourceMessageId',source.id,
  'transactionId',p_transaction_id,'sourceRawHash',source_hash,'ackMessageId',p_ack_message_id,'ackRawHash',ack_hash);
END $$;
COMMIT;
