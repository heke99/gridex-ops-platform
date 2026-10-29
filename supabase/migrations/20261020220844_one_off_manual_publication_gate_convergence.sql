-- Converge only the observed native one-off permission gap to the existing
-- canonical implementation. Manual bacc -> dbf inserts exactly579 UTF8 bytes;
-- publisher0ec -> e65e changes only the existing permission gate. One atomic DO
-- installs manual first and publisher last, with exact full-source/header/ACL
-- prerequisites and final catalog preservation. Complete canonical POST is a
-- true no-op. Unknown/mixed states STOP. No business calls/data/grants/history.
-- Receiving order: THIS forward BEFORE any separately qualified F57 ensure
-- change; only the observed canonical fcb ensure dependency is accepted here.
DO $one_off_gate_convergence$
DECLARE
 profiles constant jsonb:=$profiles$[{"name":"gridex_assert_contract_permission","signature":"public.gridex_assert_contract_permission(uuid, text)","types":"uuid, text","args":["p_actor_user_id","p_permission"],"defaults":0,"defaultsHash":null,"result":"void","language":"plpgsql","securityDefiner":true,"volatility":"v","config":["search_path=public, auth, pg_temp"],"hash":"4d842e5cb0a2903a08b718eb34826e08e294c766a7295410a46bc178135cbcb8","acl":[["postgres","postgres","EXECUTE",false],["service_role","postgres","EXECUTE",false]]},{"name":"gridex_contract_readiness_blocker_v2","signature":"public.gridex_contract_readiness_blocker_v2(text, text, text, jsonb, text, uuid, jsonb)","types":"text, text, text, jsonb, text, uuid, jsonb","args":["p_code","p_field","p_message","p_current_value","p_resource_type","p_resource_id","p_metadata"],"defaults":4,"defaultsHash":"c32b4761412fd5818d44083d80941e5dc6305859ca496086d51238b19d08800a","result":"jsonb","language":"sql","securityDefiner":false,"volatility":"i","config":["search_path=public, pg_temp"],"hash":"e27ad22e353254369cab98dae37fc42b27eda9a2b9626272dcb710d4506708c6","acl":[["authenticated","postgres","EXECUTE",false],["postgres","postgres","EXECUTE",false],["service_role","postgres","EXECUTE",false]]},{"name":"gridex_create_or_version_contract_pricing","signature":"public.gridex_create_or_version_contract_pricing(uuid, text, text, text, text, jsonb, date, date, boolean, uuid)","types":"uuid, text, text, text, text, jsonb, date, date, boolean, uuid","args":["p_company_id","p_plan_name","p_contract_type","p_pricing_model","p_customer_type","p_snapshot","p_valid_from","p_valid_to","p_publish","p_actor_user_id"],"defaults":4,"defaultsHash":"256ce60302569e560973581355ad6c708bd79537c551d080a100066fa082c823","result":"jsonb","language":"plpgsql","securityDefiner":true,"volatility":"v","config":["search_path=public, extensions, pg_temp"],"hash":"d96198cf05057aede63a12e923c6186d0f4c70a4799a48e9b87846020693d9d7","acl":[["postgres","postgres","EXECUTE",false],["service_role","postgres","EXECUTE",false]]},{"name":"gridex_ensure_internal_contract_publication","signature":"public.gridex_ensure_internal_contract_publication(uuid, uuid, uuid)","types":"uuid, uuid, uuid","args":["p_company_id","p_contract_offer_id","p_actor_user_id"],"defaults":1,"defaultsHash":"4385a67c7204ff8b2cea0aeef7c4f7a7396230440bad0ad1ec2d0bbe91018a56","result":"uuid","language":"plpgsql","securityDefiner":true,"volatility":"v","config":["search_path=public, extensions, pg_temp"],"hash":"fcb963b3d282b1f886cbbc5c90c35b34d8d4647c0f4e4e6d6330a55314659984","acl":[["postgres","postgres","EXECUTE",false],["service_role","postgres","EXECUTE",false]]},{"name":"gridex_prepare_manual_contract_binding","signature":"public.gridex_prepare_manual_contract_binding(uuid, jsonb, jsonb, uuid)","types":"uuid, jsonb, jsonb, uuid","args":["p_company_id","p_payload","p_pricing_snapshot","p_actor_user_id"],"defaults":1,"defaultsHash":"4385a67c7204ff8b2cea0aeef7c4f7a7396230440bad0ad1ec2d0bbe91018a56","result":"jsonb","language":"plpgsql","securityDefiner":true,"volatility":"v","config":["search_path=public, pg_temp"],"hash":"baccd65df7e303df26aef3516ad8bf7e5faf42d380dd1bae6bcc8205c50ca5ec","acl":[["postgres","postgres","EXECUTE",false],["service_role","postgres","EXECUTE",false]]},{"name":"gridex_publish_internal_contract_version","signature":"public.gridex_publish_internal_contract_version(uuid, uuid, uuid)","types":"uuid, uuid, uuid","args":["p_company_id","p_offer_id","p_actor_user_id"],"defaults":0,"defaultsHash":null,"result":"jsonb","language":"plpgsql","securityDefiner":true,"volatility":"v","config":["search_path=public, pg_temp"],"hash":"0ec83ae81a9c66c97cdfdb90237acf913d7adbe7326e7fd01de59e690962dd4c","acl":[["postgres","postgres","EXECUTE",false],["service_role","postgres","EXECUTE",false]]},{"name":"gridex_sync_internal_offer_to_canonical","signature":"public.gridex_sync_internal_offer_to_canonical(uuid)","types":"uuid","args":["p_offer_id"],"defaults":0,"defaultsHash":null,"result":"uuid","language":"plpgsql","securityDefiner":true,"volatility":"v","config":["search_path=public, extensions, pg_catalog, pg_temp"],"hash":"a14bafb58ec5e487b6b7c24cb10217ccd669ead807b3d91ae29e06c2a139886d","acl":[["postgres","postgres","EXECUTE",false],["service_role","postgres","EXECUTE",false]]},{"name":"gridex_upsert_internal_contract_offer","signature":"public.gridex_upsert_internal_contract_offer(uuid, uuid, jsonb, jsonb, uuid)","types":"uuid, uuid, jsonb, jsonb, uuid","args":["p_company_id","p_offer_id","p_payload","p_pricing_snapshot","p_actor_user_id"],"defaults":0,"defaultsHash":null,"result":"jsonb","language":"plpgsql","securityDefiner":true,"volatility":"v","config":["search_path=public, pg_temp"],"hash":"7e37e58fdaa9d32471e27de9033a8cbac5b6e4574b7c5d47ec2d7a17f22c2f79","acl":[["postgres","postgres","EXECUTE",false]]},{"name":"gridex_validate_contract_readiness_v2","signature":"public.gridex_validate_contract_readiness_v2(uuid, uuid, text, text)","types":"uuid, uuid, text, text","args":["p_company_id","p_contract_offer_id","p_operation","p_channel"],"defaults":1,"defaultsHash":"79d73f5cebbe6c19dca63a8c137158712c447b59ea705adb7b189c0d80ecc6cf","result":"jsonb","language":"plpgsql","securityDefiner":true,"volatility":"s","config":["search_path=public, auth, pg_temp"],"hash":"baa6718147ed18243630b27b1cf0d2d694691e4c7e238a097c419d68932994ce","acl":[["postgres","postgres","EXECUTE",false],["service_role","postgres","EXECUTE",false]]}]$profiles$::jsonb;
 columns_expected constant jsonb:=$columns${"publish_authorizations":[{"attnum":1,"name":"offer_id","type":"uuid","notnull":true,"identity":"","generated":"","dropped":false,"default":null},{"attnum":2,"name":"company_id","type":"uuid","notnull":true,"identity":"","generated":"","dropped":false,"default":null},{"attnum":3,"name":"actor_user_id","type":"uuid","notnull":false,"identity":"","generated":"","dropped":false,"default":null},{"attnum":4,"name":"txid","type":"bigint","notnull":true,"identity":"","generated":"","dropped":false,"default":null}],"reservations":[{"attnum":1,"name":"offer_id","type":"uuid","notnull":true,"identity":"","generated":"","dropped":false,"default":null},{"attnum":2,"name":"company_id","type":"uuid","notnull":true,"identity":"","generated":"","dropped":false,"default":null},{"attnum":3,"name":"created_at","type":"timestamp with time zone","notnull":true,"identity":"","generated":"","dropped":false,"default":"28a4dae0461e17af56e979c2095abfbe0bfc45fe9ca8abf3144338a518a1bb8f"},{"attnum":4,"name":"intended_contract_id","type":"uuid","notnull":false,"identity":"","generated":"","dropped":false,"default":null},{"attnum":5,"name":"consumed_contract_id","type":"uuid","notnull":false,"identity":"","generated":"","dropped":false,"default":null},{"attnum":6,"name":"consumed_at","type":"timestamp with time zone","notnull":false,"identity":"","generated":"","dropped":false,"default":null}]}$columns$::jsonb;
 constraints_expected constant jsonb:=$constraints${"publish_authorizations":[{"name":"publish_authorizations_offer_id_fkey","type":"f","validated":true,"deferrable":false,"deferred":false,"definition":"FOREIGN KEY (offer_id) REFERENCES public.contract_offers(id) ON DELETE CASCADE"},{"name":"publish_authorizations_pkey","type":"p","validated":true,"deferrable":false,"deferred":false,"definition":"PRIMARY KEY (offer_id)"}],"reservations":[{"name":"reservations_company_id_fkey","type":"f","validated":true,"deferrable":false,"deferred":false,"definition":"FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE"},{"name":"reservations_consumed_by_intended","type":"c","validated":true,"deferrable":false,"deferred":false,"definition":"CHECK (intended_contract_id IS NULL OR consumed_contract_id IS NULL OR consumed_contract_id = intended_contract_id)"},{"name":"reservations_consumed_contract_id_fkey","type":"f","validated":true,"deferrable":true,"deferred":true,"definition":"FOREIGN KEY (consumed_contract_id) REFERENCES public.customer_contracts(id) ON UPDATE RESTRICT ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED"},{"name":"reservations_consumption_coherent","type":"c","validated":true,"deferrable":false,"deferred":false,"definition":"CHECK ((consumed_contract_id IS NULL) = (consumed_at IS NULL))"},{"name":"reservations_offer_id_fkey","type":"f","validated":true,"deferrable":false,"deferred":false,"definition":"FOREIGN KEY (offer_id) REFERENCES public.contract_offers(id) ON DELETE CASCADE"},{"name":"reservations_pkey","type":"p","validated":true,"deferrable":false,"deferred":false,"definition":"PRIMARY KEY (offer_id)"}]}$constraints$::jsonb;
 before_gate constant text:=$before_gate$  -- Staff who may create contracts may sell a one-off contract without the
  -- catalog publish rights: authorize exactly this new offer, for this actor,
  -- in this transaction, and withdraw the authorization right after.
  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.create');
  insert into gridex_one_off_offer_binding.publish_authorizations(offer_id,company_id,actor_user_id,txid)
  values (v_offer_id,p_company_id,p_actor_user_id,txid_current());
