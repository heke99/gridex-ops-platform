-- Complete the same installed immutable market/route source owner: a tenant
-- legal actor and registry actor are distinct UUIDs linked by the current
-- company/environment legal Ediel identifier. Recheck freshness at execution.
-- No original, mandate, approval, source history or traffic activation is seeded.
BEGIN;
DO $import_graph$DECLARE definition text;BEGIN
 definition:=pg_get_functiondef('gridex_ediel_ack_replay.lock_current_graph_v2()'::regprocedure);
 IF position('LOCK TABLE' IN definition)=0 AND position('lock table' IN definition)=0 THEN RAISE EXCEPTION 'registry_actual_current_graph_lock_prefix_required';END IF;
 definition:=replace(definition,'gridex_ediel_ack_replay.lock_current_graph_v2','gridex_registry_import.lock_import_graph_v1');
 definition:=regexp_replace(definition,'IN SHARE MODE','IN SHARE ROW EXCLUSIVE MODE','gi');
 EXECUTE definition;
END$import_graph$;
-- Paired current forward: repairs the same bounded owner on a branch that
-- recorded40446 before receiving the union's40159 replacement. Pristine replay
-- uses40445→40446; this path recognizes only the exact expected source shapes.
DO $current_txt$
DECLARE definition text; before record; after record; anchor text;
BEGIN
 SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile INTO STRICT before FROM pg_proc WHERE oid='public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)'::regprocedure;
 definition:=pg_get_functiondef(before.oid);
 IF position('capture_actor_market_v1' IN definition)=0 OR position('capture_route_market_v1' IN definition)=0
  OR position('ediel_registry_declared_transport_source_required' IN definition)=0 OR position('raw_certificate_pem' IN definition)=0 THEN RAISE EXCEPTION 'ediel_registry_market_txt_composed_owner_required';END IF;
 anchor:=$anchor$org_number=CASE WHEN market='EL' THEN coalesce(org_number,nullif(item->>'orgNumber','')) ELSE org_number END,country_code=CASE WHEN market='EL' THEN item->>'countryCode' ELSE country_code END,source_reference$anchor$;
 IF position(anchor IN definition)>0 THEN
  definition:=replace(definition,anchor,$anchor$org_number=coalesce(org_number,nullif(item->>'orgNumber','')),country_code=coalesce(nullif(item->>'countryCode',''),country_code),source_reference$anchor$);
  IF position('updated_at=now() WHERE id=aid;' IN definition)=0 THEN RAISE EXCEPTION 'ediel_registry_market_txt_own_update_anchor_required';END IF;
  definition:=replace(definition,'updated_at=now() WHERE id=aid;','updated_at=now() WHERE id=aid AND market=''EL'';');
 ELSIF position($anchor$org_number=coalesce(org_number,nullif(item->>'orgNumber','')),source_reference$anchor$ IN definition)>0
  AND position('WHERE id=aid AND market=''EL''' IN definition)>0 THEN
  -- The newly added prerequisite ran, but40446 was already recorded on this
  -- upgraded branch. Apply its exact country effect here without a second run.
  definition:=replace(definition,$anchor$org_number=coalesce(org_number,nullif(item->>'orgNumber','')),source_reference$anchor$,
   $anchor$org_number=coalesce(org_number,nullif(item->>'orgNumber','')),country_code=coalesce(nullif(item->>'countryCode',''),country_code),source_reference$anchor$);
 ELSIF position('country_code=coalesce(nullif(item->>''countryCode'',''''),country_code)' IN definition)=0
  OR position('WHERE id=aid AND market=''EL''' IN definition)=0 THEN RAISE EXCEPTION 'ediel_registry_market_txt_unknown_owner_boundary';END IF;
 definition:=replace(definition,'(''companies_xml'',''csv'')','(''companies_xml'',''companies_txt'',''csv'')');
 IF position('companies_txt' IN definition)=0 THEN RAISE EXCEPTION 'ediel_registry_current_txt_boundary_required';END IF;
 EXECUTE definition;
 SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile INTO STRICT after FROM pg_proc WHERE oid='public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)'::regprocedure;
 IF to_jsonb(before) IS DISTINCT FROM to_jsonb(after) THEN RAISE EXCEPTION 'ediel_registry_current_txt_owner_metadata_changed';END IF;
