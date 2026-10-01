-- Prospective atomic source apply. No legal mandate, deletion history,
-- certificate trust or market activation is inferred from a registry import.
CREATE SCHEMA gridex_registry_import;
REVOKE ALL ON SCHEMA gridex_registry_import FROM PUBLIC,anon,authenticated;
CREATE TABLE gridex_registry_import.batches(
 source_sha256 text PRIMARY KEY CHECK(source_sha256~'^[0-9a-f]{64}$'),
 normalized_sha256 text NOT NULL CHECK(normalized_sha256~'^[0-9a-f]{64}$'),
 source_bytes bytea NOT NULL,source_kind text NOT NULL CHECK(source_kind IN ('companies_xml','csv')),
 actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
 import_run_id uuid NOT NULL UNIQUE REFERENCES public.actor_registry_import_runs(id) ON DELETE RESTRICT,
 ui_run_id uuid NOT NULL UNIQUE REFERENCES public.platform_actor_import_runs(id) ON DELETE RESTRICT,
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE gridex_registry_import.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE gridex_registry_import.batches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON gridex_registry_import.batches FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION gridex_registry_import.immutable_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'ediel_registry_source_batch_immutable';END $$;
REVOKE ALL ON FUNCTION gridex_registry_import.immutable_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER registry_batch_immutable BEFORE UPDATE OR DELETE ON gridex_registry_import.batches FOR EACH ROW EXECUTE FUNCTION gridex_registry_import.immutable_v1();
CREATE TRIGGER registry_batch_no_truncate BEFORE TRUNCATE ON gridex_registry_import.batches FOR EACH STATEMENT EXECUTE FUNCTION gridex_registry_import.immutable_v1();

CREATE FUNCTION public.ediel_apply_actor_registry_v1(p_actor_user_id uuid,p_source_base64 text,p_source_sha256 text,p_source_kind text,p_source_filename text,p_records jsonb) RETURNS jsonb
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
 IF (SELECT count(*) FROM jsonb_array_elements(p_records) v WHERE nullif(v->>'edielId','') IS NOT NULL)<>(SELECT count(DISTINCT v->>'edielId') FROM jsonb_array_elements(p_records) v WHERE nullif(v->>'edielId','') IS NOT NULL) THEN RAISE EXCEPTION 'ediel_registry_duplicate_source_legal_identity';END IF;
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
   IF nullif(route->>'messageFamily','') IS NULL OR (route->>'environment' IN ('test','production')) IS NOT TRUE THEN RAISE EXCEPTION 'ediel_registry_route_source_shape_required';END IF;
  END LOOP;
  FOR cert IN SELECT value FROM jsonb_array_elements(item->'certificates') LOOP
   encoded_der:=nullif(cert->>'derBase64','');certificate_hash:=nullif(cert->>'fingerprintSha256','');
   IF encoded_der IS NOT NULL AND upper(encode(sha256(decode(encoded_der,'base64')),'hex')) IS DISTINCT FROM certificate_hash THEN RAISE EXCEPTION 'ediel_registry_certificate_exact_der_hash_required';END IF;
  END LOOP;
  plan:=plan||jsonb_build_array(item||jsonb_build_object('_actorId',aid));
 END LOOP;
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
  is_new:=aid IS NULL;before_row:=NULL;
  IF is_new THEN
   INSERT INTO public.platform_market_actors(name,legal_name,org_number,country_code,source,source_reference,match_status,status,visible_to_tenants,imported_at,not_seen_in_latest_import,last_seen_in_import_at,registry_import_status,metadata) VALUES(item->>'name',coalesce(item->>'legalName',item->>'name'),nullif(item->>'orgNumber',''),item->>'countryCode','xml_import',run_id::text,'strong_suggestion','active',false,now(),false,now(),'created',jsonb_build_object('market',market,'roles',item->'roles','sourceRecord',item->'raw','importRunId',run_id)) RETURNING id INTO aid;
   v_created_count:=v_created_count+1;
  ELSE
   SELECT to_jsonb(a) INTO before_row FROM public.platform_market_actors a WHERE a.id=aid;
   UPDATE public.platform_market_actors SET name=item->>'name',legal_name=coalesce(item->>'legalName',item->>'name'),org_number=coalesce(org_number,nullif(item->>'orgNumber','')),source_reference=run_id::text,not_seen_in_latest_import=false,last_seen_in_import_at=now(),registry_import_status='updated',metadata=metadata||jsonb_build_object('market',market,'roles',item->'roles','sourceRecord',item->'raw','importRunId',run_id),visible_to_tenants=CASE WHEN market='EL' THEN visible_to_tenants ELSE false END,updated_at=now() WHERE id=aid;
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
  FOR role IN SELECT jsonb_array_elements_text(item->'roles') LOOP
   INSERT INTO public.platform_actor_roles(actor_id,actor_role,role_source,is_active,metadata) VALUES(aid,role,'xml_import',market='EL',jsonb_build_object('importRunId',run_id,'market',market)) ON CONFLICT(actor_id,actor_role) DO UPDATE SET role_source=excluded.role_source,is_active=excluded.is_active,metadata=public.platform_actor_roles.metadata||excluded.metadata,updated_at=now();
  END LOOP;
  INSERT INTO public.platform_actor_aliases(actor_id,alias,alias_source,is_verified,metadata) VALUES(aid,item->>'name','xml_import',p_source_kind='companies_xml',jsonb_build_object('importRunId',run_id)) ON CONFLICT(actor_id,normalized_alias) DO NOTHING;
  FOR route IN SELECT value FROM jsonb_array_elements(item->'routes') LOOP
   SELECT * INTO route_row FROM public.platform_actor_routes r WHERE r.actor_id=aid AND upper(r.message_family)=upper(route->>'messageFamily') AND r.environment=route->>'environment' AND r.subaddress IS NOT DISTINCT FROM nullif(route->>'subaddress','') AND r.communication_address IS NOT DISTINCT FROM nullif(route->>'communicationAddress','');
   rid:=route_row.id;
   IF rid IS NULL THEN
    INSERT INTO public.platform_actor_routes(actor_id,message_family,application_reference,environment,subaddress,communication_type,communication_address,party_id,interchange_party_id,party_id_qualifier,party_id_responsible,interchange_id_qualifier,edi_charset,edi_syntax,is_verified,status,source,auto_send_allowed,metadata) VALUES(aid,upper(route->>'messageFamily'),nullif(route->>'applicationReference',''),route->>'environment',nullif(route->>'subaddress',''),nullif(route->>'communicationType',''),nullif(route->>'communicationAddress',''),nullif(route->>'partyId',''),nullif(route->>'interchangePartyId',''),nullif(route->>'partyIdQualifier',''),nullif(route->>'partyIdResponsible',''),nullif(route->>'interchangeIdQualifier',''),nullif(route->>'ediCharset',''),nullif(route->>'ediSyntax',''),false,'needs_review','xml_import',false,coalesce(route->'metadata','{}')||jsonb_build_object('importRunId',run_id,'sourceSha256',v_source_hash,'market',market,'blank_subaddress_requires_review',nullif(route->>'subaddress','') IS NULL)) RETURNING id INTO rid;
   ELSIF (route_row.application_reference,route_row.communication_type,route_row.party_id,route_row.interchange_party_id,route_row.party_id_qualifier,route_row.party_id_responsible,route_row.interchange_id_qualifier,route_row.edi_charset,route_row.edi_syntax) IS DISTINCT FROM (nullif(route->>'applicationReference',''),nullif(route->>'communicationType',''),nullif(route->>'partyId',''),nullif(route->>'interchangePartyId',''),nullif(route->>'partyIdQualifier',''),nullif(route->>'partyIdResponsible',''),nullif(route->>'interchangeIdQualifier',''),nullif(route->>'ediCharset',''),nullif(route->>'ediSyntax','')) THEN
    UPDATE public.platform_actor_routes SET application_reference=nullif(route->>'applicationReference',''),communication_type=nullif(route->>'communicationType',''),party_id=nullif(route->>'partyId',''),interchange_party_id=nullif(route->>'interchangePartyId',''),party_id_qualifier=nullif(route->>'partyIdQualifier',''),party_id_responsible=nullif(route->>'partyIdResponsible',''),interchange_id_qualifier=nullif(route->>'interchangeIdQualifier',''),edi_charset=nullif(route->>'ediCharset',''),edi_syntax=nullif(route->>'ediSyntax',''),auto_send_allowed=false,is_verified=false,status='needs_review',metadata=metadata||coalesce(route->'metadata','{}')||jsonb_build_object('importRunId',run_id,'sourceSha256',v_source_hash,'market',market),updated_at=now() WHERE id=rid;
   END IF;
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
 RETURN after_row;
END $$;
REVOKE ALL ON FUNCTION public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ediel_apply_actor_registry_v1(uuid,text,text,text,text,jsonb) TO service_role;