$before_gate$;
 after_gate constant text:=$after_gate$  delete from gridex_one_off_offer_binding.publish_authorizations where offer_id=v_offer_id;
$after_gate$;
 call_anchor constant text:=$call_anchor$  v_published := public.gridex_publish_internal_contract_version(
    p_company_id,v_offer_id,p_actor_user_id
  );
$call_anchor$;
 publisher_before constant text:=$publisher_before$  perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.publish');
  perform public.gridex_assert_contract_permission(p_actor_user_id,'pricing.publish');
$publisher_before$;
 publisher_after constant text:=$publisher_after$  -- Owner decision 2026-10-11: a one-off offer created by the manual-binding
  -- materializer in this same transaction is published under the creator's
  -- contracts.create right, which the materializer asserts. Every other
  -- publish keeps the catalog publish rights.
  if not exists (
    select 1 from gridex_one_off_offer_binding.publish_authorizations a
    where a.offer_id=p_offer_id and a.company_id=p_company_id
      and a.actor_user_id is not distinct from p_actor_user_id
      and a.txid=txid_current()
  ) then
    perform public.gridex_assert_contract_permission(p_actor_user_id,'contracts.publish');
    perform public.gridex_assert_contract_permission(p_actor_user_id,'pricing.publish');
  end if;