END $current_txt$;
CREATE OR REPLACE FUNCTION gridex_registry_import.current_el_tenant_actor_source_v1(c uuid,legal_actor uuid,env text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE legal_id text;n int;source_actor uuid;q jsonb;identifiers jsonb;roles jsonb;profiles jsonb;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 IF c IS NULL OR legal_actor IS NULL OR(env IN('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_owned_tenant_supplier_required';END IF;
 PERFORM id FROM public.tenant_actor_identifiers WHERE company_id=c AND environment=env ORDER BY id FOR SHARE;
 PERFORM id FROM public.tenant_actor_roles WHERE company_id=c AND environment=env ORDER BY id FOR SHARE;
 PERFORM id FROM public.tenant_ediel_profiles WHERE company_id=c AND environment=env ORDER BY id FOR SHARE;
 SELECT count(DISTINCT(actor_id,btrim(identifier_value))),min(btrim(identifier_value)),jsonb_agg(to_jsonb(i) ORDER BY id) INTO n,legal_id,identifiers FROM public.tenant_actor_identifiers i WHERE company_id=c AND environment=env AND actor_id=legal_actor AND identifier_type='EdielId' AND valid_from<=clock_timestamp() AND(valid_to IS NULL OR clock_timestamp()<valid_to);
 IF n<>1 OR legal_id!~'^[0-9]{5}$' OR(SELECT count(DISTINCT(actor_id,btrim(identifier_value)))FROM public.tenant_actor_identifiers WHERE company_id=c AND environment=env AND identifier_type='EdielId' AND valid_from<=clock_timestamp() AND(valid_to IS NULL OR clock_timestamp()<valid_to))<>1 THEN RAISE EXCEPTION 'ediel_registry_unique_current_tenant_legal_identifier_required';END IF;
 SELECT jsonb_agg(to_jsonb(r) ORDER BY id) INTO roles FROM public.tenant_actor_roles r WHERE company_id=c AND environment=env AND actor_id=legal_actor AND role_code='electricity_supplier' AND valid_from<=clock_timestamp() AND(valid_to IS NULL OR clock_timestamp()<valid_to);
 SELECT jsonb_agg(to_jsonb(p) ORDER BY id) INTO profiles FROM public.tenant_ediel_profiles p WHERE company_id=c AND environment=env AND market='electricity' AND is_enabled AND valid_from<=clock_timestamp() AND(valid_to IS NULL OR clock_timestamp()<valid_to);
 IF roles IS NULL OR profiles IS NULL THEN RAISE EXCEPTION 'ediel_registry_current_tenant_el_supplier_required';END IF;
 PERFORM id FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=legal_id ORDER BY id FOR SHARE;
 SELECT count(DISTINCT actor_id),min(actor_id::text)::uuid INTO n,source_actor FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=legal_id AND(valid_from IS NULL OR valid_from<=clock_timestamp()::date) AND(valid_to IS NULL OR clock_timestamp()::date<=valid_to);
 IF n<>1 THEN RETURN jsonb_build_object('status','held','reason','current_original_legal_actor_source_required','companyId',c,'environment',env,'legalActorId',legal_actor);END IF;
 q:=gridex_registry_import.current_el_actor_source_v1(source_actor);
 IF NOT EXISTS(SELECT FROM public.platform_market_actors WHERE id=source_actor AND status='active') OR NOT EXISTS(SELECT FROM public.platform_actor_roles WHERE actor_id=source_actor AND actor_role='electricity_supplier' AND is_active) OR q->>'status' IS DISTINCT FROM 'source_qualified' OR q->>'legalEdielId' IS DISTINCT FROM legal_id OR q->>'market' IS DISTINCT FROM 'EL' OR(q->'roles' @> '["electricity_supplier"]'::jsonb) IS NOT TRUE THEN RETURN jsonb_build_object('status','held','reason','current_original_legal_actor_source_required','companyId',c,'environment',env,'legalActorId',legal_actor,'sourceActorId',source_actor);END IF;
 RETURN q||jsonb_build_object('companyId',c,'environment',env,'legalActorId',legal_actor,'sourceActorId',source_actor,'tenantIdentifierSource',identifiers,'tenantRoleSource',roles,'tenantProfileSource',profiles);
END$$;

CREATE OR REPLACE FUNCTION gridex_registry_import.current_el_actor_source_v1(p_actor_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s text;rec gridex_registry_import.market_records%rowtype;n gridex_registry_import.normalized_batches%rowtype;b gridex_registry_import.batches%rowtype;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 LOCK TABLE public.platform_market_actors,public.platform_actor_roles,public.platform_actor_routes,public.platform_actor_certificates,gridex_registry_import.market_current,gridex_registry_import.route_market_current IN SHARE MODE;
 IF p_actor_id IS NULL THEN RAISE EXCEPTION 'ediel_registry_actual_legal_actor_required';END IF;
 SELECT source_sha256 INTO s FROM gridex_registry_import.market_current WHERE actor_id=p_actor_id AND market='EL' FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','held','actorId',p_actor_id,'reason','current_original_legal_actor_source_required');END IF;
 SELECT * INTO rec FROM gridex_registry_import.market_records WHERE actor_id=p_actor_id AND market='EL' AND source_sha256=s FOR SHARE;
 SELECT * INTO n FROM gridex_registry_import.normalized_batches WHERE source_sha256=s FOR SHARE;
 SELECT * INTO b FROM gridex_registry_import.batches WHERE source_sha256=s FOR SHARE;
 PERFORM 1 FROM public.platform_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=rec.record->>'edielId' ORDER BY i.actor_id FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.platform_market_actors WHERE id=p_actor_id AND status='active') OR rec.actor_id IS NULL OR n.source_sha256 IS NULL OR b.source_sha256 IS NULL OR rec.record->>'market' IS DISTINCT FROM 'EL'
  OR nullif(rec.record->>'name','') IS NULL OR nullif(rec.record->>'countryCode','') IS NULL OR (rec.record->>'edielId' ~ '^[0-9]{5}$') IS NOT TRUE
  OR rec.record_sha256 IS DISTINCT FROM encode(sha256(convert_to(rec.record::text,'UTF8')),'hex')
  OR b.created_at>clock_timestamp() OR b.source_sha256 IS DISTINCT FROM encode(sha256(b.source_bytes),'hex')
  OR b.normalized_sha256 IS DISTINCT FROM encode(sha256(convert_to(n.records::text,'UTF8')),'hex')
  OR(SELECT count(*) FROM jsonb_array_elements(n.records)item WHERE item=rec.record)<>1
  OR(SELECT count(*) FROM public.platform_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=rec.record->>'edielId' AND i.actor_id=p_actor_id AND(i.valid_from IS NULL OR i.valid_from<=clock_timestamp()::date) AND(i.valid_to IS NULL OR clock_timestamp()::date<=i.valid_to))<>1 THEN
  RETURN jsonb_build_object('status','held','actorId',p_actor_id,'reason','current_original_legal_actor_source_required');END IF;
 RETURN jsonb_build_object('status','source_qualified','actorId',p_actor_id,'market','EL','legalEdielId',rec.record->>'edielId','legalName',rec.record->>'name','countryCode',rec.record->>'countryCode','roles',rec.record->'roles','sourceSha256',s,'sourceRecordSha256',rec.record_sha256);
END$$;

CREATE OR REPLACE FUNCTION gridex_registry_import.route_source_v1(rid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.platform_actor_routes%rowtype;own gridex_registry_import.route_market_sources%rowtype;rec gridex_registry_import.market_records%rowtype;n gridex_registry_import.normalized_batches%rowtype;b gridex_registry_import.batches%rowtype;s text;
BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 LOCK TABLE public.platform_market_actors,public.platform_actor_roles,public.platform_actor_routes,public.platform_actor_certificates,gridex_registry_import.market_current,gridex_registry_import.route_market_current IN SHARE MODE;
 SELECT * INTO r FROM public.platform_actor_routes WHERE id=rid FOR SHARE;
 IF r.id IS NULL OR r.registry_market IS NULL OR(r.valid_from IS NOT NULL AND r.valid_from>clock_timestamp()::date) OR(r.valid_to IS NOT NULL AND r.valid_to<clock_timestamp()::date) THEN RETURN jsonb_build_object('status','held','routeId',rid,'reason','source_declared_registry_market_required');END IF;
 SELECT source_sha256 INTO s FROM gridex_registry_import.route_market_current WHERE route_id=r.id FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','held','routeId',rid,'reason','prospective_route_market_basis_required');END IF;
 SELECT * INTO own FROM gridex_registry_import.route_market_sources WHERE route_id=r.id AND source_sha256=s FOR SHARE;
 SELECT * INTO rec FROM gridex_registry_import.market_records WHERE actor_id=own.actor_id AND market=own.market AND source_sha256=own.source_sha256 FOR SHARE;
 SELECT * INTO n FROM gridex_registry_import.normalized_batches WHERE source_sha256=own.source_sha256 FOR SHARE;
 SELECT * INTO b FROM gridex_registry_import.batches WHERE source_sha256=own.source_sha256 FOR SHARE;
 IF NOT EXISTS(SELECT FROM public.platform_market_actors WHERE id=r.actor_id AND status='active') OR own.route_id IS NULL OR rec.actor_id IS NULL OR b.source_sha256 IS NULL OR n.source_sha256 IS NULL OR own.actor_id IS DISTINCT FROM r.actor_id OR own.market IS DISTINCT FROM r.registry_market
  OR own.wire_tuple IS DISTINCT FROM gridex_registry_import.route_tuple_v1(r) OR rec.record_sha256 IS DISTINCT FROM own.record_sha256
  OR (rec.record->>'edielId' ~ '^[0-9]{5}$') IS NOT TRUE OR rec.record->>'market' IS DISTINCT FROM own.market OR nullif(rec.record->>'countryCode','') IS NULL OR rec.record->>'edielId' IS DISTINCT FROM r.party_id
  OR b.created_at>clock_timestamp() OR b.source_sha256 IS DISTINCT FROM encode(sha256(b.source_bytes),'hex') OR b.normalized_sha256 IS DISTINCT FROM encode(sha256(convert_to(n.records::text,'UTF8')),'hex')
  OR(SELECT count(*) FROM jsonb_array_elements(n.records) item WHERE item=rec.record)<>1
  OR NOT EXISTS(SELECT FROM gridex_registry_import.market_current p WHERE p.actor_id=own.actor_id AND p.market=own.market AND p.source_sha256=own.source_sha256)
  OR NOT EXISTS(SELECT FROM public.platform_actor_identifiers i WHERE i.actor_id=own.actor_id AND i.identifier_type='EdielId' AND i.identifier_value=rec.record->>'edielId' AND(i.valid_from IS NULL OR i.valid_from<=clock_timestamp()::date) AND(i.valid_to IS NULL OR clock_timestamp()::date<=i.valid_to)) THEN
  RETURN jsonb_build_object('status','held','routeId',rid,'reason','current_exact_registry_market_source_required');END IF;
 RETURN jsonb_build_object('status','source_qualified','routeId',r.id,'actorId',r.actor_id,'market',own.market,'sourceSha256',own.source_sha256,'sourceRecordSha256',own.record_sha256,'countryCode',rec.record->>'countryCode','legalName',rec.record->>'name','roles',rec.record->'roles','legalEdielId',rec.record->>'edielId','wire',own.wire_tuple);
END$$;

CREATE OR REPLACE FUNCTION gridex_registry_import.dispatch_source_v1(c uuid,communication uuid,profile uuid,env text,family text,application text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.ediel_route_profiles%rowtype;r public.communication_routes%rowtype;profile_id text;communication_id text;registry_id uuid;q jsonb;profile_wire jsonb;subaddress text;source_family text;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 LOCK TABLE public.platform_market_actors,public.platform_actor_roles,public.platform_actor_routes,public.platform_actor_certificates,gridex_registry_import.market_current,gridex_registry_import.route_market_current IN SHARE MODE;
 source_family:=CASE WHEN family='AI_LIST' THEN 'AI' ELSE family END;
 SELECT * INTO p FROM public.ediel_route_profiles WHERE id=profile AND company_id=c FOR SHARE;
 SELECT * INTO r FROM public.communication_routes WHERE id=communication AND company_id=c FOR SHARE;
 IF p.id IS NULL OR r.id IS NULL OR p.communication_route_id IS DISTINCT FROM r.id OR(env IN('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_owned_route_profile_required';END IF;
 profile_id:=nullif(p.metadata->>'platform_actor_route_id','');communication_id:=nullif(r.auth_config->>'platform_actor_route_id','');
 IF profile_id IS NOT NULL AND communication_id IS NOT NULL AND profile_id IS DISTINCT FROM communication_id THEN RAISE EXCEPTION 'ediel_registry_route_mapping_conflict';END IF;
 IF coalesce(profile_id,communication_id) IS NULL THEN
  IF p.metadata->>'materialized_from'='platform_actor_routes' OR r.auth_config->>'materialized_from'='platform_actor_routes' THEN RAISE EXCEPTION 'ediel_registry_route_mapping_required';END IF;RETURN NULL;
 END IF;
 registry_id:=coalesce(profile_id,communication_id)::uuid;q:=gridex_registry_import.require_el_route_v1(registry_id);profile_wire:=to_jsonb(p);
 IF nullif(profile_wire->>'receiver_subaddress','') IS NOT NULL AND nullif(profile_wire->>'receiver_sub_address','') IS NOT NULL AND profile_wire->>'receiver_subaddress' IS DISTINCT FROM profile_wire->>'receiver_sub_address' THEN RAISE EXCEPTION 'ediel_registry_route_dispatch_source_mismatch';END IF;
 subaddress:=coalesce(nullif(profile_wire->>'receiver_subaddress',''),nullif(profile_wire->>'receiver_sub_address',''));
 -- Registry APP absence remains absent. The SAME canonical policy owns the
 -- protocol APP; actual saved/profile APP is still bound below. A declared
 -- registry APP can never be widened to a different selected application.
 IF q#>>'{wire,environment}' IS DISTINCT FROM env OR q#>>'{wire,family}' IS DISTINCT FROM source_family OR profile_wire->>'environment' IS DISTINCT FROM env
  OR profile_wire->>'message_family' IS DISTINCT FROM family OR lower(q#>>'{wire,transport}') IS DISTINCT FROM 'smtp'
  OR profile_wire->>'transport_type' IS DISTINCT FROM 'smtp' OR to_jsonb(r)->>'route_type' IS DISTINCT FROM 'ediel_partner'
  OR(env='production' AND to_jsonb(r)->>'environment_type' IS DISTINCT FROM 'production') OR(env='test' AND(to_jsonb(r)->>'environment_type' IN('tgt_test','agt_test','bilateral_test')) IS NOT TRUE)
  OR profile_wire->>'receiver_ediel_id' IS DISTINCT FROM q#>>'{wire,interchangePartyId}' OR subaddress IS DISTINCT FROM nullif(q#>>'{wire,subaddress}','')
  OR nullif(profile_wire->>'application_reference','') IS DISTINCT FROM nullif(application,'')
  OR(q#>>'{wire,applicationReference}' IS NOT NULL AND q#>>'{wire,applicationReference}' IS DISTINCT FROM application)
  OR r.target_email IS DISTINCT FROM q#>>'{wire,address}' THEN RAISE EXCEPTION 'ediel_registry_route_dispatch_source_mismatch';END IF;
 IF family='AI_LIST' AND(application IS NOT NULL OR q#>>'{wire,applicationReference}' IS NOT NULL OR nullif(q->>'legalName','') IS NULL
  OR profile_wire->>'is_active' IS DISTINCT FROM 'true' OR profile_wire->>'is_enabled' IS DISTINCT FROM 'true'
  OR to_jsonb(r)->>'is_active' IS DISTINCT FROM 'true' OR profile_wire->>'message_standard' IS DISTINCT FROM 'ai_list'
  OR profile_wire->>'payload_format' IS DISTINCT FROM 'raw') THEN RAISE EXCEPTION 'ediel_registry_ai_list_dispatch_source_required';END IF;
 RETURN q||jsonb_build_object('companyId',c,'communicationRouteId',r.id,'routeProfileId',p.id,'selectedApplicationReference',application)
  ||CASE WHEN family='AI_LIST' THEN jsonb_build_object('canonicalFamily','AI') ELSE '{}'::jsonb END;
END$$;

CREATE OR REPLACE FUNCTION gridex_registry_import.require_message_market_v1(c uuid,mid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;q jsonb;tokens jsonb;unb jsonb;unh jsonb;receiver_legal jsonb;BEGIN
 PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();
 LOCK TABLE public.platform_market_actors,public.platform_actor_roles,public.platform_actor_routes,public.platform_actor_certificates,gridex_registry_import.market_current,gridex_registry_import.route_market_current IN SHARE MODE;
 SELECT * INTO m FROM public.ediel_messages WHERE id=mid AND company_id=c FOR SHARE;
 IF m.id IS NULL THEN RAISE EXCEPTION 'ediel_registry_message_scope_required';END IF;
 IF m.direction IS DISTINCT FROM 'outbound' OR(m.message_family IN('PRODAT','UTILTS','AI','AI_LIST')) IS NOT TRUE OR m.message_code='ERR' THEN RETURN NULL;END IF;
 q:=gridex_registry_import.dispatch_source_v1(c,m.communication_route_id,m.route_profile_id,m.environment,m.message_family,m.application_reference);
 IF q IS NULL THEN RETURN NULL;END IF;
 IF m.receiver_ediel_id IS DISTINCT FROM q#>>'{wire,interchangePartyId}' OR nullif(m.receiver_sub_address,'') IS DISTINCT FROM nullif(q#>>'{wire,subaddress}','') OR m.receiver_email IS DISTINCT FROM q#>>'{wire,address}' OR m.transport_type IS DISTINCT FROM 'smtp' THEN RAISE EXCEPTION 'ediel_registry_message_dispatch_source_mismatch';END IF;
 IF m.message_family IN('PRODAT','UTILTS') THEN
  tokens:=gridex_utilts_binding.wire_tokens_v1(m.raw_payload);
  IF(SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNB')<>1 OR(SELECT count(*) FROM jsonb_array_elements(tokens) t WHERE t->>'tag'='UNH')<>1 THEN RAISE EXCEPTION 'ediel_registry_message_wire_source_required';END IF;
  SELECT t INTO unb FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNB';SELECT t INTO unh FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='UNH';
  IF unb#>>'{elements,3,0}' IS DISTINCT FROM q#>>'{wire,interchangePartyId}' OR nullif(unb#>>'{elements,3,2}','') IS DISTINCT FROM nullif(q#>>'{wire,subaddress}','') OR nullif(unb#>>'{elements,7,0}','') IS DISTINCT FROM nullif(m.application_reference,'') OR unh#>>'{elements,2,0}' IS DISTINCT FROM m.message_family THEN RAISE EXCEPTION 'ediel_registry_message_wire_source_mismatch';END IF;
  -- Legal receiver is the original actor PartyId, independently of technical
  -- UNB interchange identity. Only own common-header NAD is consumed.
  IF(SELECT count(*) FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'=CASE m.message_family WHEN 'PRODAT' THEN 'DO' ELSE 'MR' END AND (t->>'index')::int < coalesce((SELECT min((u->>'index')::int) FROM jsonb_array_elements(tokens)u WHERE u->>'tag'=CASE m.message_family WHEN 'PRODAT' THEN 'LIN' ELSE 'IDE' END),2147483647))<>1 THEN RAISE EXCEPTION 'ediel_registry_message_legal_receiver_required';END IF;
  SELECT t INTO receiver_legal FROM jsonb_array_elements(tokens)t WHERE t->>'tag'='NAD' AND t#>>'{elements,1,0}'=CASE m.message_family WHEN 'PRODAT' THEN 'DO' ELSE 'MR' END AND (t->>'index')::int < coalesce((SELECT min((u->>'index')::int) FROM jsonb_array_elements(tokens)u WHERE u->>'tag'=CASE m.message_family WHEN 'PRODAT' THEN 'LIN' ELSE 'IDE' END),2147483647);
  IF receiver_legal#>>'{elements,2,0}' IS DISTINCT FROM q->>'legalEdielId' THEN RAISE EXCEPTION 'ediel_registry_message_legal_receiver_source_mismatch';END IF;
 END IF;RETURN q;
END$$;
-- Acquire the installed graph in its existing order, choosing importer table
-- modes before row reads to avoid lock upgrades against concurrent source reads.
DO $import_lock$
DECLARE definition text; original text; before record; after record;
BEGIN
 SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile INTO STRICT before FROM pg_proc WHERE oid='public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)'::regprocedure;
 original:=pg_get_functiondef(before.oid);
 IF position('BEGIN'||chr(10)||' IF p_actor_user_id IS NULL' IN original)=0 THEN RAISE EXCEPTION 'ediel_registry_import_current_graph_anchor_required';END IF;
 definition:=replace(original,'BEGIN'||chr(10)||' IF p_actor_user_id IS NULL',
 'BEGIN'||chr(10)||' PERFORM gridex_registry_import.lock_import_graph_v1();'||chr(10)||
 ' LOCK TABLE public.platform_market_actors,public.platform_actor_roles,public.platform_actor_routes,public.platform_actor_certificates,gridex_registry_import.market_current,gridex_registry_import.route_market_current IN SHARE ROW EXCLUSIVE MODE;'||chr(10)||' IF p_actor_user_id IS NULL');
 EXECUTE definition;
 SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile INTO STRICT after FROM pg_proc WHERE oid='public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb)'::regprocedure;
 IF to_jsonb(before) IS DISTINCT FROM to_jsonb(after) THEN RAISE EXCEPTION 'ediel_registry_import_graph_owner_metadata_changed';END IF;
END $import_lock$;
-- Preview and actual verification enter the same graph before the registry
-- advisory mutex or row locks. Verification takes its final write-compatible
-- mode up front; preview never holds the mutex while waiting on that graph.
DO $graph_callers$
DECLARE signature text; definition text; before record; after record; prefix text;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.ediel_read_registry_preview_snapshot_v1(uuid,text[])',
  'public.ediel_read_actor_registry_batch_v1(uuid,text,text,text)',
  'public.ediel_verify_registry_el_actor_v1(uuid,uuid,uuid)'] LOOP
  SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile INTO STRICT before FROM pg_proc WHERE oid=signature::regprocedure;
  definition:=pg_get_functiondef(before.oid);
  IF position('BEGIN'||chr(10)||' IF ' IN definition)=0 THEN RAISE EXCEPTION 'ediel_registry_current_graph_caller_anchor_required: %',signature;END IF;
  IF signature LIKE '%ediel_verify_%' THEN
   prefix:=' PERFORM gridex_registry_import.lock_import_graph_v1();'||chr(10)||
    ' LOCK TABLE public.platform_market_actors,public.platform_actor_roles,public.platform_actor_routes,public.platform_actor_certificates,gridex_registry_import.market_current,gridex_registry_import.route_market_current IN SHARE ROW EXCLUSIVE MODE;';
  ELSE
   prefix:=' PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();'||chr(10)||
    ' LOCK TABLE public.platform_market_actors,public.platform_actor_roles,public.platform_actor_routes,public.platform_actor_certificates,gridex_registry_import.market_current,gridex_registry_import.route_market_current IN SHARE MODE;';
  END IF;
  definition:=replace(definition,'BEGIN'||chr(10)||' IF ','BEGIN'||chr(10)||prefix||chr(10)||' IF ');
  EXECUTE definition;
  SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile INTO STRICT after FROM pg_proc WHERE oid=signature::regprocedure;
  IF to_jsonb(before) IS DISTINCT FROM to_jsonb(after) THEN RAISE EXCEPTION 'ediel_registry_current_graph_caller_metadata_changed: %',signature;END IF;
 END LOOP;
END $graph_callers$;
-- AI phase authorization is its own current preparation/delivery capability. The installed
-- method-contract READ actor also required unrelated customer/contract reads;
-- it is not the authority for preparing/sending a source-owned AI original.
-- Actual original disclosure remains authorize_original_read_v1 in92522.
DO $ai_phase$
DECLARE definition text; before record; after record; read_predicate text; prepare_predicate text; phase_guard text;
BEGIN
 SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile INTO STRICT before FROM pg_proc WHERE oid='gridex_ai_purpose_sources.consumer_v1(uuid,uuid,text,text)'::regprocedure;
 definition:=pg_get_functiondef(before.oid);
 read_predicate:=$predicate$ OR gridex_bilateral_customer_sources.classified_actor_wallclock_v1(c,actor,'read','method_contract') IS NOT TRUE$predicate$;
 prepare_predicate:=$predicate$ ELSE gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c,actor,'communication.send') IS TRUE END$predicate$;
 IF position(read_predicate IN definition)=0 OR position('gridex_ai_purpose_sources.legal_scope_v1(c,env)' IN definition)=0
  OR position(prepare_predicate IN definition)=0
  OR position('gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c,actor,''communication.send'')' IN definition)=0
  OR position(' PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();' IN definition)=0 THEN RAISE EXCEPTION 'ai_list_actual_phase_consumer_predecessor_required';END IF;
 definition:=replace(definition,read_predicate,'');
 --103735 restores the original exact preparation catalogue entry without
 -- assigning grants. Preserve original20550 phase semantics: no SEND alias
 -- for preparation and no WRITE alias for external delivery.
 definition:=replace(definition,prepare_predicate,replace(prepare_predicate,'''communication.send''','''communication.write'''));
 definition:=replace(definition,' PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();',
  ' PERFORM gridex_ediel_ack_replay.lock_current_graph_v2();'||chr(10)||' PERFORM gridex_ai_processing.authorize_original_actor_v1(c,actor);');
 phase_guard:=$phase$ IF (phase IN('origination','send')) IS NOT TRUE OR (env IN('test','production')) IS NOT TRUE OR (CASE WHEN phase='send' THEN gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c,actor,'ediel.send') IS TRUE OR gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c,actor,'communication.send') IS TRUE ELSE gridex_bilateral_customer_sources.classified_scoped_permission_wallclock_v1(c,actor,'communication.write') IS TRUE END) IS NOT TRUE THEN RAISE EXCEPTION 'ai_purpose_current_consumer_forbidden' USING ERRCODE='42501';END IF;$phase$;
 IF position(phase_guard IN definition)=0 THEN RAISE EXCEPTION 'ai_list_actual_phase_guard_required';END IF;
 -- Legal-source selection can wait. Current user/tenant and clock-sensitive
 -- deny/grant checks qualify execution after the final inner source read too.
 definition:=replace(definition,' PERFORM gridex_ai_purpose_sources.legal_scope_v1(c,env);',
  ' PERFORM gridex_ai_purpose_sources.legal_scope_v1(c,env);'||chr(10)||' PERFORM gridex_ai_processing.authorize_original_actor_v1(c,actor);'||chr(10)||phase_guard);
 EXECUTE definition;
 SELECT oid,proacl,proowner,proconfig,prosecdef,provolatile INTO STRICT after FROM pg_proc WHERE oid='gridex_ai_purpose_sources.consumer_v1(uuid,uuid,text,text)'::regprocedure;
 IF to_jsonb(before) IS DISTINCT FROM to_jsonb(after) THEN RAISE EXCEPTION 'ai_list_actual_phase_consumer_metadata_changed';END IF;
END $ai_phase$;
REVOKE ALL ON FUNCTION gridex_registry_import.lock_import_graph_v1(),gridex_registry_import.current_el_tenant_actor_source_v1(uuid,uuid,text),
 gridex_registry_import.current_el_actor_source_v1(uuid),gridex_registry_import.route_source_v1(uuid),
 gridex_registry_import.dispatch_source_v1(uuid,uuid,uuid,text,text,text),gridex_registry_import.require_message_market_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
