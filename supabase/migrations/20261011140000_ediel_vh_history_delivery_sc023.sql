-- SC-023 Plan B. Manually scaffolded host fallback; NOT CLI-generated.
BEGIN;
CREATE SCHEMA gridex_vh_history;
REVOKE ALL ON SCHEMA gridex_vh_history FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE gridex_vh_history.deliveries (
 company_id uuid NOT NULL REFERENCES public.companies(id),permission_id uuid NOT NULL REFERENCES public.metering_permissions(id),
 environment text NOT NULL CHECK(environment IN('test','production')),customer_id uuid NOT NULL,
 opening_source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),original_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),
 opening_payload_hash text NOT NULL CHECK(opening_payload_hash ~ '^[0-9a-f]{64}$'),original_payload_hash text NOT NULL CHECK(original_payload_hash ~ '^[0-9a-f]{64}$'),
 legal_esco_id text NOT NULL,legal_dso_id text NOT NULL,
 state text NOT NULL DEFAULT 'approved_or_receiving' CHECK(state IN('approved_or_receiving','historical_delivery_closed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(company_id,permission_id));
CREATE TABLE gridex_vh_history.objects (
 company_id uuid NOT NULL,permission_id uuid NOT NULL,site_id uuid NOT NULL,point text NOT NULL,product text NOT NULL,permission_reference text NOT NULL,
 period_start timestamptz NOT NULL,period_end timestamptz NOT NULL CHECK(period_end>period_start),approved_site jsonb NOT NULL,authorization_basis jsonb NOT NULL,
 basis_hash text NOT NULL CHECK(basis_hash ~ '^[0-9a-f]{64}$'),PRIMARY KEY(company_id,permission_id,site_id),UNIQUE(company_id,permission_id,point),
 FOREIGN KEY(company_id,permission_id) REFERENCES gridex_vh_history.deliveries(company_id,permission_id));
CREATE TABLE gridex_vh_history.closures (
 company_id uuid NOT NULL,permission_id uuid NOT NULL,site_id uuid NOT NULL,source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),source_payload_hash text NOT NULL,
 canonical_assessment_id uuid NOT NULL REFERENCES gridex_received_sources.validation_assessments(id),object_scopes jsonb NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),
 coverage_status text NOT NULL CHECK(coverage_status IN('complete','gaps','held')),review jsonb NOT NULL,review_hash text NOT NULL CHECK(review_hash ~ '^[0-9a-f]{64}$'),reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(company_id,permission_id,site_id,source_message_id),FOREIGN KEY(company_id,permission_id,site_id) REFERENCES gridex_vh_history.objects(company_id,permission_id,site_id));
CREATE TABLE gridex_vh_history.restorations (
 company_id uuid NOT NULL,permission_id uuid NOT NULL,site_id uuid NOT NULL,closure_source_message_id uuid NOT NULL,
 source_message_id uuid NOT NULL REFERENCES public.ediel_messages(id),source_payload_hash text NOT NULL,actor_user_id uuid NOT NULL REFERENCES auth.users(id),restored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(company_id,permission_id,site_id,closure_source_message_id),
 FOREIGN KEY(company_id,permission_id,site_id,closure_source_message_id) REFERENCES gridex_vh_history.closures(company_id,permission_id,site_id,source_message_id));
-- Typed VH state confers no generic supplier/outbox send/retry/cancel authority.
CREATE TABLE gridex_vh_history.requests (
 company_id uuid NOT NULL,permission_id uuid NOT NULL,site_id uuid NOT NULL,request_id uuid NOT NULL REFERENCES public.grid_owner_data_requests(id),
 message_id uuid NOT NULL REFERENCES public.ediel_messages(id),transaction_id text NOT NULL,source_payload_hash text NOT NULL,binding jsonb NOT NULL,binding_hash text NOT NULL CHECK(binding_hash ~ '^[0-9a-f]{64}$'),
 state text NOT NULL DEFAULT 'awaiting' CHECK(state IN('awaiting','completed','manual_review')),closed_by_message_id uuid REFERENCES public.ediel_messages(id),
 PRIMARY KEY(company_id,request_id),UNIQUE(company_id,message_id,transaction_id),FOREIGN KEY(company_id,permission_id,site_id) REFERENCES gridex_vh_history.objects(company_id,permission_id,site_id));