$publisher_after$;
 profile jsonb; f pg_catalog.pg_proc%rowtype; c pg_catalog.pg_class%rowtype;
 fk pg_catalog.pg_constraint%rowtype; t pg_catalog.pg_trigger%rowtype;
 namespace_oid oid; rel oid; target_manual oid; target_publisher oid;
 source_manual text; source_publisher text; desired_manual text; desired_publisher text;
 hash_manual text; hash_publisher text; ddl text; actual jsonb; expected jsonb;
 state_pre boolean; state_post boolean; before_catalog jsonb; after_catalog jsonb;
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres'
 OR pg_catalog.current_setting('server_version_num')::integer<170000
 OR pg_catalog.current_setting('server_version_num')::integer>=180000
 THEN RAISE EXCEPTION 'one_off_gate_convergence_pg17_postgres_required' USING ERRCODE='55000';END IF;
 PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
 PERFORM pg_catalog.set_config('lock_timeout','5s',true);
 PERFORM pg_catalog.set_config('statement_timeout','60s',true);
 -- Ordinary catalog SELECT only; delivery owner serializes all DDL. No catalog
 -- row lock, temporary ownership bridge, capability grant or caller rewrite.
 FOR profile IN SELECT value FROM pg_catalog.jsonb_array_elements(profiles) LOOP
  SELECT p.* INTO f FROM pg_catalog.pg_proc p WHERE p.oid=pg_catalog.to_regprocedure(profile->>'signature');
  IF NOT FOUND THEN RAISE EXCEPTION 'one_off_gate_convergence_existing_function_required' USING ERRCODE='55000';END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname=profile->>'name')<>1
  OR f.proowner<>pg_catalog.to_regrole('postgres')::oid
  OR pg_catalog.oidvectortypes(f.proargtypes) IS DISTINCT FROM profile->>'types'
  OR f.proargnames IS DISTINCT FROM ARRAY(SELECT pg_catalog.jsonb_array_elements_text(profile->'args'))
  OR f.pronargs<>pg_catalog.jsonb_array_length(profile->'args')
  OR f.proallargtypes IS NOT NULL OR f.proargmodes IS NOT NULL
  OR f.pronargdefaults<>(profile->>'defaults')::integer
  OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_expr(f.proargdefaults,0),'UTF8')),'hex') IS DISTINCT FROM profile->>'defaultsHash'
  OR f.provariadic<>0 OR f.prorettype<>(profile->>'result')::regtype OR f.proretset
  OR f.prokind<>'f' OR f.prosecdef IS DISTINCT FROM (profile->>'securityDefiner')::boolean
  OR f.provolatile::text IS DISTINCT FROM profile->>'volatility'
  OR f.proparallel<>'u' OR f.proisstrict OR f.proleakproof
  OR (SELECT l.lanname FROM pg_catalog.pg_language l WHERE l.oid=f.prolang) IS DISTINCT FROM profile->>'language'
  OR f.proconfig IS DISTINCT FROM ARRAY(SELECT pg_catalog.jsonb_array_elements_text(profile->'config'))
  OR f.procost<>100 OR f.prorows<>0 OR f.prosupport<>0
  OR f.protrftypes IS NOT NULL OR f.probin IS NOT NULL OR f.prosqlbody IS NOT NULL
  THEN RAISE EXCEPTION 'one_off_gate_convergence_full_header_required:%',profile->>'name' USING ERRCODE='55000';END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
   CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
   pg_catalog.pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable)
   ORDER BY CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
   pg_catalog.pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable) INTO actual
  FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a;
  IF actual IS DISTINCT FROM profile->'acl' THEN RAISE EXCEPTION 'one_off_gate_convergence_exact_acl_required:%',profile->>'name' USING ERRCODE='55000';END IF;
  IF f.proname='gridex_prepare_manual_contract_binding' THEN
   target_manual:=f.oid;source_manual:=f.prosrc;
  ELSIF f.proname='gridex_publish_internal_contract_version' THEN
   target_publisher:=f.oid;source_publisher:=f.prosrc;
  ELSIF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(f.prosrc,'UTF8')),'hex') IS DISTINCT FROM profile->>'hash'
  THEN RAISE EXCEPTION 'one_off_gate_convergence_exact_dependency_required:%',profile->>'name' USING ERRCODE='55000';END IF;
 END LOOP;
 hash_manual:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source_manual,'UTF8')),'hex');
 hash_publisher:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source_publisher,'UTF8')),'hex');
 state_pre:=hash_manual='baccd65df7e303df26aef3516ad8bf7e5faf42d380dd1bae6bcc8205c50ca5ec'
  AND hash_publisher='0ec83ae81a9c66c97cdfdb90237acf913d7adbe7326e7fd01de59e690962dd4c';
 state_post:=hash_manual='dbf492dbb0887519d2683a2442aca9b5c51dfcaf74899fb6ea26a398176b745a'
  AND hash_publisher='e65e9f046b558512e00a89622f5fdffe888dee5a57072982ee4a01292192732a';
 IF NOT (state_pre OR state_post) THEN RAISE EXCEPTION 'one_off_gate_convergence_exact_complete_pair_required' USING ERRCODE='55000';END IF;
 namespace_oid:=pg_catalog.to_regnamespace('gridex_one_off_offer_binding');
 IF namespace_oid IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n WHERE n.oid=namespace_oid
  AND n.nspowner='postgres'::regrole)
 OR EXISTS(SELECT 1 FROM pg_catalog.pg_namespace n,
  LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a
  WHERE n.oid=namespace_oid AND(a.grantee<>'postgres'::regrole OR a.grantor<>'postgres'::regrole OR a.is_grantable))
 OR (SELECT count(*) FROM pg_catalog.pg_namespace n,
  LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a WHERE n.oid=namespace_oid)<>2
 THEN RAISE EXCEPTION 'one_off_gate_convergence_private_schema_required' USING ERRCODE='55000';END IF;
 FOR profile IN SELECT pg_catalog.jsonb_build_object('name',n) FROM pg_catalog.unnest(ARRAY['publish_authorizations','reservations'])n LOOP
  rel:=pg_catalog.to_regclass('gridex_one_off_offer_binding.'||(profile->>'name'));
  SELECT q.* INTO c FROM pg_catalog.pg_class q WHERE q.oid=rel;
  IF NOT FOUND OR c.relnamespace<>namespace_oid OR c.relkind<>'r' OR c.relpersistence<>'p'
  OR c.relowner<>'postgres'::regrole OR c.relrowsecurity OR c.relforcerowsecurity
  OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid=rel)
  OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner)))a
    WHERE a.grantee<>'postgres'::regrole OR a.grantor<>'postgres'::regrole OR a.is_grantable)
  OR (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))))<>8
  THEN RAISE EXCEPTION 'one_off_gate_convergence_private_table_required:%',profile->>'name' USING ERRCODE='55000';END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('attnum',a.attnum,'name',a.attname,
    'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,
    'identity',a.attidentity,'generated',a.attgenerated,'dropped',a.attisdropped,
    'default',pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'UTF8')),'hex'))ORDER BY a.attnum)
  INTO actual FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=rel AND a.attnum>0;
  IF actual IS DISTINCT FROM columns_expected->(profile->>'name')
  THEN RAISE EXCEPTION 'one_off_gate_convergence_private_columns_required:%',profile->>'name' USING ERRCODE='55000';END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name',q.conname,'type',q.contype,
   'validated',q.convalidated,'deferrable',q.condeferrable,'deferred',q.condeferred,
   'definition',pg_catalog.pg_get_constraintdef(q.oid,true)) ORDER BY q.conname) INTO actual
  FROM pg_catalog.pg_constraint q WHERE q.conrelid=rel;
  IF actual IS DISTINCT FROM constraints_expected->(profile->>'name')
  THEN RAISE EXCEPTION 'one_off_gate_convergence_private_constraints_required:%',profile->>'name' USING ERRCODE='55000';END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_index i WHERE i.indrelid=rel)<>1
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ix ON ix.oid=i.indexrelid
   WHERE i.indrelid=rel AND i.indisprimary AND i.indisunique AND i.indisvalid AND i.indisready
   AND i.indislive AND i.indimmediate AND i.indnkeyatts=1 AND i.indnatts=1 AND i.indkey[0]=1
   AND i.indexprs IS NULL AND i.indpred IS NULL AND ix.relam=(SELECT oid FROM pg_catalog.pg_am WHERE amname='btree'))
  THEN RAISE EXCEPTION 'one_off_gate_convergence_private_index_required:%',profile->>'name' USING ERRCODE='55000';END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_trigger x WHERE x.tgrelid=rel)<>
   2*(SELECT count(*) FROM pg_catalog.pg_constraint q WHERE q.conrelid=rel AND q.contype='f')
  THEN RAISE EXCEPTION 'one_off_gate_convergence_private_triggers_required:%',profile->>'name' USING ERRCODE='55000';END IF;
  FOR fk IN SELECT q.* FROM pg_catalog.pg_constraint q WHERE q.conrelid=rel AND q.contype='f' LOOP
   IF (SELECT count(*) FROM pg_catalog.pg_trigger x WHERE x.tgrelid=rel AND x.tgconstraint=fk.oid)<>2
   THEN RAISE EXCEPTION 'one_off_gate_convergence_private_ri_pair_required' USING ERRCODE='55000';END IF;
   FOR t IN SELECT x.* FROM pg_catalog.pg_trigger x WHERE x.tgrelid=rel AND x.tgconstraint=fk.oid LOOP
    IF NOT t.tgisinternal OR t.tgenabled<>'O' OR t.tgconstrrelid<>fk.confrelid
    OR t.tgdeferrable IS DISTINCT FROM fk.condeferrable OR t.tginitdeferred IS DISTINCT FROM fk.condeferred
    OR t.tgnargs<>0 OR pg_catalog.octet_length(t.tgargs)<>0 OR t.tgattr::text<>'' OR t.tgqual IS NOT NULL
    OR t.tgoldtable IS NOT NULL OR t.tgnewtable IS NOT NULL
    OR NOT((t.tgtype=5 AND t.tgfoid='pg_catalog."RI_FKey_check_ins"()'::regprocedure)
      OR(t.tgtype=17 AND t.tgfoid='pg_catalog."RI_FKey_check_upd"()'::regprocedure))
    THEN RAISE EXCEPTION 'one_off_gate_convergence_private_ri_shape_required' USING ERRCODE='55000';END IF;
   END LOOP;
  END LOOP;
 END LOOP;
 -- Complete known post-state still validates all prerequisites, then returns
 -- without CREATE/ALTER/GRANT or pg_proc xmin changes.
 IF state_post THEN RETURN;END IF;
 IF pg_catalog.octet_length(before_gate||after_gate)<>579
 OR pg_catalog.length(source_manual)-pg_catalog.length(pg_catalog.replace(source_manual,call_anchor,''))<>pg_catalog.length(call_anchor)
 OR pg_catalog.strpos(source_manual,before_gate)>0 OR pg_catalog.strpos(source_manual,after_gate)>0
 OR pg_catalog.length(source_publisher)-pg_catalog.length(pg_catalog.replace(source_publisher,publisher_before,''))<>pg_catalog.length(publisher_before)
 THEN RAISE EXCEPTION 'one_off_gate_convergence_exact_unique_recipe_required' USING ERRCODE='55000';END IF;
 desired_manual:=pg_catalog.replace(source_manual,call_anchor,before_gate||call_anchor||after_gate);
 desired_publisher:=pg_catalog.replace(source_publisher,publisher_before,publisher_after);
 IF pg_catalog.octet_length(desired_manual)<>pg_catalog.octet_length(source_manual)+579
 OR pg_catalog.replace(desired_manual,before_gate||call_anchor||after_gate,call_anchor) IS DISTINCT FROM source_manual
 OR pg_catalog.replace(desired_publisher,publisher_after,publisher_before) IS DISTINCT FROM source_publisher
 OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(desired_manual,'UTF8')),'hex')<>'dbf492dbb0887519d2683a2442aca9b5c51dfcaf74899fb6ea26a398176b745a'
 OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(desired_publisher,'UTF8')),'hex')<>'e65e9f046b558512e00a89622f5fdffe888dee5a57072982ee4a01292192732a'
 THEN RAISE EXCEPTION 'one_off_gate_convergence_exact_targets_required' USING ERRCODE='55000';END IF;
 SELECT pg_catalog.jsonb_build_object(
 'functions',(SELECT pg_catalog.jsonb_agg(CASE WHEN q.oid IN(target_manual,target_publisher) THEN pg_catalog.to_jsonb(q)-'prosrc' ELSE pg_catalog.to_jsonb(q) END ORDER BY q.oid)FROM pg_catalog.pg_proc q WHERE q.pronamespace NOT IN('pg_catalog'::regnamespace,'information_schema'::regnamespace)),
 'namespaces',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_namespace q),
 'relations',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_class q WHERE q.relnamespace NOT IN('pg_catalog'::regnamespace,'information_schema'::regnamespace)),
 'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.attrelid,q.attnum)FROM pg_catalog.pg_attribute q JOIN pg_catalog.pg_class snapshot_relation ON snapshot_relation.oid=q.attrelid WHERE snapshot_relation.relnamespace NOT IN('pg_catalog'::regnamespace,'information_schema'::regnamespace)),
 'column_defaults',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_attrdef q),
 'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_constraint q),
 'indexes',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.indexrelid)FROM pg_catalog.pg_index q),
 'triggers',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_trigger q),
 'events',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_event_trigger q),
 'policies',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_policy q),
 'rules',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_rewrite q),
 'roles',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_roles q),
 'memberships',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.roleid,q.member,q.grantor)FROM pg_catalog.pg_auth_members q),
 'defaults',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_default_acl q)) INTO before_catalog;
 -- Manual FIRST; no business function is invoked during installation.
 ddl:=pg_catalog.pg_get_functiondef(target_manual);
 IF pg_catalog.length(ddl)-pg_catalog.length(pg_catalog.replace(ddl,source_manual,''))<>pg_catalog.length(source_manual)
 THEN RAISE EXCEPTION 'one_off_gate_convergence_unique_manual_definition_required' USING ERRCODE='55000';END IF;
 EXECUTE pg_catalog.replace(ddl,source_manual,desired_manual);
 -- Publisher LAST, in the SAME DO transaction. The final comparison occurs
 -- after its DDL event triggers, so late faults/drift roll both changes back.
 ddl:=pg_catalog.pg_get_functiondef(target_publisher);
 IF pg_catalog.length(ddl)-pg_catalog.length(pg_catalog.replace(ddl,source_publisher,''))<>pg_catalog.length(source_publisher)
 THEN RAISE EXCEPTION 'one_off_gate_convergence_unique_publisher_definition_required' USING ERRCODE='55000';END IF;
 EXECUTE pg_catalog.replace(ddl,source_publisher,desired_publisher);
 SELECT pg_catalog.jsonb_build_object(
 'functions',(SELECT pg_catalog.jsonb_agg(CASE WHEN q.oid IN(target_manual,target_publisher) THEN pg_catalog.to_jsonb(q)-'prosrc' ELSE pg_catalog.to_jsonb(q) END ORDER BY q.oid)FROM pg_catalog.pg_proc q WHERE q.pronamespace NOT IN('pg_catalog'::regnamespace,'information_schema'::regnamespace)),
 'namespaces',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_namespace q),
 'relations',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_class q WHERE q.relnamespace NOT IN('pg_catalog'::regnamespace,'information_schema'::regnamespace)),
 'columns',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.attrelid,q.attnum)FROM pg_catalog.pg_attribute q JOIN pg_catalog.pg_class snapshot_relation ON snapshot_relation.oid=q.attrelid WHERE snapshot_relation.relnamespace NOT IN('pg_catalog'::regnamespace,'information_schema'::regnamespace)),
 'column_defaults',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_attrdef q),
 'constraints',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_constraint q),
 'indexes',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.indexrelid)FROM pg_catalog.pg_index q),
 'triggers',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_trigger q),
 'events',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_event_trigger q),
 'policies',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_policy q),
 'rules',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_rewrite q),
 'roles',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_roles q),
 'memberships',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.roleid,q.member,q.grantor)FROM pg_catalog.pg_auth_members q),
 'defaults',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(q)ORDER BY q.oid)FROM pg_catalog.pg_default_acl q)) INTO after_catalog;
 IF before_catalog IS DISTINCT FROM after_catalog
 OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid=target_manual) IS DISTINCT FROM desired_manual
 OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid=target_publisher) IS DISTINCT FROM desired_publisher
 THEN RAISE EXCEPTION 'one_off_gate_convergence_full_catalog_preservation_required' USING ERRCODE='55000';END IF;
END
$one_off_gate_convergence$;
