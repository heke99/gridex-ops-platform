-- Prospective EL/GAS source isolation. Historical NULL markets are never guessed.
-- A legal actor remains common; source roles/routes/country are retained per market.
-- No registry original, legal mandate, GAS/future capability or activation is seeded.
BEGIN;
ALTER TABLE public.platform_actor_routes ADD COLUMN registry_market text CHECK(registry_market IN('EL','GAS'));
DROP INDEX public.platform_actor_routes_uidx;
CREATE UNIQUE INDEX platform_actor_routes_uidx ON public.platform_actor_routes(actor_id,coalesce(registry_market,''),upper(message_family),environment,coalesce(subaddress,''),coalesce(application_reference,''),coalesce(communication_address,''));
CREATE TABLE gridex_registry_import.normalized_batches(source_sha256 text PRIMARY KEY REFERENCES gridex_registry_import.batches(source_sha256) DEFERRABLE INITIALLY DEFERRED,records jsonb NOT NULL CHECK(jsonb_typeof(records)='array'));
CREATE TABLE gridex_registry_import.market_records(actor_id uuid NOT NULL REFERENCES public.platform_market_actors(id),market text NOT NULL CHECK(market IN('EL','GAS')),source_sha256 text NOT NULL REFERENCES gridex_registry_import.normalized_batches(source_sha256) DEFERRABLE INITIALLY DEFERRED,record_sha256 text NOT NULL,record jsonb NOT NULL,PRIMARY KEY(actor_id,market,source_sha256),CHECK(record_sha256=encode(sha256(convert_to(record::text,'UTF8')),'hex')));
CREATE TABLE gridex_registry_import.market_current(actor_id uuid NOT NULL,market text NOT NULL,source_sha256 text NOT NULL,PRIMARY KEY(actor_id,market),FOREIGN KEY(actor_id,market,source_sha256) REFERENCES gridex_registry_import.market_records(actor_id,market,source_sha256) DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE gridex_registry_import.route_market_sources(route_id uuid NOT NULL REFERENCES public.platform_actor_routes(id),actor_id uuid NOT NULL,market text NOT NULL,source_sha256 text NOT NULL,record_sha256 text NOT NULL,wire_tuple jsonb NOT NULL,PRIMARY KEY(route_id,source_sha256),FOREIGN KEY(actor_id,market,source_sha256) REFERENCES gridex_registry_import.market_records(actor_id,market,source_sha256) DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE gridex_registry_import.route_market_current(route_id uuid PRIMARY KEY,source_sha256 text NOT NULL,FOREIGN KEY(route_id,source_sha256) REFERENCES gridex_registry_import.route_market_sources(route_id,source_sha256) DEFERRABLE INITIALLY DEFERRED);
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['normalized_batches','market_records','market_current','route_market_sources','route_market_current'] LOOP
 EXECUTE format('ALTER TABLE gridex_registry_import.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE gridex_registry_import.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON gridex_registry_import.%I FROM PUBLIC,anon,authenticated,service_role',t);
 IF t NOT IN('market_current','route_market_current') THEN EXECUTE format('CREATE TRIGGER registry_market_immutable BEFORE UPDATE OR DELETE ON gridex_registry_import.%I FOR EACH ROW EXECUTE FUNCTION gridex_registry_import.immutable_v1()',t);EXECUTE format('CREATE TRIGGER registry_market_no_truncate BEFORE TRUNCATE ON gridex_registry_import.%I FOR EACH STATEMENT EXECUTE FUNCTION gridex_registry_import.immutable_v1()',t);END IF;
END LOOP;END$$;
CREATE FUNCTION gridex_registry_import.route_tuple_v1(r public.platform_actor_routes) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT jsonb_build_object('actorId',r.actor_id,'market',r.registry_market,'family',r.message_family,'environment',r.environment,'subaddress',r.subaddress,'applicationReference',r.application_reference,'address',r.communication_address,'transport',r.communication_type,'partyId',r.party_id,'interchangePartyId',r.interchange_party_id,'partyQualifier',r.party_id_qualifier,'partyResponsible',r.party_id_responsible,'interchangeQualifier',r.interchange_id_qualifier,'charset',r.edi_charset,'syntax',r.edi_syntax) $$;
CREATE FUNCTION gridex_registry_import.capture_actor_market_v1(a uuid,m text,s text,rec jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF a IS NULL OR(m IN('EL','GAS')) IS NOT TRUE OR rec->>'market' IS DISTINCT FROM m OR nullif(rec->>'edielId','') IS NULL OR nullif(rec->>'countryCode','') IS NULL THEN RAISE EXCEPTION 'ediel_registry_market_source_required';END IF;
 INSERT INTO gridex_registry_import.market_records(actor_id,market,source_sha256,record_sha256,record) VALUES(a,m,s,encode(sha256(convert_to(rec::text,'UTF8')),'hex'),rec);
 INSERT INTO gridex_registry_import.market_current VALUES(a,m,s) ON CONFLICT(actor_id,market) DO UPDATE SET source_sha256=excluded.source_sha256;
END$$;
CREATE FUNCTION gridex_registry_import.capture_route_market_v1(rid uuid,a uuid,m text,s text,rec jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE r public.platform_actor_routes%rowtype;BEGIN
 SELECT * INTO r FROM public.platform_actor_routes WHERE id=rid FOR SHARE;IF r.id IS NULL OR r.actor_id IS DISTINCT FROM a OR r.registry_market IS DISTINCT FROM m THEN RAISE EXCEPTION 'ediel_registry_route_market_source_required';END IF;
 INSERT INTO gridex_registry_import.route_market_sources VALUES(rid,a,m,s,encode(sha256(convert_to(rec::text,'UTF8')),'hex'),gridex_registry_import.route_tuple_v1(r));
 INSERT INTO gridex_registry_import.route_market_current VALUES(rid,s) ON CONFLICT(route_id) DO UPDATE SET source_sha256=excluded.source_sha256;
END$$;
CREATE OR REPLACE FUNCTION public.ediel_apply_actor_registry_v1(p_actor_user_id uuid,p_source_base64 text,p_source_sha256 text,p_source_kind text,p_source_filename text,p_records jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET timezone='UTC' AS $$
DECLARE prior gridex_registry_import.batches%rowtype; item jsonb; route jsonb; cert jsonb; ident jsonb;
 actor_row public.platform_market_actors%rowtype; route_row public.platform_actor_routes%rowtype;
 ids uuid[]; aid uuid; run_id uuid; ui_id uuid; item_id uuid; rid uuid; owner_id uuid; v_identifier_type text; v_identifier_value text;
 plan jsonb:='[]'; results jsonb:='[]'; route_ids jsonb:='[]'; issues jsonb:='[]'; normalized_hash text; v_source_hash text;
 v_created_count integer:=0;v_updated_count integer:=0;v_unchanged_count integer:=0;v_conflict_count integer:=0; before_row jsonb; after_row jsonb;
 is_new boolean; changed boolean; role text; market text; certificate_hash text; encoded_der text; v_source_bytes bytea;
BEGIN
 IF p_actor_user_id IS NULL OR public.canonical_actor_is_platform_admin(p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_platform_actor_required' USING ERRCODE='42501';END IF;
 v_source_bytes:=decode(p_source_base64,'base64');
 IF p_source_base64 IS NULL OR octet_length(v_source_bytes)>16777216 OR octet_length(v_source_bytes)=0 OR (p_source_kind IN ('companies_xml','csv')) IS NOT TRUE OR jsonb_typeof(p_records) IS DISTINCT FROM 'array' OR jsonb_array_length(p_records)<1 OR jsonb_array_length(p_records)>4096 THEN RAISE EXCEPTION 'ediel_registry_source_shape_required';END IF;
 v_source_hash:=encode(sha256(v_source_bytes),'hex'); normalized_hash:=encode(sha256(convert_to(p_records::text,'UTF8')),'hex');
 IF p_source_sha256 IS DISTINCT FROM v_source_hash THEN RAISE EXCEPTION 'ediel_registry_exact_source_hash_required';END IF;
 -- Serialize import diff and apply against the same actual actor graph. This
 -- finite administrative batch may never interleave identifier ownership.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ediel_registry_atomic_apply_v1',0));
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM u.id FROM auth.users u WHERE u.id=p_actor_user_id FOR SHARE;
 PERFORM au.user_id FROM public.admin_users au WHERE au.user_id=p_actor_user_id FOR SHARE;
 PERFORM ur.id FROM public.user_roles ur WHERE ur.user_id=p_actor_user_id FOR SHARE;
 IF public.canonical_actor_is_platform_admin(p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_platform_actor_revoked' USING ERRCODE='42501';END IF;
 SELECT * INTO prior FROM gridex_registry_import.batches WHERE source_sha256=v_source_hash FOR SHARE;
 IF FOUND THEN
  IF prior.normalized_sha256 IS DISTINCT FROM normalized_hash OR prior.source_kind IS DISTINCT FROM p_source_kind OR prior.source_bytes IS DISTINCT FROM v_source_bytes THEN RAISE EXCEPTION 'ediel_registry_source_normalization_conflict';END IF;
  RETURN prior.result||jsonb_build_object('reusedExistingRun',true);
 END IF;
 -- A historical per-row running/partial run is not proof of an atomic apply.
 IF EXISTS(SELECT FROM public.actor_registry_import_runs r WHERE r.source_hash=v_source_hash) THEN RAISE EXCEPTION 'ediel_registry_legacy_run_requires_reconciliation';END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_records) v WHERE nullif(v->>'edielId','') IS NOT NULL)<>(SELECT count(DISTINCT (v->>'edielId',v->>'market')) FROM jsonb_array_elements(p_records) v WHERE nullif(v->>'edielId','') IS NOT NULL) THEN RAISE EXCEPTION 'ediel_registry_duplicate_source_legal_identity';END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(p_records) v WHERE nullif(v->>'edielId','') IS NOT NULL GROUP BY v->>'edielId' HAVING count(DISTINCT nullif(v->>'orgNumber',''))>1) THEN RAISE EXCEPTION 'ediel_registry_source_legal_org_conflict';END IF;
 PERFORM a.id FROM public.platform_market_actors a ORDER BY a.id FOR UPDATE;
 PERFORM i.id FROM public.platform_actor_identifiers i ORDER BY i.id FOR UPDATE;
 PERFORM r.id FROM public.platform_actor_roles r ORDER BY r.id FOR UPDATE;
 PERFORM r.id FROM public.platform_actor_routes r ORDER BY r.id FOR UPDATE;
 PERFORM c.id FROM public.platform_actor_certificates c ORDER BY c.id FOR UPDATE;
 -- Complete preflight before the first actor mutation. An ambiguous strong
 -- identity or incompatible legal OrgNo rejects the entire source transaction.
 FOR item IN SELECT value FROM jsonb_array_elements(p_records) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR nullif(item->>'name','') IS NULL OR jsonb_typeof(item->'roles') IS DISTINCT FROM 'array' OR jsonb_typeof(item->'routes') IS DISTINCT FROM 'array' OR jsonb_typeof(item->'certificates') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'ediel_registry_normalized_record_required';END IF;
  aid:=NULL;actor_row:=NULL;
  IF nullif(item->>'edielId','') IS NULL OR (item->>'market' IN ('EL','GAS')) IS NOT TRUE OR nullif(item->>'countryCode','') IS NULL THEN
   plan:=plan||jsonb_build_array(item||jsonb_build_object('_held','source_legal_identity_market_country_required'));CONTINUE;
  END IF;
  SELECT array_agg(DISTINCT i.actor_id) INTO ids FROM public.platform_actor_identifiers i WHERE lower(i.identifier_type) IN ('edielid','ediel_id') AND i.identifier_value=item->>'edielId';
  IF coalesce(cardinality(ids),0)>1 THEN RAISE EXCEPTION 'ediel_registry_legal_identity_ambiguous';END IF;
  IF cardinality(ids)=1 THEN
   aid:=ids[1];SELECT * INTO STRICT actor_row FROM public.platform_market_actors a WHERE a.id=aid;
   IF nullif(actor_row.org_number,'') IS NOT NULL AND nullif(item->>'orgNumber','') IS NOT NULL AND actor_row.org_number IS DISTINCT FROM item->>'orgNumber' THEN RAISE EXCEPTION 'ediel_registry_legal_org_conflict';END IF;
  END IF;
  FOR ident IN SELECT value FROM jsonb_array_elements(jsonb_build_array(jsonb_build_object('type','EIC','value',item->>'eic'),jsonb_build_object('type','SvKId','value',item->>'svkId'))) LOOP
   IF nullif(ident->>'value','') IS NULL THEN CONTINUE;END IF;
   SELECT array_agg(DISTINCT i.actor_id) INTO ids FROM public.platform_actor_identifiers i WHERE lower(i.identifier_type)=lower(ident->>'type') AND i.identifier_value=ident->>'value';
   IF coalesce(cardinality(ids),0)>0 AND (cardinality(ids)<>1 OR aid IS NULL OR ids[1] IS DISTINCT FROM aid) THEN RAISE EXCEPTION 'ediel_registry_secondary_identifier_owner_conflict';END IF;
  END LOOP;
  FOR route IN SELECT value FROM jsonb_array_elements(item->'routes') LOOP
   IF nullif(route->>'market','') IS NOT NULL AND route->>'market' IS DISTINCT FROM item->>'market' THEN RAISE EXCEPTION 'ediel_registry_route_market_source_conflict';END IF;
   IF nullif(route->>'messageFamily','') IS NULL OR (route->>'environment' IN ('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_route_source_shape_required';END IF;
   IF nullif(route->>'partyId','') IS NULL OR nullif(route->>'interchangePartyId','') IS NULL OR nullif(route->>'communicationType','') IS NULL OR nullif(route->>'communicationAddress','') IS NULL THEN RAISE EXCEPTION 'ediel_registry_declared_transport_source_required';END IF;
  END LOOP;
  FOR cert IN SELECT value FROM jsonb_array_elements(item->'certificates') LOOP
   encoded_der:=nullif(cert->>'derBase64','');certificate_hash:=nullif(cert->>'fingerprintSha256','');
   IF encoded_der IS NOT NULL AND upper(encode(sha256(decode(encoded_der,'base64')),'hex')) IS DISTINCT FROM certificate_hash THEN RAISE EXCEPTION 'ediel_registry_certificate_exact_der_hash_required';END IF;
  END LOOP;
  plan:=plan||jsonb_build_array(item||jsonb_build_object('_actorId',aid));
 END LOOP;
 -- Fresh application must contain at least one route on a source-qualified
 -- actor. Exact immutable prior batches returned above remain untouched.
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(plan) v WHERE NOT (v ? '_held') AND jsonb_array_length(v->'routes')>0) THEN
  RAISE EXCEPTION 'ediel_registry_zero_routes_source_held'
   USING DETAIL='No source-qualified communication route can be imported. Review the source adapter and declared actor identity; no actor or import run was changed.';
 END IF;
 INSERT INTO public.actor_registry_import_runs(source,source_filename,source_hash,status,uploaded_by,total_records,metadata) VALUES(p_source_kind,p_source_filename,v_source_hash,'running',p_actor_user_id,jsonb_array_length(p_records),jsonb_build_object('atomicApplyVersion',1,'normalizedSha256',normalized_hash)) RETURNING id INTO run_id;
 INSERT INTO public.platform_actor_import_runs(source,import_type,status,records_seen,created_by,metadata) VALUES(coalesce(p_source_filename,p_source_kind),p_source_kind,'running',jsonb_array_length(p_records),p_actor_user_id,jsonb_build_object('atomicApplyVersion',1,'sourceSha256',v_source_hash,'actorRegistryImportRunId',run_id)) RETURNING id INTO ui_id;
 FOR item IN SELECT value FROM jsonb_array_elements(plan) LOOP
  market:=item->>'market'; aid:=(item->>'_actorId')::uuid;
  INSERT INTO public.actor_registry_import_items(import_run_id,raw_payload,normalized_payload,normalized_name,normalized_org_no,normalized_ediel_id,normalized_eic,roles,routes,certificates) VALUES(run_id,coalesce(item->'raw','{}'),item-'_actorId'-'_held',lower(regexp_replace(item->>'name','\s+',' ','g')),nullif(item->>'orgNumber',''),nullif(item->>'edielId',''),nullif(item->>'eic',''),ARRAY(SELECT jsonb_array_elements_text(item->'roles')),item->'routes',item->'certificates') RETURNING id INTO item_id;
  IF item ? '_held' THEN
   v_conflict_count:=v_conflict_count+1;issues:=issues||jsonb_build_array(jsonb_build_object('name',item->>'name','code',item->>'_held'));
   UPDATE public.actor_registry_import_items SET match_status='skipped',review_required=true,review_reason=item->>'_held' WHERE id=item_id;
   INSERT INTO public.platform_actor_import_issues(import_run_id,issue_type,severity,message,metadata) VALUES(ui_id,item->>'_held','blocking','Source legal Ediel identity is required; this record was staged without actor activation.',jsonb_build_object('importItemId',item_id));CONTINUE;
  END IF;
  -- Same genuine legal actor may be declared separately in EL and GAS.
  -- The second market reuses the exact actor just created in this transaction.
  IF aid IS NULL THEN SELECT i.actor_id INTO aid FROM public.platform_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=item->>'edielId';END IF;
  IF aid IS NOT NULL THEN SELECT * INTO actor_row FROM public.platform_market_actors a WHERE a.id=aid;IF nullif(actor_row.org_number,'') IS NOT NULL AND nullif(item->>'orgNumber','') IS NOT NULL AND actor_row.org_number IS DISTINCT FROM item->>'orgNumber' THEN RAISE EXCEPTION 'ediel_registry_legal_org_conflict';END IF;END IF;
  is_new:=aid IS NULL;before_row:=NULL;
  IF is_new THEN
   INSERT INTO public.platform_market_actors(name,legal_name,org_number,country_code,source,source_reference,match_status,status,visible_to_tenants,imported_at,not_seen_in_latest_import,last_seen_in_import_at,registry_import_status,metadata) VALUES(item->>'name',coalesce(item->>'legalName',item->>'name'),nullif(item->>'orgNumber',''),item->>'countryCode','xml_import',run_id::text,'strong_suggestion','active',false,now(),false,now(),'created',jsonb_build_object('market',market,'roles',item->'roles','sourceRecord',item->'raw','importRunId',run_id)) RETURNING id INTO aid;
   v_created_count:=v_created_count+1;
  ELSE
   SELECT to_jsonb(a) INTO before_row FROM public.platform_market_actors a WHERE a.id=aid;
   UPDATE public.platform_market_actors SET name=CASE WHEN market='EL' THEN item->>'name' ELSE name END,legal_name=CASE WHEN market='EL' THEN coalesce(item->>'legalName',item->>'name') ELSE legal_name END,org_number=CASE WHEN market='EL' THEN coalesce(org_number,nullif(item->>'orgNumber','')) ELSE org_number END,country_code=CASE WHEN market='EL' THEN item->>'countryCode' ELSE country_code END,source_reference=CASE WHEN market='EL' THEN run_id::text ELSE source_reference END,not_seen_in_latest_import=false,last_seen_in_import_at=now(),registry_import_status='updated',metadata=metadata||CASE WHEN market='EL' THEN jsonb_build_object('market',market,'roles',item->'roles','sourceRecord',item->'raw','importRunId',run_id) ELSE '{}'::jsonb END,visible_to_tenants=visible_to_tenants,updated_at=now() WHERE id=aid;
   SELECT to_jsonb(a) INTO after_row FROM public.platform_market_actors a WHERE a.id=aid;
   changed:=(before_row-'metadata'-'updated_at'-'source_reference'-'last_seen_in_import_at'-'registry_import_status'-'not_seen_in_latest_import') IS DISTINCT FROM (after_row-'metadata'-'updated_at'-'source_reference'-'last_seen_in_import_at'-'registry_import_status'-'not_seen_in_latest_import');
   IF changed THEN v_updated_count:=v_updated_count+1;ELSE v_unchanged_count:=v_unchanged_count+1;END IF;
  END IF;
  FOR ident IN SELECT value FROM jsonb_array_elements(jsonb_build_array(jsonb_build_object('type','EdielId','value',item->>'edielId'),jsonb_build_object('type','OrgNo','value',item->>'orgNumber'),jsonb_build_object('type','EIC','value',item->>'eic'),jsonb_build_object('type','SvKId','value',item->>'svkId'))) LOOP
   v_identifier_type:=ident->>'type';v_identifier_value:=nullif(ident->>'value','');IF v_identifier_value IS NULL THEN CONTINUE;END IF;
   owner_id:=NULL;SELECT i.actor_id INTO owner_id FROM public.platform_actor_identifiers i WHERE i.identifier_type=v_identifier_type AND i.identifier_value=v_identifier_value;
   IF owner_id IS NOT NULL AND owner_id<>aid THEN IF v_identifier_type='OrgNo' THEN CONTINUE;ELSE RAISE EXCEPTION 'ediel_registry_identifier_owner_conflict';END IF;END IF;
   INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,source,is_verified,metadata) VALUES(aid,v_identifier_type,v_identifier_value,'xml_import',p_source_kind='companies_xml',jsonb_build_object('importRunId',run_id,'sourceSha256',v_source_hash)) ON CONFLICT(identifier_type,identifier_value) DO UPDATE SET source=excluded.source,is_verified=CASE WHEN excluded.is_verified THEN true ELSE public.platform_actor_identifiers.is_verified END,metadata=public.platform_actor_identifiers.metadata||excluded.metadata,updated_at=now() WHERE public.platform_actor_identifiers.actor_id=excluded.actor_id;
  END LOOP;
  -- Missing records/roles/routes are never treated as an authenticated deletion.
  PERFORM gridex_registry_import.capture_actor_market_v1(aid,market,v_source_hash,item-'_actorId'-'_held');
  FOR role IN SELECT jsonb_array_elements_text(item->'roles') LOOP
   INSERT INTO public.platform_actor_roles(actor_id,actor_role,role_source,is_active,metadata) VALUES(aid,role,'xml_import',market='EL',jsonb_build_object('importRunId',run_id,'market',market)) ON CONFLICT(actor_id,actor_role) DO UPDATE SET role_source=excluded.role_source,is_active=excluded.is_active,metadata=public.platform_actor_roles.metadata||excluded.metadata,updated_at=now() WHERE market='EL';
  END LOOP;
  INSERT INTO public.platform_actor_aliases(actor_id,alias,alias_source,is_verified,metadata) VALUES(aid,item->>'name','xml_import',p_source_kind='companies_xml',jsonb_build_object('importRunId',run_id)) ON CONFLICT(actor_id,normalized_alias) DO NOTHING;
  FOR route IN SELECT value FROM jsonb_array_elements(item->'routes') LOOP
   -- Contradictory target for the same declared wire application is a source
   -- change, never evidence that the previously selected target remains safe.
   -- Retain both rows and all history; revoke only their readiness flags.
   UPDATE public.platform_actor_routes r SET auto_send_allowed=false,is_verified=false,status='needs_review',metadata=r.metadata||jsonb_build_object('sourceTargetConflict',true,'conflictingSourceSha256',v_source_hash,'importRunId',run_id),updated_at=now()
    WHERE r.actor_id=aid AND r.registry_market IS NOT DISTINCT FROM market AND upper(r.message_family)=upper(route->>'messageFamily') AND r.environment=route->>'environment' AND r.subaddress IS NOT DISTINCT FROM nullif(route->>'subaddress','') AND r.application_reference IS NOT DISTINCT FROM nullif(route->>'applicationReference','') AND r.communication_address IS DISTINCT FROM nullif(route->>'communicationAddress','') AND (r.auto_send_allowed OR r.is_verified OR r.status IS DISTINCT FROM 'needs_review');
   IF (SELECT count(*) FROM public.platform_actor_routes r WHERE r.actor_id=aid AND r.registry_market IS NOT DISTINCT FROM market AND upper(r.message_family)=upper(route->>'messageFamily') AND r.environment=route->>'environment' AND r.subaddress IS NOT DISTINCT FROM nullif(route->>'subaddress','') AND r.application_reference IS NOT DISTINCT FROM nullif(route->>'applicationReference','') AND r.communication_address IS NOT DISTINCT FROM nullif(route->>'communicationAddress',''))>1 THEN RAISE EXCEPTION 'ediel_registry_route_source_ambiguous';END IF;
   SELECT * INTO route_row FROM public.platform_actor_routes r WHERE r.actor_id=aid AND r.registry_market IS NOT DISTINCT FROM market AND upper(r.message_family)=upper(route->>'messageFamily') AND r.environment=route->>'environment' AND r.subaddress IS NOT DISTINCT FROM nullif(route->>'subaddress','') AND r.communication_address IS NOT DISTINCT FROM nullif(route->>'communicationAddress','') AND r.application_reference IS NOT DISTINCT FROM nullif(route->>'applicationReference','');
   rid:=route_row.id;
   IF rid IS NULL THEN
    INSERT INTO public.platform_actor_routes(actor_id,registry_market,message_family,application_reference,environment,subaddress,communication_type,communication_address,party_id,interchange_party_id,party_id_qualifier,party_id_responsible,interchange_id_qualifier,edi_charset,edi_syntax,is_verified,status,source,auto_send_allowed,metadata) VALUES(aid,market,upper(route->>'messageFamily'),nullif(route->>'applicationReference',''),route->>'environment',nullif(route->>'subaddress',''),nullif(route->>'communicationType',''),nullif(route->>'communicationAddress',''),nullif(route->>'partyId',''),nullif(route->>'interchangePartyId',''),nullif(route->>'partyIdQualifier',''),nullif(route->>'partyIdResponsible',''),nullif(route->>'interchangeIdQualifier',''),nullif(route->>'ediCharset',''),nullif(route->>'ediSyntax',''),false,CASE WHEN market='GAS' THEN 'blocked' ELSE 'needs_review' END,'xml_import',false,coalesce(route->'metadata','{}')||jsonb_build_object('importRunId',run_id,'sourceSha256',v_source_hash,'market',market,'blank_subaddress_requires_review',nullif(route->>'subaddress','') IS NULL)) RETURNING id INTO rid;
   ELSIF (route_row.application_reference,route_row.communication_type,route_row.party_id,route_row.interchange_party_id,route_row.party_id_qualifier,route_row.party_id_responsible,route_row.interchange_id_qualifier,route_row.edi_charset,route_row.edi_syntax) IS DISTINCT FROM (nullif(route->>'applicationReference',''),nullif(route->>'communicationType',''),nullif(route->>'partyId',''),nullif(route->>'interchangePartyId',''),nullif(route->>'partyIdQualifier',''),nullif(route->>'partyIdResponsible',''),nullif(route->>'interchangeIdQualifier',''),nullif(route->>'ediCharset',''),nullif(route->>'ediSyntax','')) THEN
    UPDATE public.platform_actor_routes SET application_reference=nullif(route->>'applicationReference',''),communication_type=nullif(route->>'communicationType',''),party_id=nullif(route->>'partyId',''),interchange_party_id=nullif(route->>'interchangePartyId',''),party_id_qualifier=nullif(route->>'partyIdQualifier',''),party_id_responsible=nullif(route->>'partyIdResponsible',''),interchange_id_qualifier=nullif(route->>'interchangeIdQualifier',''),edi_charset=nullif(route->>'ediCharset',''),edi_syntax=nullif(route->>'ediSyntax',''),auto_send_allowed=false,is_verified=false,status='needs_review',metadata=metadata||coalesce(route->'metadata','{}')||jsonb_build_object('importRunId',run_id,'sourceSha256',v_source_hash,'market',market),updated_at=now() WHERE id=rid;
   END IF;
   IF market='GAS' THEN UPDATE public.platform_actor_routes SET status='blocked',is_verified=false,auto_send_allowed=false WHERE id=rid AND(status IS DISTINCT FROM 'blocked' OR is_verified OR auto_send_allowed);END IF;
   PERFORM gridex_registry_import.capture_route_market_v1(rid,aid,market,v_source_hash,item-'_actorId'-'_held');
   route_ids:=route_ids||to_jsonb(rid);
  END LOOP;
  FOR cert IN SELECT value FROM jsonb_array_elements(item->'certificates') LOOP
   certificate_hash:=nullif(cert->>'fingerprintSha256','');IF certificate_hash IS NULL THEN CONTINUE;END IF;
   INSERT INTO public.platform_actor_certificates(actor_id,ediel_id,environment,purpose,certificate_type,subject,issuer,serial_number,fingerprint_sha256,valid_from,valid_to,status,source,raw_certificate_pem,metadata,last_checked_at,next_check_at) VALUES(aid,item->>'edielId',cert->>'environment',cert->>'purpose','smime',cert->>'subject',cert->>'issuer',cert->>'serialNumber',certificate_hash,(cert->>'validFrom')::timestamptz,(cert->>'validTo')::timestamptz,'unknown','xml_import',cert->>'pem',coalesce(cert->'metadata','{}')||jsonb_build_object('importRunId',run_id,'sourceSha256',v_source_hash,'issuerTrust','unverified'),now(),now()) ON CONFLICT(actor_id,environment,purpose,fingerprint_sha256) WHERE fingerprint_sha256 IS NOT NULL DO NOTHING;
  END LOOP;
  UPDATE public.actor_registry_import_items SET matched_actor_id=aid,match_status=CASE WHEN is_new THEN 'created' WHEN changed THEN 'updated' ELSE 'unchanged' END,match_reason='source_legal_ediel_identity',applied_at=now() WHERE id=item_id;
  results:=results||jsonb_build_array(jsonb_build_object('actorId',aid,'importItemId',item_id));
 END LOOP;
 UPDATE public.actor_registry_import_runs SET status=CASE WHEN v_conflict_count>0 THEN 'completed_with_warnings' ELSE 'completed' END,finished_at=now(),created_count=v_created_count,updated_count=v_updated_count,unchanged_count=v_unchanged_count,conflict_count=v_conflict_count,updated_at=now() WHERE id=run_id;
 UPDATE public.platform_actor_import_runs SET status=CASE WHEN v_conflict_count>0 THEN 'completed_with_warnings' ELSE 'completed' END,records_upserted=v_created_count+v_updated_count+v_unchanged_count,records_failed=v_conflict_count,safe=v_conflict_count=0,completed_at=now(),error_log=issues WHERE id=ui_id;
 after_row:=jsonb_build_object('importRunId',run_id,'uiRunId',ui_id,'reusedExistingRun',false,'totalRecords',jsonb_array_length(p_records),'created',v_created_count,'updated',v_updated_count,'unchanged',v_unchanged_count,'conflicts',v_conflict_count,'errors',0,'actors',results,'routeIds',route_ids,'activation','held_pending_current_source_readiness');
 INSERT INTO gridex_registry_import.batches VALUES(v_source_hash,normalized_hash,v_source_bytes,p_source_kind,p_actor_user_id,run_id,ui_id,after_row,now());
 INSERT INTO gridex_registry_import.normalized_batches(source_sha256,records) VALUES(v_source_hash,p_records);
 RETURN after_row;
END $$;
REVOKE ALL ON FUNCTION public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb) TO service_role;


CREATE FUNCTION gridex_registry_import.route_source_v1(rid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.platform_actor_routes%rowtype;own gridex_registry_import.route_market_sources%rowtype;rec gridex_registry_import.market_records%rowtype;n gridex_registry_import.normalized_batches%rowtype;b gridex_registry_import.batches%rowtype;s text;
BEGIN
 SELECT * INTO r FROM public.platform_actor_routes WHERE id=rid FOR SHARE;
 IF r.id IS NULL OR r.registry_market IS NULL THEN RETURN jsonb_build_object('status','held','routeId',rid,'reason','source_declared_registry_market_required');END IF;
 SELECT source_sha256 INTO s FROM gridex_registry_import.route_market_current WHERE route_id=r.id FOR SHARE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','held','routeId',rid,'reason','prospective_route_market_basis_required');END IF;
 SELECT * INTO own FROM gridex_registry_import.route_market_sources WHERE route_id=r.id AND source_sha256=s FOR SHARE;
 SELECT * INTO rec FROM gridex_registry_import.market_records WHERE actor_id=own.actor_id AND market=own.market AND source_sha256=own.source_sha256 FOR SHARE;
 SELECT * INTO n FROM gridex_registry_import.normalized_batches WHERE source_sha256=own.source_sha256 FOR SHARE;
 SELECT * INTO b FROM gridex_registry_import.batches WHERE source_sha256=own.source_sha256 FOR SHARE;
 IF own.route_id IS NULL OR rec.actor_id IS NULL OR b.source_sha256 IS NULL OR n.source_sha256 IS NULL OR own.actor_id IS DISTINCT FROM r.actor_id OR own.market IS DISTINCT FROM r.registry_market
  OR own.wire_tuple IS DISTINCT FROM gridex_registry_import.route_tuple_v1(r) OR rec.record_sha256 IS DISTINCT FROM own.record_sha256
  OR rec.record->>'market' IS DISTINCT FROM own.market OR nullif(rec.record->>'countryCode','') IS NULL OR rec.record->>'edielId' IS DISTINCT FROM r.party_id
  OR b.source_sha256 IS DISTINCT FROM encode(sha256(b.source_bytes),'hex') OR b.normalized_sha256 IS DISTINCT FROM encode(sha256(convert_to(n.records::text,'UTF8')),'hex')
  OR(SELECT count(*) FROM jsonb_array_elements(n.records) item WHERE item=rec.record)<>1
  OR NOT EXISTS(SELECT FROM gridex_registry_import.market_current p WHERE p.actor_id=own.actor_id AND p.market=own.market AND p.source_sha256=own.source_sha256)
  OR NOT EXISTS(SELECT FROM public.platform_actor_identifiers i WHERE i.actor_id=own.actor_id AND i.identifier_type='EdielId' AND i.identifier_value=rec.record->>'edielId') THEN
  RETURN jsonb_build_object('status','held','routeId',rid,'reason','current_exact_registry_market_source_required');END IF;
 RETURN jsonb_build_object('status','source_qualified','routeId',r.id,'actorId',r.actor_id,'market',own.market,'sourceSha256',own.source_sha256,'sourceRecordSha256',own.record_sha256,'countryCode',rec.record->>'countryCode','roles',rec.record->'roles','legalEdielId',rec.record->>'edielId','wire',own.wire_tuple);
END$$;
CREATE FUNCTION gridex_registry_import.require_el_route_v1(rid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE q jsonb;BEGIN
 q:=gridex_registry_import.route_source_v1(rid);
 IF q->>'status' IS DISTINCT FROM 'source_qualified' OR q->>'market' IS DISTINCT FROM 'EL' THEN RAISE EXCEPTION 'ediel_registry_current_el_route_source_required';END IF;RETURN q;
END$$;
CREATE FUNCTION public.ediel_registry_route_source_v1(p_route_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ediel_registry_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_registry_import.route_source_v1(p_route_id);
END$$;

CREATE FUNCTION public.ediel_verify_registry_el_actor_v1(p_actor_user_id uuid,p_actor_id uuid,p_route_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.platform_actor_routes%rowtype;q jsonb;ids uuid[]:='{}';BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ediel_registry_service_required' USING ERRCODE='42501';END IF;
 IF p_actor_user_id IS NULL OR public.canonical_actor_is_platform_admin(p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_platform_actor_required' USING ERRCODE='42501';END IF;
 PERFORM u.id FROM public.user_profiles u WHERE u.id=p_actor_user_id FOR SHARE;PERFORM u.id FROM auth.users u WHERE u.id=p_actor_user_id FOR SHARE;PERFORM a.user_id FROM public.admin_users a WHERE a.user_id=p_actor_user_id FOR SHARE;PERFORM u.id FROM public.user_roles u WHERE u.user_id=p_actor_user_id FOR SHARE;
 IF public.canonical_actor_is_platform_admin(p_actor_user_id) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_platform_actor_revoked' USING ERRCODE='42501';END IF;
 PERFORM a.id FROM public.platform_market_actors a WHERE a.id=p_actor_id FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'ediel_registry_actor_required';END IF;
 PERFORM i.id FROM public.platform_actor_identifiers i WHERE i.actor_id=p_actor_id ORDER BY i.id FOR SHARE;
 FOR r IN SELECT * FROM public.platform_actor_routes x WHERE x.actor_id=p_actor_id AND(p_route_id IS NULL OR x.id=p_route_id) ORDER BY x.id FOR UPDATE LOOP
  q:=gridex_registry_import.route_source_v1(r.id);
  IF q->>'status'='source_qualified' AND q->>'market'='EL' THEN ids:=array_append(ids,r.id);END IF;
 END LOOP;
 IF cardinality(ids)=0 OR p_route_id IS NOT NULL AND(cardinality(ids)<>1 OR ids[1] IS DISTINCT FROM p_route_id) THEN RAISE EXCEPTION 'ediel_registry_current_el_route_source_required';END IF;
 UPDATE public.platform_market_actors SET match_status='verified',visible_to_tenants=true,verified_at=clock_timestamp(),verified_by=p_actor_user_id,status='active',updated_at=clock_timestamp() WHERE id=p_actor_id;
 UPDATE public.platform_actor_routes SET status='active',is_verified=true,auto_send_allowed=false,updated_at=clock_timestamp() WHERE id=ANY(ids);
 RETURN jsonb_build_object('actorId',p_actor_id,'routeIds',ids,'market','EL','autoSendAllowed',false);
END$$;

CREATE FUNCTION gridex_registry_import.dispatch_source_v1(c uuid,communication uuid,profile uuid,env text,family text,application text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.ediel_route_profiles%rowtype;r public.communication_routes%rowtype;profile_id text;communication_id text;registry_id uuid;q jsonb;profile_wire jsonb;subaddress text;BEGIN
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
 IF q#>>'{wire,environment}' IS DISTINCT FROM env OR q#>>'{wire,family}' IS DISTINCT FROM family OR profile_wire->>'environment' IS DISTINCT FROM env
  OR profile_wire->>'message_family' IS DISTINCT FROM family OR lower(q#>>'{wire,transport}') IS DISTINCT FROM 'smtp'
  OR profile_wire->>'transport_type' IS DISTINCT FROM 'smtp' OR to_jsonb(r)->>'route_type' IS DISTINCT FROM 'ediel_partner'
  OR(env='production' AND to_jsonb(r)->>'environment_type' IS DISTINCT FROM 'production') OR(env='test' AND(to_jsonb(r)->>'environment_type' IN('tgt_test','agt_test','bilateral_test')) IS NOT TRUE)
  OR profile_wire->>'receiver_ediel_id' IS DISTINCT FROM q#>>'{wire,interchangePartyId}' OR subaddress IS DISTINCT FROM nullif(q#>>'{wire,subaddress}','')
  OR nullif(profile_wire->>'application_reference','') IS DISTINCT FROM nullif(application,'')
  OR(q#>>'{wire,applicationReference}' IS NOT NULL AND q#>>'{wire,applicationReference}' IS DISTINCT FROM application)
  OR r.target_email IS DISTINCT FROM q#>>'{wire,address}' THEN RAISE EXCEPTION 'ediel_registry_route_dispatch_source_mismatch';END IF;
 RETURN q||jsonb_build_object('companyId',c,'communicationRouteId',r.id,'routeProfileId',p.id,'selectedApplicationReference',application);
END$$;
CREATE FUNCTION public.ediel_registry_dispatch_source_v1(p_company_id uuid,p_communication_route_id uuid,p_route_profile_id uuid,p_environment text,p_message_family text,p_application_reference text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user<>'service_role' THEN RAISE EXCEPTION 'ediel_registry_service_required' USING ERRCODE='42501';END IF;
 RETURN gridex_registry_import.dispatch_source_v1(p_company_id,p_communication_route_id,p_route_profile_id,p_environment,p_message_family,p_application_reference);
END$$;
CREATE FUNCTION gridex_registry_import.require_message_market_v1(c uuid,mid uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m public.ediel_messages%rowtype;q jsonb;tokens jsonb;unb jsonb;unh jsonb;receiver_legal jsonb;BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=mid AND company_id=c FOR SHARE;
 IF m.id IS NULL THEN RAISE EXCEPTION 'ediel_registry_message_scope_required';END IF;
 IF m.direction IS DISTINCT FROM 'outbound' OR(m.message_family IN('PRODAT','UTILTS','AI')) IS NOT TRUE OR m.message_code='ERR' THEN RETURN NULL;END IF;
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
ALTER FUNCTION gridex_ediel_readiness.capture(uuid,uuid,uuid,text,text,text,text,uuid,text,text) RENAME TO capture_before_registry_markets_v1;
CREATE FUNCTION gridex_ediel_readiness.capture(p_company_id uuid,p_message_id uuid,p_legal_actor_id uuid,p_actor_role text,p_family text,p_code text,p_subtype text,p_assignment_id uuid,p_release_sha text,p_rulepack_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;q jsonb;deps jsonb;BEGIN
 result:=gridex_ediel_readiness.capture_before_registry_markets_v1(p_company_id,p_message_id,p_legal_actor_id,p_actor_role,p_family,p_code,p_subtype,p_assignment_id,p_release_sha,p_rulepack_hash);
 q:=gridex_registry_import.require_message_market_v1(p_company_id,p_message_id);
 IF q IS NULL THEN RETURN result;END IF;
 deps:=(result->'dependencies')||jsonb_build_object('sourceQualifiedRegistryMarket',q);
 RETURN result||jsonb_build_object('dependencies',deps,'dependencyHash',encode(sha256(convert_to(jsonb_build_object('scope',result->'scope','dependencies',deps)::text,'UTF8')),'hex'));
END$$;
ALTER FUNCTION gridex_ediel_transport.mutate_v1(jsonb) RENAME TO mutate_before_registry_markets_v1;
CREATE FUNCTION gridex_ediel_transport.mutate_v1(input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;BEGIN
 result:=gridex_ediel_transport.mutate_before_registry_markets_v1(input);
 IF(input->>'action' IN('prepare','enter')) IS TRUE AND result->>'proceed'='true' THEN PERFORM gridex_registry_import.require_message_market_v1((input->>'companyId')::uuid,(input->>'messageId')::uuid);END IF;
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION gridex_registry_import.route_tuple_v1(public.platform_actor_routes),gridex_registry_import.capture_actor_market_v1(uuid,text,text,jsonb),gridex_registry_import.capture_route_market_v1(uuid,uuid,text,text,jsonb),gridex_registry_import.route_source_v1(uuid),gridex_registry_import.require_el_route_v1(uuid),gridex_registry_import.require_message_market_v1(uuid,uuid),gridex_registry_import.dispatch_source_v1(uuid,uuid,uuid,text,text,text),gridex_ediel_readiness.capture_before_registry_markets_v1(uuid,uuid,uuid,text,text,text,text,uuid,text,text),gridex_ediel_readiness.capture(uuid,uuid,uuid,text,text,text,text,uuid,text,text),gridex_ediel_transport.mutate_before_registry_markets_v1(jsonb),gridex_ediel_transport.mutate_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ediel_registry_route_source_v1(uuid),public.ediel_verify_registry_el_actor_v1(uuid,uuid,uuid),public.ediel_registry_dispatch_source_v1(uuid,uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ediel_registry_route_source_v1(uuid),public.ediel_verify_registry_el_actor_v1(uuid,uuid,uuid),public.ediel_registry_dispatch_source_v1(uuid,uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION gridex_ediel_transport.mutate_v1(jsonb) TO service_role;
COMMIT;
