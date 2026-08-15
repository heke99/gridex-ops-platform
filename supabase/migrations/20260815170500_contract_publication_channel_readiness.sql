-- Make contract publication readiness channel-aware and keep historical
-- ended/archived versions out of the current tenant blocker summary.
-- API publications are canonical snapshots and intentionally do not create
-- public_contract_offers; website publications still validate that materialized row.

create or replace function public.gridex_invoice_fee_snapshot_readiness(p_snapshot jsonb)
returns jsonb
language sql
immutable
set search_path to 'public', 'pg_temp'
as $function$
with raw_components as (
  select component
  from jsonb_array_elements(
    case
      when jsonb_typeof(coalesce(p_snapshot,'{}'::jsonb)->'price_components')='array'
        then coalesce(p_snapshot,'{}'::jsonb)->'price_components'
      when jsonb_typeof(coalesce(p_snapshot,'{}'::jsonb)->'price_components_snapshot')='array'
        then coalesce(p_snapshot,'{}'::jsonb)->'price_components_snapshot'
      else '[]'::jsonb
    end
  ) component
  where coalesce(
    nullif(component->>'component_code',''),
    nullif(component->>'component_type',''),
    nullif(component#>>'{metadata,component_code}','')
  )='invoice_fee'
  and coalesce(nullif(component->>'status',''),'active')='active'
), normalized as (
  select
    component,
    public.gridex_safe_nonnegative_numeric(component->>'amount') as amount,
    component->>'unit' as unit,
    component->>'calculation_type' as calculation_type,
    case
      when lower(coalesce(component->>'website_card_visible','')) in('true','false')
        then (component->>'website_card_visible')::boolean
      when lower(coalesce(component#>>'{metadata,visibility,website_card}','')) in('true','false')
        then (component#>>'{metadata,visibility,website_card}')::boolean
      else true
    end as website_card_visible
  from raw_components
), scored as (
  select
    count(*)::integer as component_count,
    count(*) filter(
      where unit='sek_invoice'
        and calculation_type='per_invoice'
        and amount is not null
    )::integer as valid_component_count,
    min(amount) filter(
      where unit='sek_invoice'
        and calculation_type='per_invoice'
        and amount is not null
    ) as amount,
    bool_or(website_card_visible) filter(
      where unit='sek_invoice'
        and calculation_type='per_invoice'
        and amount is not null
    ) as website_card_visible
  from normalized
)
select case
  when component_count>1 then jsonb_build_object('status','blocked','code','invoice_fee_ambiguous')
  when valid_component_count<>1 then jsonb_build_object('status','blocked','code','invoice_fee_missing')
  else jsonb_build_object(
    'status','ready','amount',amount,'unit','sek_invoice',
    'calculation_type','per_invoice',
    'website_card_visible',coalesce(website_card_visible,true),
    'source','price_plan_version'
  )
end
from scored;
$function$;

comment on function public.gridex_invoice_fee_snapshot_readiness(jsonb) is
  'Validates canonical invoice_fee configuration without requiring website-only public_contract_offers materialization.';

do $block$
declare
  v_definition text;
  v_updated text;
  v_needle text := 'gridex_invoice_fee_readiness(ppv.snapshot_json, pco.invoice_fee_sek) AS invoice_fee_readiness';
  v_replacement text := 'CASE WHEN cp.channel = ''website'' THEN gridex_invoice_fee_readiness(ppv.snapshot_json, pco.invoice_fee_sek) ELSE gridex_invoice_fee_snapshot_readiness(ppv.snapshot_json) END AS invoice_fee_readiness';
begin
  v_definition := pg_get_viewdef('public.contract_publication_readiness_v'::regclass, true);
  v_updated := replace(v_definition, v_needle, v_replacement);

  if v_updated = v_definition then
    raise exception 'contract_publication_readiness_v invoice-fee expression did not match expected canonical definition';
  end if;

  execute 'create or replace view public.contract_publication_readiness_v as ' || v_updated;
end;
$block$;

do $block$
declare
  v_definition text;
  v_updated text;
  v_needle text := 'COALESCE(array_agg(DISTINCT blocker.code) FILTER (WHERE blocker.code IS NOT NULL), ''{}''::text[]) AS publication_blockers';
  v_replacement text := 'COALESCE(array_agg(DISTINCT blocker.code) FILTER (WHERE blocker.code IS NOT NULL AND r.status = ''published''::text), ''{}''::text[]) AS publication_blockers';
begin
  v_definition := pg_get_viewdef('public.gridex_tenant_contract_readiness_v'::regclass, true);
  v_updated := replace(v_definition, v_needle, v_replacement);

  if v_updated = v_definition then
    raise exception 'gridex_tenant_contract_readiness_v blocker aggregate did not match expected canonical definition';
  end if;

  execute 'create or replace view public.gridex_tenant_contract_readiness_v as ' || v_updated;
end;
$block$;

-- Fail closed if a published website publication ever loses its website-only
-- materialized public offer. API/other channels intentionally do not require it.
create or replace function public.gridex_published_website_offer_integrity(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
with missing as (
  select cpv.id
  from public.contract_publication_versions cpv
  join public.contract_publications cp on cp.id=cpv.contract_publication_id
  join public.tenant_contract_assignments ta on ta.id=cp.assignment_id
  where ta.company_id=p_company_id
    and cpv.status='published'
    and cp.status='published'
    and cp.channel='website'
    and not exists(
      select 1
      from public.public_contract_offers pco
      where pco.company_id=p_company_id
        and pco.contract_publication_version_id=cpv.id
        and pco.lifecycle_status='published'
        and pco.publication_status='published'
        and pco.is_public=true
        and pco.website_enabled=true
        and pco.website_cta_enabled=true
    )
)
select jsonb_build_object(
  'ready', count(*)=0,
  'missing_count', count(*),
  'missing_publication_version_ids', coalesce(jsonb_agg(id) filter(where id is not null),'[]'::jsonb),
  'source','canonical_runtime_v2'
)
from missing;
$function$;

revoke all on function public.gridex_published_website_offer_integrity(uuid) from public;
revoke all on function public.gridex_published_website_offer_integrity(uuid) from anon;
grant execute on function public.gridex_published_website_offer_integrity(uuid) to authenticated, service_role;
