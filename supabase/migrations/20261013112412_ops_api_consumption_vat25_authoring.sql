-- Guard only future consumption authoring/new publication at the existing
-- native producers. Standard25percent/0.25fraction are accepted consistently.
-- Existing frozen version hash reuse and explicit production VAT/fee exemptions
-- remain untouched. No historical snapshot/data rewrite or business invocation.
-- Actual OPS predecessors captured read-only2026-10-13; preserve exact existing
-- signatures/OIDs/owners/ACL/defaults/search_path/security and every other byte.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $vat25_forward$
DECLARE definition text;body_hash text;
BEGIN
  SELECT pg_get_functiondef(p.oid),md5(p.prosrc) INTO STRICT definition,body_hash FROM pg_proc p WHERE p.oid='public.gridex_create_or_version_contract_pricing(uuid,text,text,text,text,jsonb,date,date,boolean,uuid)'::regprocedure;
  IF body_hash='ad3959344ade2b6fba6c3ff80a734e35' THEN
    NULL; -- Exact approved postbody replay; do not recreate the function.
  ELSE
    IF body_hash IS DISTINCT FROM 'ad27cf44efa875c6bfb51fb71b0f4518' THEN RAISE EXCEPTION 'vat25_authoring_predecessor_0_changed'; END IF;
    IF length(definition)-length(replace(definition,$anchor0$  if v_version_id is null then
$anchor0$,''))<>length($anchor0$  if v_version_id is null then
$anchor0$) THEN RAISE EXCEPTION 'vat25_authoring_anchor_0_changed'; END IF;
    definition:=replace(definition,$anchor0$  if v_version_id is null then
$anchor0$,$patch0$  -- Only new consumption versions or a new publication transition use the
  -- current25% policy. Existing frozen hash reuse retains its historic snapshot.
  if (v_version_id is null or (p_publish and exists(
        select 1 from public.price_plan_versions old_version where old_version.id=v_version_id
          and (old_version.status<>'published' or old_version.locked_at is null))))
     and (case when nullif(v_snapshot->>'energy_direction','') is not null
      then lower(v_snapshot->>'energy_direction')<>'production'
      else coalesce(v_snapshot#>>'{production,enabled}','false')<>'true'
        and coalesce(v_snapshot->>'production_enabled','false') not in ('true','on') end) then
    if nullif(v_snapshot->>'vat_rate','')::numeric is distinct from 0.25
       or (v_snapshot ? 'vat_rate_percent'
           and nullif(v_snapshot->>'vat_rate_percent','')::numeric is distinct from 25) then
      raise exception using errcode='23514',message='consumption_authoring_vat_must_be_25_percent';
    end if;
  end if;

  if v_version_id is null then
$patch0$);
    EXECUTE definition;
  END IF;
  SELECT pg_get_functiondef(p.oid),md5(p.prosrc) INTO STRICT definition,body_hash FROM pg_proc p WHERE p.oid='public.gridex_upsert_internal_contract_offer(uuid,uuid,jsonb,jsonb,uuid)'::regprocedure;
  IF body_hash='c6365e364572499b641cd3d9bac3a1fa' THEN
    NULL; -- Exact approved postbody replay; do not recreate the function.
  ELSE
    IF body_hash IS DISTINCT FROM '24300f0f38cd71f582713018617a4647' THEN RAISE EXCEPTION 'vat25_authoring_predecessor_1_changed'; END IF;
    IF length(definition)-length(replace(definition,$anchor1$  if v_vat_rate<0 or v_vat_rate>1 then
    raise exception using errcode='23514',message='invalid_vat_rate';
  end if;
$anchor1$,''))<>length($anchor1$  if v_vat_rate<0 or v_vat_rate>1 then
    raise exception using errcode='23514',message='invalid_vat_rate';
  end if;
$anchor1$) THEN RAISE EXCEPTION 'vat25_authoring_anchor_1_changed'; END IF;
    definition:=replace(definition,$anchor1$  if v_vat_rate<0 or v_vat_rate>1 then
    raise exception using errcode='23514',message='invalid_vat_rate';
  end if;
$anchor1$,$patch1$  if v_vat_rate<0 or v_vat_rate>1 then
    raise exception using errcode='23514',message='invalid_vat_rate';
  end if;
  -- Percent25 and canonical fraction0.25 were already normalized above.
  -- Consumption scalar metadata must agree with the standard snapshot policy.
  -- Explicit production configuration and per-component exemptions are retained.
  if (case when nullif(p_pricing_snapshot->>'energy_direction','') is not null
      then lower(p_pricing_snapshot->>'energy_direction')<>'production'
      else coalesce(p_pricing_snapshot#>>'{production,enabled}','false')<>'true'
        and coalesce(p_pricing_snapshot->>'production_enabled','false') not in ('true','on') end)
     and v_vat_rate is distinct from 0.25 then
    raise exception using errcode='23514',message='consumption_authoring_vat_must_be_25_percent';
  end if;
$patch1$);
    EXECUTE definition;
  END IF;
  SELECT pg_get_functiondef(p.oid),md5(p.prosrc) INTO STRICT definition,body_hash FROM pg_proc p WHERE p.oid='public.gridex_upsert_internal_contract_offer_v2(uuid,uuid,jsonb,jsonb,uuid)'::regprocedure;
  IF body_hash='d68d5db35eb6bc25b607f7872c2ad3d7' THEN
    NULL; -- Exact approved postbody replay; do not recreate the function.
  ELSE
    IF body_hash IS DISTINCT FROM '2eabc8d12127ed65a8325aa8f82390a2' THEN RAISE EXCEPTION 'vat25_authoring_predecessor_2_changed'; END IF;
    IF length(definition)-length(replace(definition,$anchor2$  v_result:=public.gridex_upsert_internal_contract_offer(
    p_company_id,p_offer_id,p_payload,p_pricing_snapshot,p_actor_user_id
  );
$anchor2$,''))<>length($anchor2$  v_result:=public.gridex_upsert_internal_contract_offer(
    p_company_id,p_offer_id,p_payload,p_pricing_snapshot,p_actor_user_id
  );
$anchor2$) THEN RAISE EXCEPTION 'vat25_authoring_anchor_2_changed'; END IF;
    definition:=replace(definition,$anchor2$  v_result:=public.gridex_upsert_internal_contract_offer(
    p_company_id,p_offer_id,p_payload,p_pricing_snapshot,p_actor_user_id
  );
$anchor2$,$patch2$  -- Preserve the existing validated direction precedence: snapshot, then payload.
  -- Legacy payload-only authoring needs that direction in the canonical snapshot
  -- before both native VAT guards/hash production; explicit snapshot bytes remain
  -- unchanged, including case-insensitive production and existing hash reuse.
  if nullif(p_pricing_snapshot->>'energy_direction','') is null then
    p_pricing_snapshot:=jsonb_set(coalesce(p_pricing_snapshot,'{}'::jsonb),
      '{energy_direction}',to_jsonb(v_energy_direction));
  end if;

  v_result:=public.gridex_upsert_internal_contract_offer(
    p_company_id,p_offer_id,p_payload,p_pricing_snapshot,p_actor_user_id
  );
$patch2$);
    EXECUTE definition;
  END IF;
END;
$vat25_forward$;
NOTIFY pgrst,'reload schema';
COMMIT;
