-- Normalize only four historical contract-type aliases before the existing manual offer save.
-- Native/canonical publication permissions and all existing business behavior remain unchanged.
-- Snapshots, pricing-model, prices, VAT, intervals, defaults and existing refusals are preserved.
-- Exact source/target guards allow only this alias insertion and idempotent replay.
BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $manual_binding_alias_forward$
DECLARE
 target oid:=to_regprocedure('public.gridex_prepare_manual_contract_binding(uuid,jsonb,jsonb,uuid)');
 upsert_target oid:=to_regprocedure('public.gridex_upsert_internal_contract_offer(uuid,uuid,jsonb,jsonb,uuid)');
 before_row pg_catalog.pg_proc%rowtype;after_row pg_catalog.pg_proc%rowtype;
 upsert_before pg_catalog.pg_proc%rowtype;upsert_after pg_catalog.pg_proc%rowtype;
 constraints_before jsonb;constraints_after jsonb;
 desired text;profile text;definition text;
 source_md5 text;source_sha text;desired_md5 text;desired_sha text;
 anchor constant text:=$alias_anchor$  p_payload := p_payload || jsonb_build_object(
    'name',$alias_anchor$;
 addition constant text:=$alias_addition$  -- Only immutable20260727161000's explicit contract-type aliases are mapped.
  -- Pricing model, intervals, numeric evidence and snapshot bytes are independent.
  -- Missing/empty types keep the original default; unknown types keep CHECK refusal.
  if lower(btrim(p_payload->>'contract_type')) in ('spot','variable','variable_spot','hourly_spot') then
    p_payload := jsonb_set(p_payload,'{contract_type}',to_jsonb(
      case lower(btrim(p_payload->>'contract_type'))
        when 'spot' then 'variable_monthly'
        when 'variable' then 'variable_monthly'
        when 'variable_spot' then 'variable_monthly'
        when 'hourly_spot' then 'variable_hourly'
      end
    ),false);
  end if;

$alias_addition$;
BEGIN
 IF current_user IS DISTINCT FROM 'postgres' OR session_user IS DISTINCT FROM 'postgres'
 OR current_setting('server_version_num')::integer<170000 OR current_setting('server_version_num')::integer>=180000
 THEN RAISE EXCEPTION 'manual_binding_alias_forward_pg17_postgres_required';END IF;
 SELECT * INTO STRICT before_row FROM pg_catalog.pg_proc WHERE oid=target;
 SELECT * INTO STRICT upsert_before FROM pg_catalog.pg_proc WHERE oid=upsert_target;
 -- Admit only the two exact previously reviewed bodies, or their exact alias-only targets.
 source_md5:=md5(before_row.prosrc);
 source_sha:=encode(sha256(convert_to(before_row.prosrc,'UTF8')),'hex');
 IF source_md5='2e350f61d1467bd1d320c21380cc9c46'
 AND source_sha='a074fba17d8c7c84cc2ded5512dcfa4b5ed5469cb699778687bd23b28e62a47a' THEN
  profile:='native_before';
 ELSIF source_md5='d2bfad81ebbd7903d44739ed0390cc79'
 AND source_sha='0457c7db189686998e75fa5b0ec69846e5e7c0d88fc8dbd8e2dfaf100ca30586' THEN
  profile:='canonical_before';
 ELSIF source_md5='e57805b069d753e9534c8795bfd6259c'
 AND source_sha='baccd65df7e303df26aef3516ad8bf7e5faf42d380dd1bae6bcc8205c50ca5ec' THEN
  profile:='native_replay';
 ELSIF source_md5='e8c4154ac1ba0250e4c9a7f59d927cb2'
 AND source_sha='dbf492dbb0887519d2683a2442aca9b5c51dfcaf74899fb6ea26a398176b745a' THEN
  profile:='canonical_replay';
 ELSE RAISE EXCEPTION 'manual_binding_alias_unknown_or_wrapper_source';END IF;
 IF profile IN ('native_before','canonical_before') THEN
  -- Exactly one source anchor, exactly the reviewed 14-line insertion; no other rewrite.
  IF length(before_row.prosrc)-length(replace(before_row.prosrc,anchor,''))<>length(anchor)
  THEN RAISE EXCEPTION 'manual_binding_alias_unique_anchor_required';END IF;
  desired:=replace(before_row.prosrc,anchor,addition||anchor);
  IF length(desired)<>length(before_row.prosrc)+length(addition)
  OR replace(desired,addition||anchor,anchor) IS DISTINCT FROM before_row.prosrc
  THEN RAISE EXCEPTION 'manual_binding_alias_single_insertion_required';END IF;
 ELSE
  desired:=before_row.prosrc;
 END IF;
 desired_md5:=md5(desired);
 desired_sha:=encode(sha256(convert_to(desired,'UTF8')),'hex');
 IF (profile IN ('native_before','native_replay') AND
     (desired_md5 IS DISTINCT FROM 'e57805b069d753e9534c8795bfd6259c'
      OR desired_sha IS DISTINCT FROM 'baccd65df7e303df26aef3516ad8bf7e5faf42d380dd1bae6bcc8205c50ca5ec'))
 OR (profile IN ('canonical_before','canonical_replay') AND
     (desired_md5 IS DISTINCT FROM 'e8c4154ac1ba0250e4c9a7f59d927cb2'
      OR desired_sha IS DISTINCT FROM 'dbf492dbb0887519d2683a2442aca9b5c51dfcaf74899fb6ea26a398176b745a'))
 THEN RAISE EXCEPTION 'manual_binding_alias_exact_target_required';END IF;
 IF before_row.proname IS DISTINCT FROM 'gridex_prepare_manual_contract_binding'
 OR before_row.pronamespace IS DISTINCT FROM 'public'::regnamespace OR pg_get_userbyid(before_row.proowner) IS DISTINCT FROM 'postgres'
 OR before_row.prokind IS DISTINCT FROM 'f'::"char"
 OR before_row.proacl IS DISTINCT FROM ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[]
 OR before_row.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
 OR before_row.proargtypes IS DISTINCT FROM ARRAY['uuid'::regtype::oid,'jsonb'::regtype::oid,'jsonb'::regtype::oid,'uuid'::regtype::oid]::oidvector
 OR before_row.pronargs IS DISTINCT FROM 4::smallint OR before_row.proargnames IS DISTINCT FROM ARRAY['p_company_id','p_payload','p_pricing_snapshot','p_actor_user_id']::text[]
 OR before_row.proallargtypes IS NOT NULL OR before_row.proargmodes IS NOT NULL
 OR before_row.pronargdefaults IS DISTINCT FROM 1::smallint OR pg_get_expr(before_row.proargdefaults,0) IS DISTINCT FROM 'NULL::uuid'
 OR before_row.prorettype IS DISTINCT FROM 'jsonb'::regtype OR before_row.proretset
 OR NOT before_row.prosecdef OR before_row.proisstrict OR before_row.proleakproof
 OR before_row.provolatile IS DISTINCT FROM 'v'::"char" OR before_row.proparallel IS DISTINCT FROM 'u'::"char"
 OR (SELECT lanname FROM pg_catalog.pg_language WHERE oid=before_row.prolang) IS DISTINCT FROM 'plpgsql'
 OR before_row.procost IS DISTINCT FROM 100::real OR before_row.prorows IS DISTINCT FROM 0::real
 OR before_row.prosupport IS DISTINCT FROM 0::oid OR before_row.provariadic IS DISTINCT FROM 0::oid
 OR before_row.protrftypes IS NOT NULL OR before_row.probin IS NOT NULL OR before_row.prosqlbody IS NOT NULL
 THEN RAISE EXCEPTION 'manual_binding_alias_unknown_full_metadata';END IF;
 -- The existing exact downstream save/VAT implementation is preserved, never substituted.
 IF upsert_before.proname IS DISTINCT FROM 'gridex_upsert_internal_contract_offer'
 OR upsert_before.pronamespace IS DISTINCT FROM 'public'::regnamespace OR pg_get_userbyid(upsert_before.proowner) IS DISTINCT FROM 'postgres'
 OR md5(upsert_before.prosrc) IS DISTINCT FROM 'c6365e364572499b641cd3d9bac3a1fa'
 OR encode(sha256(convert_to(upsert_before.prosrc,'UTF8')),'hex') IS DISTINCT FROM '7e37e58fdaa9d32471e27de9033a8cbac5b6e4574b7c5d47ec2d7a17f22c2f79'
 OR upsert_before.proacl IS DISTINCT FROM ARRAY['postgres=X/postgres']::aclitem[]
 OR upsert_before.proconfig IS DISTINCT FROM ARRAY['search_path=public, pg_temp']::text[]
 OR upsert_before.proargtypes IS DISTINCT FROM ARRAY['uuid'::regtype::oid,'uuid'::regtype::oid,'jsonb'::regtype::oid,'jsonb'::regtype::oid,'uuid'::regtype::oid]::oidvector
 OR upsert_before.proargnames IS DISTINCT FROM ARRAY['p_company_id','p_offer_id','p_payload','p_pricing_snapshot','p_actor_user_id']::text[]
 OR upsert_before.pronargs IS DISTINCT FROM 5::smallint OR upsert_before.pronargdefaults IS DISTINCT FROM 0::smallint OR upsert_before.proargdefaults IS NOT NULL
 OR upsert_before.proallargtypes IS NOT NULL OR upsert_before.proargmodes IS NOT NULL
 OR upsert_before.prokind IS DISTINCT FROM 'f'::"char" OR upsert_before.prorettype IS DISTINCT FROM 'jsonb'::regtype OR upsert_before.proretset
 OR NOT upsert_before.prosecdef OR upsert_before.proisstrict OR upsert_before.proleakproof
 OR upsert_before.provolatile IS DISTINCT FROM 'v'::"char" OR upsert_before.proparallel IS DISTINCT FROM 'u'::"char"
 OR (SELECT lanname FROM pg_catalog.pg_language WHERE oid=upsert_before.prolang) IS DISTINCT FROM 'plpgsql'
 OR upsert_before.procost IS DISTINCT FROM 100::real OR upsert_before.prorows IS DISTINCT FROM 0::real
 OR upsert_before.prosupport IS DISTINCT FROM 0::oid OR upsert_before.provariadic IS DISTINCT FROM 0::oid
 OR upsert_before.protrftypes IS NOT NULL OR upsert_before.probin IS NOT NULL OR upsert_before.prosqlbody IS NOT NULL
 THEN RAISE EXCEPTION 'manual_binding_alias_existing_upsert_unknown';END IF;
 -- Immutable canonical offer-type CHECK remains exactly its validated six-type definition.
 IF NOT EXISTS(SELECT FROM pg_catalog.pg_constraint c
  WHERE c.conrelid='public.contract_offers'::regclass AND c.conname='contract_offers_contract_type_check'
   AND c.contype='c' AND c.convalidated
   AND pg_get_constraintdef(c.oid)=$offer_type_check$CHECK ((contract_type = ANY (ARRAY['fixed'::text, 'variable_monthly'::text, 'variable_hourly'::text, 'variable_quarterly'::text, 'portfolio'::text, 'mixed'::text])))$offer_type_check$)
 THEN RAISE EXCEPTION 'manual_binding_alias_canonical_offer_type_check_required';END IF;
 SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) INTO constraints_before FROM pg_catalog.pg_constraint c
 WHERE c.conrelid IN('public.contract_offers'::regclass,'public.contract_product_versions'::regclass,'public.customer_contracts'::regclass);
 IF before_row.prosrc IS DISTINCT FROM desired THEN
  definition:=pg_get_functiondef(target);
  IF definition IS NULL
  OR length(definition)-length(replace(definition,before_row.prosrc,''))<>length(before_row.prosrc)
  THEN RAISE EXCEPTION 'manual_binding_alias_unique_definition_body_required';END IF;
  EXECUTE replace(definition,before_row.prosrc,desired);
 END IF;
 SELECT * INTO STRICT after_row FROM pg_catalog.pg_proc WHERE oid=target;
 SELECT * INTO STRICT upsert_after FROM pg_catalog.pg_proc WHERE oid=upsert_target;
 SELECT jsonb_agg(to_jsonb(c) ORDER BY c.oid) INTO constraints_after FROM pg_catalog.pg_constraint c
 WHERE c.conrelid IN('public.contract_offers'::regclass,'public.contract_product_versions'::regclass,'public.customer_contracts'::regclass);
 IF (to_jsonb(after_row)-'prosrc') IS DISTINCT FROM (to_jsonb(before_row)-'prosrc')
 OR after_row.prosrc IS DISTINCT FROM desired
 OR to_jsonb(upsert_after) IS DISTINCT FROM to_jsonb(upsert_before)
 OR constraints_after IS DISTINCT FROM constraints_before
 THEN RAISE EXCEPTION 'manual_binding_alias_complete_preservation_required';END IF;
END $manual_binding_alias_forward$;
COMMIT;
