-- OPS-E/F: facility work queue read model + helper RPC.
-- Purpose: make missing facility data, grid-owner follow-up and customer-card next steps fast and tenant-scoped.

create index if not exists customer_sites_company_customer_updated_facility_idx
  on public.customer_sites(company_id, customer_id, updated_at desc);

create index if not exists metering_points_company_site_updated_facility_idx
  on public.metering_points(company_id, site_id, updated_at desc);

create index if not exists customer_info_requests_company_site_status_facility_idx
  on public.customer_info_requests(company_id, site_id, status, updated_at desc);

create index if not exists grid_owner_data_requests_company_site_status_facility_idx
  on public.grid_owner_data_requests(company_id, site_id, status, updated_at desc);

create or replace view public.gridex_facility_work_queue_v
with (security_invoker = true)
as
with site_status as (
  select
    cs.id,
    cs.company_id,
    cs.customer_id,
    cs.id as site_id,
    coalesce(nullif(c.customer_number, ''), null) as customer_number,
    coalesce(
      nullif(c.company_name, ''),
      nullif(c.full_name, ''),
      nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
      nullif(c.email, ''),
      'Kund utan namn'
    ) as customer_label,
    coalesce(nullif(cs.site_name, ''), nullif(cs.facility_id, ''), nullif(trim(concat_ws(', ', cs.street, cs.postal_code, cs.city)), ''), 'Anläggning') as site_label,
    cs.facility_id,
    (
      select mp.id
      from public.metering_points mp
      where mp.company_id = cs.company_id and mp.site_id = cs.id
      order by case when mp.status = 'active' then 0 else 1 end, mp.updated_at desc nulls last
      limit 1
    ) as metering_point_id,
    (
      select coalesce(nullif(mp.meter_point_id, ''), nullif(mp.metering_point_id, ''), mp.id::text)
      from public.metering_points mp
      where mp.company_id = cs.company_id and mp.site_id = cs.id
      order by case when mp.status = 'active' then 0 else 1 end, mp.updated_at desc nulls last
      limit 1
    ) as metering_point_label,
    coalesce(
      cs.grid_owner_id,
      (
        select mp.grid_owner_id
        from public.metering_points mp
        where mp.company_id = cs.company_id and mp.site_id = cs.id and mp.grid_owner_id is not null
        order by case when mp.status = 'active' then 0 else 1 end, mp.updated_at desc nulls last
        limit 1
      )
    ) as grid_owner_id,
    go.name as grid_owner_name,
    coalesce(
      cs.price_area_code,
      (
        select mp.price_area_code
        from public.metering_points mp
        where mp.company_id = cs.company_id and mp.site_id = cs.id and mp.price_area_code is not null
        order by case when mp.status = 'active' then 0 else 1 end, mp.updated_at desc nulls last
        limit 1
      )
    ) as price_area_code,
    exists (
      select 1
      from public.metering_points mp
      where mp.company_id = cs.company_id
        and mp.site_id = cs.id
        and coalesce(nullif(mp.meter_point_id, ''), nullif(mp.metering_point_id, '')) is not null
    ) as has_metering_point,
    exists (
      select 1
      from public.powers_of_attorney poa
      where poa.customer_id = cs.customer_id
        and coalesce(poa.company_id, cs.company_id) = cs.company_id
        and poa.status = 'signed'
        and nullif(poa.document_path, '') is not null
    ) as has_signed_power_of_attorney,
    exists (
      select 1
      from public.customer_info_requests cir
      where cir.company_id = cs.company_id
        and cir.customer_id = cs.customer_id
        and (cir.site_id = cs.id or cir.site_id is null)
        and cir.status in ('pending','sent','waiting_response','waiting_for_z02','z01_prepared','ready_to_send','manual_review_required')
    ) or exists (
      select 1
      from public.grid_owner_data_requests gor
      where gor.company_id = cs.company_id
        and gor.customer_id = cs.customer_id
        and (gor.site_id = cs.id or gor.site_id is null)
        and gor.status in ('pending','sent','failed')
    ) as has_open_data_request,
    greatest(
      coalesce(cs.updated_at, cs.created_at),
      coalesce((
        select max(mp.updated_at)
        from public.metering_points mp
        where mp.company_id = cs.company_id and mp.site_id = cs.id
      ), cs.updated_at, cs.created_at),
      coalesce((
        select max(cir.updated_at)
        from public.customer_info_requests cir
        where cir.company_id = cs.company_id and cir.customer_id = cs.customer_id and (cir.site_id = cs.id or cir.site_id is null)
      ), cs.updated_at, cs.created_at),
      coalesce((
        select max(gor.updated_at)
        from public.grid_owner_data_requests gor
        where gor.company_id = cs.company_id and gor.customer_id = cs.customer_id and (gor.site_id = cs.id or gor.site_id is null)
      ), cs.updated_at, cs.created_at)
    ) as updated_at,
    cs.created_at
  from public.customer_sites cs
  join public.customers c on c.id = cs.customer_id and c.company_id = cs.company_id
  left join public.grid_owners go on go.id = coalesce(
    cs.grid_owner_id,
    (
      select mp.grid_owner_id
      from public.metering_points mp
      where mp.company_id = cs.company_id and mp.site_id = cs.id and mp.grid_owner_id is not null
      order by case when mp.status = 'active' then 0 else 1 end, mp.updated_at desc nulls last
      limit 1
    )
  )
  where coalesce(c.source, '') <> 'ediel_portal_test'
    and coalesce(c.status, '') not in ('archived','deleted','deleted_test_only','pending_deletion')
)
select
  ss.id,
  ss.company_id,
  ss.customer_id,
  ss.customer_number,
  ss.customer_label,
  ss.site_id,
  ss.site_label,
  ss.metering_point_id,
  ss.metering_point_label,
  ss.facility_id,
  ss.grid_owner_id,
  ss.grid_owner_name,
  ss.price_area_code,
  case
    when ss.has_open_data_request then 'awaiting_grid_owner'
    when not ss.has_signed_power_of_attorney then 'missing_authorization'
    when ss.grid_owner_id is null then 'needs_grid_owner_review'
    when nullif(ss.facility_id, '') is null or not ss.has_metering_point or ss.price_area_code is null then 'needs_facility_data'
    else 'ready_for_switch'
  end as status,
  case
    when ss.has_open_data_request then 'normal'
    when not ss.has_signed_power_of_attorney or ss.grid_owner_id is null then 'high'
    else 'normal'
  end as priority,
  array_remove(array[
    case when nullif(ss.facility_id, '') is null then 'facility_id' end,
    case when not ss.has_metering_point then 'metering_point_id' end,
    case when ss.grid_owner_id is null then 'grid_owner' end,
    case when ss.price_area_code is null then 'price_area' end,
    case when not ss.has_signed_power_of_attorney then 'power_of_attorney' end
  ], null) as missing_fields,
  case
    when ss.has_open_data_request then 'Följ upp nätägarens svar'
    when not ss.has_signed_power_of_attorney then 'Ladda upp eller verifiera fullmakt'
    when ss.grid_owner_id is null then 'Verifiera nätägare/nätområde'
    when nullif(ss.facility_id, '') is null or not ss.has_metering_point or ss.price_area_code is null then 'Begär uppgifter från nätägare'
    else 'Starta leverantörsbyte'
  end as next_action,
  case
    when ss.has_open_data_request then 'Begäran är skickad eller köad. Följ upp svar och koppla inkommen Z02/manuellt svar till kundkortet.'
    when not ss.has_signed_power_of_attorney then 'Kunden är sparad, men utskick till nätägare stoppas tills signerad fullmakt finns.'
    when ss.grid_owner_id is null then 'Adress/postnummer kan vara förslag, men verifierad nätägare eller nätområdeskod saknas.'
    when nullif(ss.facility_id, '') is null or not ss.has_metering_point or ss.price_area_code is null then 'Anläggnings-ID, mätpunkt eller elområde saknas. Begär uppgifter innan switch.'
    else 'Anläggningsdata ser komplett ut. Nästa steg är leverantörsbyte eller aktiv kundprocess.'
  end as description,
  ss.created_at,
  ss.updated_at,
  '/admin/customers/' || ss.customer_id::text || case
    when not ss.has_signed_power_of_attorney then '?tab=authorization-documents'
    when nullif(ss.facility_id, '') is null or not ss.has_metering_point or ss.grid_owner_id is null or ss.price_area_code is null or ss.has_open_data_request then '?tab=data-requests'
    else '?tab=switch-operations'
  end as href
from site_status ss
where ss.has_open_data_request
   or not ss.has_signed_power_of_attorney
   or ss.grid_owner_id is null
   or nullif(ss.facility_id, '') is null
   or not ss.has_metering_point
   or ss.price_area_code is null;

revoke all on public.gridex_facility_work_queue_v from anon;
grant select on public.gridex_facility_work_queue_v to authenticated;

create or replace function public.gridex_get_facility_work_queue(p_company_id uuid, p_limit integer default 200)
returns setof public.gridex_facility_work_queue_v
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.gridex_facility_work_queue_v
  where p_company_id is null or company_id = p_company_id
  order by
    case priority when 'critical' then 4 when 'high' then 3 when 'normal' then 2 else 1 end desc,
    updated_at desc nulls last,
    created_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 200), 500))
$$;

grant execute on function public.gridex_get_facility_work_queue(uuid, integer) to authenticated, service_role;

-- OPS status marker: facility_data_requested means anläggningsuppgifter har begärts från nätägare.
