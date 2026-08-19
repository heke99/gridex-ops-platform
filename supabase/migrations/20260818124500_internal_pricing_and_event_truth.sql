-- Internal contract pricing and event-truth hardening.

create or replace function public.gridex_normalize_fixed_area_snapshot_v1(p_snapshot jsonb)
returns jsonb
language sql
immutable
set search_path to 'pg_catalog'
as $$
with input as (
  select coalesce(p_snapshot,'{}'::jsonb) s,
         upper(nullif(coalesce(p_snapshot->>'price_area',p_snapshot->>'priceArea'),'')) selected_area
), arrays as (
  select s,selected_area,
         case
           when jsonb_typeof(s->'base_price_components_snapshot')='array' then s->'base_price_components_snapshot'
           when jsonb_typeof(s->'base_components')='array' then s->'base_components'
           else null
         end arr
  from input
), elems as (
  select a.s,a.selected_area,e.value,e.ord,
         lower(coalesce(e.value->>'source_type',e.value->>'sourceType','')) source_type,
         upper(nullif(coalesce(e.value->>'price_area',e.value->>'priceArea'),'')) component_area
  from arrays a
  left join lateral jsonb_array_elements(coalesce(a.arr,'[]'::jsonb)) with ordinality e(value,ord) on true
), selected_fixed as (
  select min(ord) ord
  from elems
  where source_type='fixed'
    and component_area=selected_area
    and selected_area in ('SE1','SE2','SE3','SE4')
), kept as (
  select e.*
  from elems e cross join selected_fixed f
  where e.value is not null
    and (
      e.source_type<>'fixed'
      or e.component_area is null
      or (e.component_area=e.selected_area and e.ord=f.ord)
    )
), rebuilt as (
  select coalesce(jsonb_agg(value order by ord),'[]'::jsonb) arr
  from kept
)
select case
  when p_snapshot is null then '{}'::jsonb
  when (select selected_area from arrays) not in ('SE1','SE2','SE3','SE4')
       or (select arr from arrays) is null then p_snapshot
  else
    (p_snapshot || jsonb_build_object('base_price_components_snapshot',(select arr from rebuilt)))
    || case when p_snapshot ? 'base_components'
            then jsonb_build_object('base_components',(select arr from rebuilt))
            else '{}'::jsonb end
end;
$$;

create or replace function public.gridex_normalize_customer_contract_pricing_snapshot_v1()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog','pg_temp'
as $$
begin
  if new.price_snapshot is not null then
    new.price_snapshot := public.gridex_normalize_fixed_area_snapshot_v1(new.price_snapshot);
  end if;
  return new;
end
$$;

drop trigger if exists ab_customer_contracts_normalize_fixed_area_snapshot_v1 on public.customer_contracts;
create trigger ab_customer_contracts_normalize_fixed_area_snapshot_v1
before insert or update of price_snapshot on public.customer_contracts
for each row execute function public.gridex_normalize_customer_contract_pricing_snapshot_v1();

create or replace function public.gridex_normalize_contract_price_snapshot_row_v1()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog','pg_temp'
as $$
declare
  v_normalized jsonb;
begin
  if new.snapshot_json is not null then
    v_normalized := public.gridex_normalize_fixed_area_snapshot_v1(new.snapshot_json);
    new.snapshot_json := v_normalized;
    if v_normalized ? 'base_price_components_snapshot' then
      new.base_price_components_snapshot := v_normalized->'base_price_components_snapshot';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists aa_contract_price_snapshots_normalize_fixed_area_v1 on public.contract_price_snapshots;
create trigger aa_contract_price_snapshots_normalize_fixed_area_v1
before insert on public.contract_price_snapshots
for each row execute function public.gridex_normalize_contract_price_snapshot_row_v1();

-- A request is not proof of delivery. Normalize the legacy admin wording at the canonical event boundary.
create or replace function public.gridex_normalize_signature_request_event_truth_v1()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog','pg_temp'
as $$
begin
  if new.event_type='signature_requested' and new.note is not null then
    new.note := replace(new.note,'Signering skickad / väntar signering','Signering begärd / väntar signering');
    new.note := replace(new.note,'Signering skickad','Signering begärd');
  end if;
  return new;
end
$$;

drop trigger if exists aa_customer_contract_events_signature_request_truth_v1 on public.customer_contract_events;
create trigger aa_customer_contract_events_signature_request_truth_v1
before insert or update of note,event_type on public.customer_contract_events
for each row execute function public.gridex_normalize_signature_request_event_truth_v1();

revoke all on function public.gridex_normalize_fixed_area_snapshot_v1(jsonb) from public,anon,authenticated;
grant execute on function public.gridex_normalize_fixed_area_snapshot_v1(jsonb) to service_role;
revoke all on function public.gridex_normalize_customer_contract_pricing_snapshot_v1() from public,anon,authenticated;
revoke all on function public.gridex_normalize_contract_price_snapshot_row_v1() from public,anon,authenticated;
revoke all on function public.gridex_normalize_signature_request_event_truth_v1() from public,anon,authenticated;