DO $rls$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['deliveries','objects','closures','restorations','requests'] LOOP
  EXECUTE format('ALTER TABLE gridex_vh_history.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_vh_history.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON gridex_vh_history.%I FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['objects','closures','restorations'] LOOP
  EXECUTE format('CREATE TRIGGER vh_history_immutable BEFORE UPDATE OR DELETE ON gridex_vh_history.%I FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
  EXECUTE format('CREATE TRIGGER vh_history_no_truncate BEFORE TRUNCATE ON gridex_vh_history.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation()',t);
 END LOOP;
END $rls$;
CREATE FUNCTION gridex_vh_history.authorize_v1(c uuid,a uuid,permission text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 PERFORM p.id FROM public.user_profiles p WHERE p.id=a FOR SHARE;
 PERFORM m.user_id FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=a FOR SHARE;
 IF a IS NULL OR (permission IN('metering.read','metering.write','communication.write')) IS NOT TRUE OR public.gridex_actor_has_company_permission(a,c,permission) IS NOT TRUE OR NOT EXISTS(SELECT FROM public.user_profiles p WHERE p.id=a AND p.user_status='active') OR NOT EXISTS(SELECT FROM public.company_memberships m WHERE m.company_id=c AND m.user_id=a AND m.status='active' AND m.is_active AND m.accepted_at IS NOT NULL) THEN RAISE EXCEPTION 'vh_history_actor_unqualified' USING ERRCODE='42501';END IF;
END$$;
CREATE FUNCTION gridex_vh_history.require_actor_v1(c uuid,a uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT gridex_vh_history.authorize_v1(c,a,'metering.write')$$;
CREATE FUNCTION gridex_vh_history.open_v1(c uuid,pid uuid,zid uuid,actor uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE p public.metering_permissions%rowtype;m public.ediel_messages%rowtype;original public.ediel_messages%rowtype;tr gridex_received_sources.permission_effect_transitions_v1%rowtype;site jsonb;wire jsonb;basis jsonb;qualified jsonb;existing gridex_vh_history.deliveries%rowtype;
BEGIN
 PERFORM gridex_vh_history.require_actor_v1(c,actor);
 SELECT * INTO STRICT p FROM public.metering_permissions WHERE company_id=c AND id=pid FOR UPDATE;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=c AND id=zid AND direction='inbound' AND message_family='PRODAT' AND message_code='Z14';
 SELECT * INTO tr FROM gridex_received_sources.permission_effect_transitions_v1 WHERE company_id=c AND permission_id=pid AND source_message_id=zid AND qualified_expected_message_code='Z14';
 IF tr.source_message_id IS NULL OR tr.payload_hash IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'vh_history_approved_effect_required';END IF;
 SELECT * INTO STRICT original FROM public.ediel_messages WHERE company_id=c AND id=coalesce(p.source_z13_message_id,p.outbound_z13_message_id) AND environment=m.environment;
 wire:=gridex_received_sources.permission_partition_wire_v1(m.raw_payload);
 IF original.direction IS DISTINCT FROM 'outbound' OR original.message_code IS DISTINCT FROM 'Z13' OR original.immutable_payload_hash IS DISTINCT FROM encode(sha256(convert_to(original.raw_payload,'UTF8')),'hex') OR gridex_received_sources.sent_source_is_current_v1(original) IS NOT TRUE OR tr.resulting_state#>>'{metadata,marketPermission,mode}' IS DISTINCT FROM 'S18' OR tr.resulting_state->>'customer_id' IS DISTINCT FROM p.customer_id::text OR tr.qualified_original_message_id IS DISTINCT FROM original.id THEN RAISE EXCEPTION 'vh_history_original_scope_required';END IF;
 SELECT * INTO existing FROM gridex_vh_history.deliveries WHERE company_id=c AND permission_id=pid;
 IF FOUND THEN IF existing.opening_source_message_id<>zid OR existing.opening_payload_hash<>tr.payload_hash OR existing.original_payload_hash<>original.immutable_payload_hash THEN RAISE EXCEPTION 'vh_history_open_replay_conflict';END IF;RETURN;END IF;
 -- The source writer's metering.write authority is independent of the
 -- historical original reader's extra read permission. Missing READ/account
 -- prerequisites retain an explicit held basis; they never grant new access.
 -- Any real reader/source error after these exact prerequisites still fails.
 IF (current_setting('role',true)='service_role' OR session_user='service_role')
  AND EXISTS(SELECT FROM public.companies x WHERE x.id=c AND x.status='active')
  AND EXISTS(SELECT FROM auth.users u WHERE u.id=actor AND u.deleted_at IS NULL AND(u.banned_until IS NULL OR u.banned_until<=clock_timestamp()))
  AND(coalesce(public.gridex_actor_has_company_permission(actor,c,'ediel.read'),false) OR coalesce(public.gridex_actor_has_company_permission(actor,c,'communication.read'),false))
 THEN basis:=gridex_received_sources.received_z14_reporting_source_basis_v1(zid,actor);
 ELSE basis:=NULL;END IF;
 INSERT INTO gridex_vh_history.deliveries(company_id,permission_id,environment,customer_id,opening_source_message_id,original_message_id,opening_payload_hash,original_payload_hash,legal_esco_id,legal_dso_id) VALUES(c,pid,m.environment,p.customer_id,zid,original.id,tr.payload_hash,original.immutable_payload_hash,wire->>'receiver',wire->>'sender');
 FOR site IN SELECT value FROM jsonb_array_elements(tr.resulting_sites) WHERE value->>'company_id'=c::text AND value->>'metering_permission_id'=pid::text AND value#>>'{metadata,mode}'='S18' AND value#>>'{metadata,edielMessageId}'=zid::text AND value->>'status' IN('approved','active') LOOP
  IF site->>'start_at' IS NULL OR site->>'end_at' IS NULL OR (site->>'end_at')::timestamptz<=(site->>'start_at')::timestamptz OR nullif(site#>>'{metadata,product}','') IS NULL THEN RAISE EXCEPTION 'vh_history_finite_approved_window_required';END IF;
  SELECT x INTO qualified FROM jsonb_array_elements(coalesce(basis->'objects','[]'))x WHERE x#>>'{scope,objectId}'=site->>'facility_id' AND x#>>'{original,permissionId}'=pid::text;
  qualified:=coalesce(qualified,jsonb_build_object('status','held','reason','vh_history_reviewed_original_unavailable'));
  INSERT INTO gridex_vh_history.objects(company_id,permission_id,site_id,point,product,permission_reference,period_start,period_end,approved_site,authorization_basis,basis_hash) VALUES(c,pid,(site->>'id')::uuid,site->>'facility_id',site#>>'{metadata,product}',site#>>'{metadata,permissionId}',(site->>'start_at')::timestamptz,(site->>'end_at')::timestamptz,site,qualified,encode(sha256(convert_to(jsonb_build_array(site,qualified)::text,'UTF8')),'hex'));
 END LOOP;
 IF NOT EXISTS(SELECT FROM gridex_vh_history.objects WHERE company_id=c AND permission_id=pid) THEN RAISE EXCEPTION 'vh_history_approved_objects_required';END IF;
END$$;
CREATE FUNCTION gridex_vh_history.coverage_v1(c uuid,pid uuid,sid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE h gridex_vh_history.objects%rowtype;job gridex_vh_history.deliveries%rowtype;series public.meter_reading_series%rowtype;m public.ediel_messages%rowtype;stored gridex_utilts_binding.contracts%rowtype;r gridex_ediel_ack_replay.positive_service_scope_receipts%rowtype;receipt_source public.ediel_messages%rowtype;request_record gridex_vh_history.requests%rowtype;
 contract jsonb;tx jsonb;proof jsonb;o jsonb;intervals jsonb:='[]';gaps jsonb:='[]';sources jsonb:='[]';held boolean:=false;authorized boolean;starts timestamptz;ends timestamptz;cursor_at timestamptz;
BEGIN
 SELECT * INTO STRICT h FROM gridex_vh_history.objects WHERE company_id=c AND permission_id=pid AND site_id=sid;
 SELECT * INTO STRICT job FROM gridex_vh_history.deliveries WHERE company_id=c AND permission_id=pid;
 IF h.basis_hash<>encode(sha256(convert_to(jsonb_build_array(h.approved_site,h.authorization_basis)::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'vh_history_approved_basis_conflict';END IF;
 IF h.authorization_basis#>>'{original,assignmentId}' IS NULL THEN held:=true;gaps:=gaps||jsonb_build_array(jsonb_build_object('reason','historical_authorization_unavailable'));END IF;
 -- Private historical AUDIT only: no current beneficiary projection/ACL change.
 FOR series IN SELECT s.* FROM public.meter_reading_series s WHERE s.company_id=c AND s.external_metering_point_id=h.point AND s.product_id=h.product AND s.message_code='E66' AND s.series_kind='actual' AND s.is_current AND s.period_start<h.period_end AND s.period_end>h.period_start ORDER BY s.period_start,s.id FOR SHARE LOOP
  BEGIN
   SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=c AND id=series.source_ediel_message_id AND environment=job.environment AND direction='inbound' AND message_family='UTILTS' AND message_code='E66';
   SELECT * INTO STRICT stored FROM gridex_utilts_binding.contracts WHERE company_id=c AND series_id=series.id AND environment=job.environment;
   contract:=gridex_utilts_binding.stored_contract_v1(c,m.id,stored.transaction_id);
   IF contract IS DISTINCT FROM stored.contract OR contract->>'seriesKind' IS DISTINCT FROM 'actual' OR contract->>'messageCode' IS DISTINCT FROM 'E66' THEN RAISE EXCEPTION 'vh_history_contract_scope_conflict';END IF;
   authorized:=false;
   FOR r IN SELECT * FROM gridex_ediel_ack_replay.positive_service_scope_receipts WHERE company_id=c AND environment=job.environment ORDER BY recorded_at,source_message_id LOOP
    SELECT * INTO receipt_source FROM public.ediel_messages WHERE company_id=c AND id=r.source_message_id AND environment=job.environment;
    IF receipt_source.id IS NULL OR r.projection->>'companyId' IS DISTINCT FROM c::text OR r.projection->>'environment' IS DISTINCT FROM job.environment OR r.projection->>'sourceMessageId' IS DISTINCT FROM r.source_message_id::text OR r.projection->>'sourceRawHash' IS DISTINCT FROM encode(sha256(convert_to(receipt_source.raw_payload,'UTF8')),'hex') OR r.projection->>'ackRawHash' IS DISTINCT FROM r.ack_raw_hash THEN CONTINUE;END IF;
    FOR tx IN SELECT value FROM jsonb_array_elements(coalesce(r.projection->'transactions','[]')) LOOP
     IF tx->>'transactionId' IS DISTINCT FROM stored.transaction_id OR tx->>'seriesId' IS DISTINCT FROM series.id::text OR tx->>'originMessageId' IS DISTINCT FROM m.id::text OR tx->>'originRawHash' IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') OR tx->>'contractHash' IS DISTINCT FROM stored.contract_hash OR tx#>>'{originContext,legalEdielId}' IS DISTINCT FROM job.legal_esco_id OR (tx#>>'{originContext,actorRole}' IN('energy_service_company','esco')) IS NOT TRUE THEN CONTINUE;END IF;
     FOR proof IN SELECT value FROM jsonb_array_elements(CASE WHEN r.projection->>'version'='1' THEN jsonb_build_array(tx) WHEN r.projection->>'version'='2' THEN coalesce(tx->'scopes','[]') ELSE '[]' END) LOOP
      IF proof#>>'{assignment,mode}'='VH' AND proof#>>'{assignment,id}'=h.authorization_basis#>>'{original,assignmentId}' AND proof#>>'{assignment,company_id}'=c::text AND proof#>>'{assignment,customer_id}'=job.customer_id::text AND proof#>>'{assignment,environment}'=job.environment
       AND proof#>>'{permissionLink,permission_id}'=pid::text AND proof#>>'{permissionLink,company_id}'=c::text AND proof#>>'{permission,id}'=pid::text AND proof#>>'{permission,company_id}'=c::text
       AND coalesce(proof#>>'{permission,inbound_z14_message_id}',proof#>>'{permission,source_z14_message_id}')=job.opening_source_message_id::text
       AND proof#>>'{site,id}'=sid::text AND proof#>>'{site,company_id}'=c::text AND proof#>>'{site,metering_permission_id}'=pid::text AND proof#>>'{site,facility_id}'=h.point AND proof#>>'{site,metadata,mode}'='S18' AND proof#>>'{site,metadata,permissionId}'=h.permission_reference AND proof#>>'{site,metadata,product}'=h.product
       AND (proof#>>'{site,start_at}')::timestamptz=h.period_start AND (proof#>>'{site,end_at}')::timestamptz=h.period_end THEN authorized:=true;END IF;
     END LOOP;
    END LOOP;
   END LOOP;
   IF NOT authorized THEN held:=true;gaps:=gaps||jsonb_build_array(jsonb_build_object('reason','historical_vh_scope_unavailable','seriesId',series.id));CONTINUE;END IF;
   FOR o IN SELECT value FROM jsonb_array_elements(contract->'observations') LOOP
    starts:=(o->>'periodStart')::timestamptz;ends:=(o->>'periodEnd')::timestamptz;
    IF o->>'externalPoint' IS DISTINCT FROM h.point OR o->>'productCode' IS DISTINCT FROM h.product OR (o->>'resolution' IN('PT15M','PT30M','PT60M','PT1H')) IS NOT TRUE OR o->>'quantity' IS NULL OR o->>'quality'='46' OR starts<h.period_start OR ends>h.period_end OR ends<=starts OR ends-starts IS DISTINCT FROM (CASE o->>'resolution' WHEN 'PT15M' THEN interval '15 minutes' WHEN 'PT30M' THEN interval '30 minutes' WHEN 'PT60M' THEN interval '1 hour' WHEN 'PT1H' THEN interval '1 hour' END) THEN gaps:=gaps||jsonb_build_array(jsonb_build_object('reason','unsupported_or_missing_observation','seriesId',series.id,'ordinal',o->'ordinal'));CONTINUE;END IF;
    intervals:=intervals||jsonb_build_array(jsonb_build_object('start',starts,'end',ends,'seriesId',series.id,'ordinal',o->'ordinal'));
   END LOOP;
   sources:=sources||jsonb_build_array(jsonb_build_object('seriesId',series.id,'sourceMessageId',m.id,'transactionId',stored.transaction_id,'contractVersion',stored.contract_version,'rawHash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),'seriesHash',series.immutable_hash,'contractHash',stored.contract_hash));
  EXCEPTION WHEN SQLSTATE 'P0U01' OR invalid_text_representation OR no_data_found THEN held:=true;gaps:=gaps||jsonb_build_array(jsonb_build_object('reason','stored_e66_provenance_unavailable','seriesId',series.id));END;
 END LOOP;
 cursor_at:=h.period_start;
 FOR o IN SELECT value FROM jsonb_array_elements(intervals) ORDER BY(value->>'start')::timestamptz,(value->>'end')::timestamptz LOOP
  starts:=(o->>'start')::timestamptz;ends:=(o->>'end')::timestamptz;
  IF starts<cursor_at THEN held:=true;gaps:=gaps||jsonb_build_array(jsonb_build_object('reason','overlapping_observations','start',starts,'end',ends));ELSIF starts>cursor_at THEN gaps:=gaps||jsonb_build_array(jsonb_build_object('reason','missing_values','start',cursor_at,'end',starts));END IF;
  cursor_at:=greatest(cursor_at,ends);
 END LOOP;
 IF cursor_at<h.period_end THEN gaps:=gaps||jsonb_build_array(jsonb_build_object('reason','missing_values','start',cursor_at,'end',h.period_end));END IF;
 FOR request_record IN SELECT * FROM gridex_vh_history.requests WHERE company_id=c AND permission_id=pid AND site_id=sid AND state='awaiting' ORDER BY request_id FOR UPDATE LOOP
  IF request_record.binding IS DISTINCT FROM gridex_vh_history.request_binding_v1(c,pid,sid,request_record.request_id,request_record.message_id,request_record.transaction_id) OR request_record.binding_hash IS DISTINCT FROM encode(sha256(convert_to(request_record.binding::text,'UTF8')),'hex') THEN RAISE EXCEPTION 'vh_history_request_replay_conflict';END IF;
  gaps:=gaps||jsonb_build_array(jsonb_build_object('reason','pending_e73_manual_review','requestId',request_record.request_id,'messageId',request_record.message_id));
 END LOOP;
 RETURN jsonb_build_object('approvedStart',h.period_start,'approvedEnd',h.period_end,'approvedBasisHash',h.basis_hash,'intervals',intervals,'sources',sources,'gaps',gaps,'status',CASE WHEN held THEN 'held' WHEN jsonb_array_length(gaps)>0 THEN 'gaps' ELSE 'complete' END,'dataAccessGranted',false);
END$$;
CREATE FUNCTION gridex_received_sources.close_vh_history_delivery_v1(c uuid,pid uuid,zid uuid,actor uuid,wire jsonb,canonical uuid,scopes jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE job gridex_vh_history.deliveries%rowtype;h gridex_vh_history.objects%rowtype;m public.ediel_messages%rowtype;o jsonb;review jsonb;
BEGIN
 PERFORM gridex_vh_history.require_actor_v1(c,actor);
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=c AND id=zid AND direction='inbound' AND message_family='PRODAT' AND message_code='Z15';
 PERFORM gridex_vh_history.open_v1(c,pid,(SELECT coalesce(inbound_z14_message_id,source_z14_message_id) FROM public.metering_permissions WHERE company_id=c AND id=pid),actor);
 SELECT * INTO STRICT job FROM gridex_vh_history.deliveries WHERE company_id=c AND permission_id=pid FOR UPDATE;
 IF m.environment IS DISTINCT FROM job.environment OR wire->>'sender' IS DISTINCT FROM job.legal_dso_id OR wire->>'receiver' IS DISTINCT FROM job.legal_esco_id THEN RAISE EXCEPTION 'vh_history_close_source_conflict';END IF;
 -- Existing writer qualifies every object before this hook and holds locks.
 FOR o IN SELECT value FROM jsonb_array_elements(wire->'objects') LOOP
  SELECT * INTO h FROM gridex_vh_history.objects WHERE company_id=c AND permission_id=pid AND point=o->>'point' AND permission_reference=o->>'permissionId' FOR UPDATE;
  IF h.site_id IS NULL OR o->>'reason' IS DISTINCT FROM 'S18' THEN RAISE EXCEPTION 'vh_history_close_object_conflict';END IF;
  IF EXISTS(SELECT FROM gridex_vh_history.closures k WHERE k.company_id=c AND k.permission_id=pid AND k.site_id=h.site_id AND NOT EXISTS(SELECT FROM gridex_vh_history.restorations r WHERE r.company_id=k.company_id AND r.permission_id=k.permission_id AND r.site_id=k.site_id AND r.closure_source_message_id=k.source_message_id)) THEN RAISE EXCEPTION 'vh_history_already_closed_by_other_source';END IF;
 END LOOP;
 FOR h IN SELECT * FROM gridex_vh_history.objects WHERE company_id=c AND permission_id=pid AND point IN(SELECT x->>'point' FROM jsonb_array_elements(wire->'objects')x) ORDER BY site_id LOOP
  review:=gridex_vh_history.coverage_v1(c,pid,h.site_id);
  INSERT INTO gridex_vh_history.closures(company_id,permission_id,site_id,source_message_id,source_payload_hash,canonical_assessment_id,object_scopes,actor_user_id,coverage_status,review,review_hash) VALUES(c,pid,h.site_id,zid,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),canonical,scopes,actor,review->>'status',review,encode(sha256(convert_to(review::text,'UTF8')),'hex'));
  UPDATE gridex_vh_history.requests SET state='manual_review',closed_by_message_id=zid WHERE company_id=c AND permission_id=pid AND site_id=h.site_id AND state='awaiting';
 END LOOP;
 IF NOT EXISTS(SELECT FROM gridex_vh_history.objects x WHERE x.company_id=c AND x.permission_id=pid AND NOT EXISTS(SELECT FROM gridex_vh_history.closures k WHERE k.company_id=x.company_id AND k.permission_id=x.permission_id AND k.site_id=x.site_id AND NOT EXISTS(SELECT FROM gridex_vh_history.restorations r WHERE r.company_id=k.company_id AND r.permission_id=k.permission_id AND r.site_id=k.site_id AND r.closure_source_message_id=k.source_message_id))) THEN UPDATE gridex_vh_history.deliveries SET state='historical_delivery_closed' WHERE company_id=c AND permission_id=pid;END IF;
END$$;
CREATE FUNCTION gridex_vh_history.restore_v1(c uuid,pid uuid,zid uuid,actor uuid,wire jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job gridex_vh_history.deliveries%rowtype;m public.ediel_messages%rowtype;o jsonb;h gridex_vh_history.objects%rowtype;prior gridex_received_sources.permission_effect_transitions_v1%rowtype;
BEGIN
 PERFORM gridex_vh_history.require_actor_v1(c,actor);
 SELECT * INTO job FROM gridex_vh_history.deliveries WHERE company_id=c AND permission_id=pid FOR UPDATE;
 IF NOT FOUND THEN RETURN;END IF; -- No managed job before this forward.
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=c AND id=zid AND environment=job.environment AND direction='inbound' AND message_family='PRODAT' AND message_code='Z15';
 IF wire->>'sender' IS DISTINCT FROM job.legal_dso_id OR wire->>'receiver' IS DISTINCT FROM job.legal_esco_id THEN RAISE EXCEPTION 'vh_history_restore_source_conflict';END IF;
 FOR o IN SELECT value FROM jsonb_array_elements(wire->'objects') LOOP
  SELECT * INTO STRICT h FROM gridex_vh_history.objects WHERE company_id=c AND permission_id=pid AND point=o->>'point' AND permission_reference=o->>'permissionId';
  -- The writer already qualified the current exact S18 source/snapshot and
  -- reversal interval. Retain that same original, never infer by timestamp.
  SELECT t.* INTO prior FROM gridex_received_sources.permission_effect_transitions_v1 t WHERE t.company_id=c AND t.permission_id=pid AND t.source_message_id<>zid AND t.qualified_expected_message_code='Z15' AND EXISTS(SELECT FROM jsonb_array_elements(t.resulting_state#>'{metadata,z15,objects}')x WHERE x->>'point'=o->>'point') ORDER BY(t.resulting_state->>'market_state_version')::bigint DESC LIMIT 1;
  IF o->>'reason' IS DISTINCT FROM 'Z24' OR NOT EXISTS(SELECT FROM gridex_vh_history.closures k WHERE k.company_id=c AND k.permission_id=pid AND k.site_id=h.site_id AND k.source_message_id=prior.source_message_id AND k.source_payload_hash=prior.payload_hash) THEN RAISE EXCEPTION 'vh_history_restoration_original_unavailable';END IF;
  INSERT INTO gridex_vh_history.restorations(company_id,permission_id,site_id,closure_source_message_id,source_message_id,source_payload_hash,actor_user_id) VALUES(c,pid,h.site_id,prior.source_message_id,zid,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),actor);
 END LOOP;
 UPDATE gridex_vh_history.deliveries SET state='approved_or_receiving' WHERE company_id=c AND permission_id=pid;
 -- Historical manual review does not authorize a fresh E73 send or retry.
END$$;
CREATE FUNCTION gridex_vh_history.request_binding_v1(c uuid,pid uuid,sid uuid,qid uuid,msg uuid,tx text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE job gridex_vh_history.deliveries%rowtype;h gridex_vh_history.objects%rowtype;q public.grid_owner_data_requests%rowtype;m public.ediel_messages%rowtype;point public.metering_points%rowtype;tokens jsonb;context jsonb;expected_period text;
BEGIN
 SELECT * INTO STRICT job FROM gridex_vh_history.deliveries WHERE company_id=c AND permission_id=pid;
 SELECT * INTO STRICT h FROM gridex_vh_history.objects WHERE company_id=c AND permission_id=pid AND site_id=sid;
 SELECT * INTO STRICT q FROM public.grid_owner_data_requests WHERE company_id=c AND id=qid FOR SHARE;
 SELECT * INTO STRICT m FROM public.ediel_messages WHERE company_id=c AND id=msg AND environment=job.environment FOR SHARE;
 SELECT * INTO point FROM public.metering_points WHERE company_id=c AND customer_id=job.customer_id AND id=q.metering_point_id FOR SHARE;
 IF point.id IS NULL OR point.normalized_metering_point_id IS DISTINCT FROM h.point OR q.site_id IS NULL OR q.site_id IS DISTINCT FROM coalesce(point.customer_site_id,point.site_id)
  OR NOT EXISTS(SELECT FROM public.customer_sites s WHERE s.company_id=c AND s.customer_id=job.customer_id AND s.id=q.site_id)
  OR(h.approved_site->>'metering_point_id' IS NOT NULL AND h.approved_site->>'metering_point_id' IS DISTINCT FROM point.id::text)
  OR(h.approved_site->>'customer_site_id' IS NOT NULL AND h.approved_site->>'customer_site_id' IS DISTINCT FROM q.site_id::text) THEN RAISE EXCEPTION 'vh_history_request_point_unqualified';END IF;
 IF jsonb_typeof(q.request_payload) IS DISTINCT FROM 'object' OR EXISTS(SELECT FROM jsonb_each(q.request_payload)e WHERE e.key IN('requestedMessageCode','requested_message_code','requestedApplication') AND (jsonb_typeof(e.value) IS DISTINCT FROM 'string' OR upper(btrim(e.value#>>'{}')) IS DISTINCT FROM 'E66')) THEN RAISE EXCEPTION 'vh_history_request_target_unqualified';END IF;
 IF q.customer_id IS DISTINCT FROM job.customer_id OR q.request_scope IS DISTINCT FROM 'meter_values' OR m.customer_id IS DISTINCT FROM job.customer_id OR m.grid_owner_data_request_id IS DISTINCT FROM q.id OR m.original_message_id IS DISTINCT FROM job.opening_source_message_id
  OR m.direction IS DISTINCT FROM 'outbound' OR m.message_family IS DISTINCT FROM 'UTILTS' OR m.message_code IS DISTINCT FROM 'E73' OR (m.application_reference IN('23-DGI-E66-S','23-DGI-E66-T')) IS NOT TRUE OR gridex_received_sources.sent_source_is_current_v1(m) IS NOT TRUE
  OR q.requested_period_start IS DISTINCT FROM(h.period_start AT TIME ZONE interval '+01:00')::date OR q.requested_period_end IS DISTINCT FROM(h.period_end AT TIME ZONE interval '+01:00')::date THEN RAISE EXCEPTION 'vh_history_request_scope_unqualified';END IF;
 PERFORM gridex_ediel_outbound_owner.require_v1(c,m.id);
 context:=gridex_ediel_inbound_context.require_v1(c,m.id);
 IF(context->>'actorRole' IN('energy_service_company','esco')) IS NOT TRUE OR context->>'legalEdielId' IS DISTINCT FROM job.legal_esco_id OR context->>'environment' IS DISTINCT FROM job.environment OR context->>'family' IS DISTINCT FROM 'UTILTS' OR context->>'code' IS DISTINCT FROM 'E73' THEN RAISE EXCEPTION 'vh_history_request_legal_source_unqualified';END IF;
 tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);
 expected_period:=to_char(h.period_start AT TIME ZONE interval '+01:00','YYYYMMDDHH24MI')||to_char(h.period_end AT TIME ZONE interval '+01:00','YYYYMMDDHH24MI');
 IF(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='BGM' AND t#>>'{elements,1,0}'='E73')<>1
  OR(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='IDE')<>1
  OR gridex_utilts_binding.supported_point_v1(tokens,tx) IS DISTINCT FROM h.point
  OR(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='RFF' AND t#>>'{elements,1,0}'='E66')<>1
  OR(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='DTM' AND t#>>'{elements,1,0}'='324')<>1
  OR NOT EXISTS(SELECT FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='DTM' AND t#>'{elements,1}'=jsonb_build_array('324',expected_period,'719'))
  OR(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='MS' AND t#>>'{elements,2,0}'=job.legal_esco_id)<>1
  OR(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'='MR' AND t#>>'{elements,2,0}'=job.legal_dso_id)<>1 THEN RAISE EXCEPTION 'vh_history_request_physical_scope_unqualified';END IF;
 RETURN jsonb_build_object('approvedBasisHash',h.basis_hash,'request',jsonb_build_object('id',q.id,'companyId',q.company_id,'customerId',q.customer_id,'siteId',q.site_id,'meteringPointId',q.metering_point_id,'scope',q.request_scope,'periodStart',q.requested_period_start,'periodEnd',q.requested_period_end,'payload',q.request_payload),'point',jsonb_build_object('id',point.id,'companyId',point.company_id,'customerId',point.customer_id,'customerSiteId',point.customer_site_id,'siteId',point.site_id,'normalizedPoint',point.normalized_metering_point_id),'message',gridex_utilts_binding.source_context_v1(m),'sourceRawHash',m.immutable_payload_hash,'originalContext',context);
END$$;
CREATE FUNCTION public.ediel_link_vh_history_request_v1(p_company_id uuid,p_permission_id uuid,p_site_id uuid,p_request_id uuid,p_message_id uuid,p_transaction_id text,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job gridex_vh_history.deliveries%rowtype;prior gridex_vh_history.requests%rowtype;bound jsonb;h text;
BEGIN
 -- Coordinate original/job row order with the public permission writer before
 -- actor, request or job locks. This supplies no READ/send authority.
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();
 PERFORM gridex_vh_history.authorize_v1(p_company_id,p_actor_user_id,'metering.write');
 PERFORM gridex_vh_history.authorize_v1(p_company_id,p_actor_user_id,'communication.write');
 -- Same lock as closure serializes new links with the final gap snapshot.
 SELECT * INTO STRICT job FROM gridex_vh_history.deliveries WHERE company_id=p_company_id AND permission_id=p_permission_id FOR UPDATE;
 PERFORM gridex_vh_history.require_basis_v1(p_company_id,p_permission_id);
 bound:=gridex_vh_history.request_binding_v1(p_company_id,p_permission_id,p_site_id,p_request_id,p_message_id,p_transaction_id);h:=encode(sha256(convert_to(bound::text,'UTF8')),'hex');
 SELECT * INTO prior FROM gridex_vh_history.requests WHERE company_id=p_company_id AND request_id=p_request_id;
 IF FOUND THEN
  IF(prior.permission_id,prior.site_id,prior.message_id,prior.transaction_id,prior.binding_hash,prior.binding) IS DISTINCT FROM(p_permission_id,p_site_id,p_message_id,p_transaction_id,h,bound) THEN RAISE EXCEPTION 'vh_history_request_replay_conflict';END IF;
  RETURN jsonb_build_object('requestId',prior.request_id,'state',prior.state,'idempotent',true,'transportAuthorityGranted',false);
 END IF;
 IF job.state='historical_delivery_closed' OR EXISTS(SELECT FROM gridex_vh_history.closures k WHERE k.company_id=p_company_id AND k.permission_id=p_permission_id AND k.site_id=p_site_id AND NOT EXISTS(SELECT FROM gridex_vh_history.restorations r WHERE r.company_id=k.company_id AND r.permission_id=k.permission_id AND r.site_id=k.site_id AND r.closure_source_message_id=k.source_message_id)) THEN RAISE EXCEPTION 'vh_history_request_delivery_closed';END IF;
 IF NOT EXISTS(SELECT FROM public.grid_owner_data_requests q WHERE q.company_id=p_company_id AND q.id=p_request_id AND q.status IN('pending','sent') AND q.sent_at IS NOT NULL) THEN RAISE EXCEPTION 'vh_history_request_not_pending';END IF;
 INSERT INTO gridex_vh_history.requests(company_id,permission_id,site_id,request_id,message_id,transaction_id,source_payload_hash,binding,binding_hash) VALUES(p_company_id,p_permission_id,p_site_id,p_request_id,p_message_id,p_transaction_id,bound->>'sourceRawHash',bound,h);
 RETURN jsonb_build_object('requestId',p_request_id,'state','awaiting','idempotent',false,'transportAuthorityGranted',false);
END$$;
CREATE FUNCTION gridex_vh_history.guard_request_v1() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF TG_OP='UPDATE' AND(to_jsonb(NEW)-ARRAY['state','closed_by_message_id'])=(to_jsonb(OLD)-ARRAY['state','closed_by_message_id']) AND OLD.state='awaiting' AND NEW.state='manual_review' AND NEW.closed_by_message_id IS NOT NULL THEN RETURN NEW;END IF;
 RAISE EXCEPTION 'vh_history_request_binding_immutable';
END$$;
CREATE TRIGGER vh_history_request_immutable BEFORE UPDATE OR DELETE ON gridex_vh_history.requests FOR EACH ROW EXECUTE FUNCTION gridex_vh_history.guard_request_v1();
CREATE TRIGGER vh_history_request_no_truncate BEFORE TRUNCATE ON gridex_vh_history.requests FOR EACH STATEMENT EXECUTE FUNCTION gridex_received_sources.reject_mutation();
-- Same writer OID/owner/ACL/default/settings and permission semantics. The
-- history-only Z24 hook preserves old proofs; validate-only/replay/S17 stay
-- unchanged. Full exact historical predecessor is guarded, never overwritten.
DO $hook$
DECLARE f record;body text;signature text:='gridex_received_sources.apply_permission_group_v1(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb,boolean)';
 close_needle text:=$n$  ELSE
   IF p_validate_only THEN RETURN jsonb_build_object('qualified',true);END IF;
   FOR a IN SELECT o FROM jsonb_array_elements(wire->'objects') o LOOP
$n$;
 close_hook text:=$h$   IF mode='S18' THEN PERFORM gridex_received_sources.close_vh_history_delivery_v1(m.company_id,p.id,m.id,p_actor_user_id,wire,p_canonical_id,p_scopes);END IF;
$h$;
 open_needle text:=$n$ RETURN jsonb_build_object('applied',true,'permissionId',p.id,'status',next_status,'stateVersion',after_state->'market_state_version');
$n$;
 open_hook text:=$h$ IF wire->>'code'='Z14' AND mode='S18' AND count_positive>0 THEN PERFORM gridex_vh_history.open_v1(m.company_id,p.id,m.id,p_actor_user_id);END IF;
 IF wire->>'code'='Z15' AND mode='S18' AND reason='Z24' THEN PERFORM gridex_vh_history.restore_v1(m.company_id,p.id,m.id,p_actor_user_id,wire);END IF;
$h$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) definition,to_jsonb(p)-'prosrc' metadata INTO STRICT f FROM pg_proc p WHERE p.oid=to_regprocedure(signature);
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')<>'33bbd09e49210e93c684e41527ff2ef48aac70c49a44c4cf92bdabc3c5d132fa' OR (length(f.prosrc)-length(replace(f.prosrc,close_needle,'')))/length(close_needle)<>1 OR (length(f.prosrc)-length(replace(f.prosrc,open_needle,'')))/length(open_needle)<>1 THEN RAISE EXCEPTION 'vh_history_permission_predecessor_required';END IF;
 body:=replace(replace(f.prosrc,close_needle,replace(close_needle,'   FOR a',close_hook||'   FOR a')),open_needle,open_hook||open_needle);
 EXECUTE replace(f.definition,f.prosrc,body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'vh_history_permission_metadata_changed';END IF;
END $hook$;
-- The new post-DML historical reader takes graph SHARE locks. Acquire the
-- existing canonical self-exclusive writer order BEFORE any source/cohort row
-- locks, preventing distinct writers' ROW EXCLUSIVE -> SHARE conversion and
-- original/job inversion. S17 scheduling also serializes; its business checks,
-- raw domains, periods, V/VH data and outcomes remain the exact predecessor.
DO $writer_lock$
DECLARE f record;body text;signature text:='public.ediel_apply_permission_source_v1(uuid,uuid,uuid,uuid)';
 needle text:=$n$ IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'permission_source_service_required' USING ERRCODE='42501';END IF;
$n$;
 prefix text:=$h$ PERFORM gridex_service_permission.lock_request_writer_v1();
$h$;
BEGIN
 SELECT p.oid,p.prosrc,pg_get_functiondef(p.oid) definition,to_jsonb(p)-'prosrc' metadata INTO STRICT f FROM pg_proc p WHERE p.oid=to_regprocedure(signature);
 IF encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')<>'4362a82ed71d6526be25caea4f1a01ed3d48cd80468f6b1fc962978dc8f454ef'
  OR (length(f.prosrc)-length(replace(f.prosrc,needle,'')))/length(needle)<>1
  OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=to_regprocedure('gridex_service_permission.lock_request_writer_v1()')) IS DISTINCT FROM 'da71d930e83ca1407ef7e192b2a03165069195aab8faa48aa9de8da648c7d1a9'
 THEN RAISE EXCEPTION 'vh_history_public_writer_predecessor_required';END IF;
 body:=replace(f.prosrc,needle,needle||prefix);
 EXECUTE replace(f.definition,f.prosrc,body);
 IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=f.oid) IS DISTINCT FROM f.metadata THEN RAISE EXCEPTION 'vh_history_public_writer_metadata_changed';END IF;
END $writer_lock$;
-- Internal operational audit requires a CURRENT tenant read permission. The
-- expired historical assignment never supplies read or E66 export authority.
CREATE FUNCTION gridex_vh_history.require_basis_v1(c uuid,pid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job gridex_vh_history.deliveries%rowtype;opening public.ediel_messages%rowtype;original public.ediel_messages%rowtype;p public.metering_permissions%rowtype;
BEGIN
 SELECT * INTO STRICT job FROM gridex_vh_history.deliveries WHERE company_id=c AND permission_id=pid;
 SELECT * INTO STRICT p FROM public.metering_permissions WHERE company_id=c AND id=pid;
 SELECT * INTO STRICT opening FROM public.ediel_messages WHERE company_id=c AND id=job.opening_source_message_id AND environment=job.environment AND direction='inbound' AND message_family='PRODAT' AND message_code='Z14';
 SELECT * INTO STRICT original FROM public.ediel_messages WHERE company_id=c AND id=job.original_message_id AND environment=job.environment AND direction='outbound' AND message_family='PRODAT' AND message_code='Z13';
 IF p.customer_id IS DISTINCT FROM job.customer_id OR coalesce(p.source_z13_message_id,p.outbound_z13_message_id) IS DISTINCT FROM original.id OR job.opening_payload_hash IS DISTINCT FROM encode(sha256(convert_to(opening.raw_payload,'UTF8')),'hex') OR job.original_payload_hash IS DISTINCT FROM original.immutable_payload_hash OR job.original_payload_hash IS DISTINCT FROM encode(sha256(convert_to(original.raw_payload,'UTF8')),'hex') OR gridex_received_sources.sent_source_is_current_v1(original) IS NOT TRUE
  OR NOT EXISTS(SELECT FROM gridex_received_sources.permission_effect_transitions_v1 t WHERE t.company_id=c AND t.permission_id=pid AND t.source_message_id=opening.id AND t.payload_hash=job.opening_payload_hash AND t.qualified_original_message_id=original.id AND t.qualified_expected_message_code='Z14' AND t.resulting_state#>>'{metadata,marketPermission,mode}'='S18')
  OR EXISTS(SELECT FROM gridex_vh_history.objects x WHERE x.company_id=c AND x.permission_id=pid AND x.basis_hash IS DISTINCT FROM encode(sha256(convert_to(jsonb_build_array(x.approved_site,x.authorization_basis)::text,'UTF8')),'hex'))
  OR EXISTS(SELECT FROM gridex_vh_history.closures k LEFT JOIN public.ediel_messages z ON z.id=k.source_message_id AND z.company_id=k.company_id AND z.environment=job.environment AND z.direction='inbound' AND z.message_family='PRODAT' AND z.message_code='Z15' WHERE k.company_id=c AND k.permission_id=pid AND (z.id IS NULL OR k.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(z.raw_payload,'UTF8')),'hex') OR k.review_hash IS DISTINCT FROM encode(sha256(convert_to(k.review::text,'UTF8')),'hex')))
  OR EXISTS(SELECT FROM gridex_vh_history.restorations r LEFT JOIN public.ediel_messages z ON z.id=r.source_message_id AND z.company_id=r.company_id AND z.environment=job.environment AND z.direction='inbound' AND z.message_family='PRODAT' AND z.message_code='Z15' WHERE r.company_id=c AND r.permission_id=pid AND (z.id IS NULL OR r.source_payload_hash IS DISTINCT FROM encode(sha256(convert_to(z.raw_payload,'UTF8')),'hex')))
 THEN RAISE EXCEPTION 'vh_history_immutable_basis_conflict';END IF;
END$$;
CREATE FUNCTION public.ediel_vh_history_delivery_audit_v1(p_company_id uuid,p_permission_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job gridex_vh_history.deliveries%rowtype;result jsonb;
BEGIN
 -- Graph-first read order conflicts with the canonical writer before either
 -- side can hold the other's original/job row. Existing read ACL is unchanged.
 PERFORM gridex_ediel_services.lock_evidence_graph_v1();
 PERFORM gridex_vh_history.authorize_v1(p_company_id,p_actor_user_id,'metering.read');
 SELECT * INTO job FROM gridex_vh_history.deliveries WHERE company_id=p_company_id AND permission_id=p_permission_id FOR SHARE;
 IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM gridex_vh_history.require_basis_v1(p_company_id,p_permission_id);
 SELECT coalesce(jsonb_agg(jsonb_build_object('siteId',o.site_id,'point',o.point,'product',o.product,'approvedStart',o.period_start,'approvedEnd',o.period_end,'basisHash',o.basis_hash,'closure',CASE WHEN k.site_id IS NULL THEN NULL ELSE jsonb_build_object('sourceMessageId',k.source_message_id,'sourcePayloadHash',k.source_payload_hash,'status',k.coverage_status,'reviewHash',k.review_hash,'reviewedAt',k.reviewed_at,'review',k.review) END,'closureHistory',(SELECT coalesce(jsonb_agg(jsonb_build_object('sourceMessageId',old.source_message_id,'status',old.coverage_status,'reviewHash',old.review_hash,'restoredByMessageId',r.source_message_id) ORDER BY old.reviewed_at,old.source_message_id),'[]') FROM gridex_vh_history.closures old LEFT JOIN gridex_vh_history.restorations r ON r.company_id=old.company_id AND r.permission_id=old.permission_id AND r.site_id=old.site_id AND r.closure_source_message_id=old.source_message_id WHERE old.company_id=o.company_id AND old.permission_id=o.permission_id AND old.site_id=o.site_id),'requests',(SELECT coalesce(jsonb_agg(jsonb_build_object('requestId',r.request_id,'messageId',r.message_id,'transactionId',r.transaction_id,'state',r.state,'closedByMessageId',r.closed_by_message_id) ORDER BY r.request_id),'[]') FROM gridex_vh_history.requests r WHERE r.company_id=o.company_id AND r.permission_id=o.permission_id AND r.site_id=o.site_id)) ORDER BY o.site_id),'[]') INTO result FROM gridex_vh_history.objects o LEFT JOIN gridex_vh_history.closures k ON k.company_id=o.company_id AND k.permission_id=o.permission_id AND k.site_id=o.site_id AND NOT EXISTS(SELECT FROM gridex_vh_history.restorations r WHERE r.company_id=k.company_id AND r.permission_id=k.permission_id AND r.site_id=k.site_id AND r.closure_source_message_id=k.source_message_id) WHERE o.company_id=p_company_id AND o.permission_id=p_permission_id;
 RETURN jsonb_build_object('companyId',job.company_id,'permissionId',job.permission_id,'environment',job.environment,'state',job.state,'openingSourceMessageId',job.opening_source_message_id,'objects',result,'dataAccessGranted',false,'transportAuthorityGranted',false);
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_vh_history FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION gridex_received_sources.close_vh_history_delivery_v1(uuid,uuid,uuid,uuid,jsonb,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_vh_history_delivery_audit_v1(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_vh_history_delivery_audit_v1(uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ediel_link_vh_history_request_v1(uuid,uuid,uuid,uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_link_vh_history_request_v1(uuid,uuid,uuid,uuid,uuid,text,uuid) TO service_role;
COMMIT;
