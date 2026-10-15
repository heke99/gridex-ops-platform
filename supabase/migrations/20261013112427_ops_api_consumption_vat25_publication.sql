-- Future consumption publication/activation must bind canonical VAT25%.
-- Exact already-active/published replay and explicit producer exemptions retain
-- their immutable receipts. No price/history data rewrite or business invocation.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $vat25_publication_forward$
DECLARE definition text;body_hash text;
BEGIN
  SELECT pg_get_functiondef(p.oid),md5(p.prosrc) INTO STRICT definition,body_hash FROM pg_proc p WHERE p.oid='public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'::regprocedure;
  IF body_hash='e1ce2908fde6bcba9f797115196a4786' THEN
    NULL; -- Exact approved postbody replay; do not recreate the function.
  ELSE
    IF body_hash IS DISTINCT FROM 'b00d519ea7145470100fdc90f0e8811e' THEN RAISE EXCEPTION 'vat25_publication_predecessor_0_changed'; END IF;
    IF length(definition)-length(replace(definition,$anchor0$  perform public.gridex_sync_internal_offer_to_canonical(o.id);
$anchor0$,''))<>length($anchor0$  perform public.gridex_sync_internal_offer_to_canonical(o.id);
$anchor0$) THEN RAISE EXCEPTION 'vat25_publication_anchor_0_changed'; END IF;
    definition:=replace(definition,$anchor0$  perform public.gridex_sync_internal_offer_to_canonical(o.id);
$anchor0$,$patch0$  -- This is a new channel activation, after the exact already-active replay.
  -- Requalify locked canonical monetary inputs; immutable historical receipts
  -- are retained, but their wrong VAT cannot enter a new publication.
  select jsonb_build_object('direction',lower(pv.energy_direction),
      'price',ppv.snapshot_json,'product',pv.commercial_snapshot)
    into v_snapshot
  from public.price_plan_versions ppv
  join public.contract_product_versions pv on pv.id=o.contract_product_version_id
    and pv.price_plan_version_id=ppv.id and pv.price_plan_id=ppv.price_plan_id
  join public.contract_products product on product.id=pv.contract_product_id
    and product.company_id=p_company_id
  where ppv.id=o.price_plan_version_id and ppv.company_id=p_company_id
    and ppv.price_plan_id=o.price_plan_id
  for share of ppv,pv;
  if not found then
    raise exception using errcode='23514',message='publication_pricing_graph_missing';
  end if;
  if coalesce(v_snapshot->>'direction','consumption')<>'production'
     and (o.vat_rate is distinct from 0.25
       or nullif(v_snapshot#>>'{price,vat_rate}','')::numeric is distinct from 0.25
       or (v_snapshot->'price' ? 'vat_rate_percent' and nullif(v_snapshot#>>'{price,vat_rate_percent}','')::numeric is distinct from 25)
       or nullif(v_snapshot#>>'{product,vat_rate}','')::numeric is distinct from 0.25
       or (v_snapshot->'product' ? 'vat_rate_percent' and nullif(v_snapshot#>>'{product,vat_rate_percent}','')::numeric is distinct from 25)
       or nullif(o.commercial_snapshot->>'vat_rate','')::numeric is distinct from 0.25
       or (o.commercial_snapshot ? 'vat_rate_percent' and nullif(o.commercial_snapshot->>'vat_rate_percent','')::numeric is distinct from 25)) then
    raise exception using errcode='23514',message='consumption_publication_vat_must_be_25_percent';
  end if;

  perform public.gridex_sync_internal_offer_to_canonical(o.id);
$patch0$);
    EXECUTE definition;
  END IF;
  SELECT pg_get_functiondef(p.oid),md5(p.prosrc) INTO STRICT definition,body_hash FROM pg_proc p WHERE p.oid='public.gridex_publish_contract_publication_version(uuid,uuid)'::regprocedure;
  IF body_hash='ba799bdc42f5da7296d10832a7eca507' THEN
    NULL; -- Exact approved postbody replay; do not recreate the function.
  ELSE
    IF body_hash IS DISTINCT FROM '684fa1bc1967322f8e676669215e8dba' THEN RAISE EXCEPTION 'vat25_publication_predecessor_1_changed'; END IF;
    IF length(definition)-length(replace(definition,$anchor1$  perform set_config('gridex.version_transition','on',true);
$anchor1$,''))<>length($anchor1$  perform set_config('gridex.version_transition','on',true);
$anchor1$) THEN RAISE EXCEPTION 'vat25_publication_anchor_1_changed'; END IF;
    definition:=replace(definition,$anchor1$  perform set_config('gridex.version_transition','on',true);
$anchor1$,$patch1$  -- Existing published/active graph replay preserves its immutable history.
  -- An ended/draft graph or channel reactivation is a future publication.
  select * into strict v_row from public.contract_publication_versions
    where id=p_publication_version_id for update;
  if not (v_row.status='published' and v_row.locked_at is not null and exists(
      select 1 from public.contract_publications cp
      join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
      join public.tenant_contract_channels ch on ch.assignment_id=ta.id and ch.channel=cp.channel
      where cp.id=v_row.contract_publication_id and cp.status='published'
        and ta.status='active' and ch.status='active'
        and (ch.valid_from is null or ch.valid_from<=now())
        and (ch.valid_to is null or ch.valid_to>now()))) then
    perform 1 from public.price_plan_versions ppv
    join public.contract_product_versions pv on pv.id=v_row.contract_product_version_id
      and pv.price_plan_version_id=ppv.id and pv.price_plan_id=ppv.price_plan_id
    where ppv.id=v_row.price_plan_version_id and ppv.price_plan_id=v_row.price_plan_id
      and ppv.company_id=v_company
    for share of ppv,pv;
    if not found then
      raise exception using errcode='23514',message='publication_pricing_graph_missing';
    end if;
    if exists(select 1 from public.price_plan_versions ppv
      join public.contract_product_versions pv on pv.id=v_row.contract_product_version_id
      where ppv.id=v_row.price_plan_version_id
        and coalesce(lower(pv.energy_direction),'consumption')<>'production'
        and (nullif(ppv.snapshot_json->>'vat_rate','')::numeric is distinct from 0.25
          or (ppv.snapshot_json ? 'vat_rate_percent' and nullif(ppv.snapshot_json->>'vat_rate_percent','')::numeric is distinct from 25)
          or nullif(pv.commercial_snapshot->>'vat_rate','')::numeric is distinct from 0.25
          or (pv.commercial_snapshot ? 'vat_rate_percent' and nullif(pv.commercial_snapshot->>'vat_rate_percent','')::numeric is distinct from 25)
          or exists(select 1 from public.public_contract_offers pco
            where pco.contract_publication_version_id=v_row.id
              and pco.company_id=v_company and pco.vat_rate is distinct from 0.25))) then
      raise exception using errcode='23514',message='consumption_publication_vat_must_be_25_percent';
    end if;
  end if;

  perform set_config('gridex.version_transition','on',true);
$patch1$);
    EXECUTE definition;
  END IF;
END;
$vat25_publication_forward$;
NOTIFY pgrst,'reload schema';
COMMIT;
