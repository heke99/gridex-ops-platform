create or replace function private.gridex_validate_manual_inbound_tenant_graph()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Preserve the graph invariant during FK lifecycle cleanup. If a parent
  -- reference is cleared, dependent references are cleared in the same row.
  if new.company_id is null then
    new.customer_id := null;
    new.customer_site_id := null;
    new.metering_point_id := null;
  elsif new.customer_id is null then
    new.customer_site_id := null;
    new.metering_point_id := null;
  elsif new.customer_site_id is null then
    new.metering_point_id := null;
  end if;

  if new.customer_id is not null and not exists (
    select 1
      from public.customers c
     where c.id = new.customer_id
       and c.company_id = new.company_id
  ) then
    raise exception 'manual_inbound_messages customer does not belong to company'
      using errcode = '23503';
  end if;

  if new.customer_site_id is not null and not exists (
    select 1
      from public.customer_sites s
     where s.id = new.customer_site_id
       and s.company_id = new.company_id
       and s.customer_id = new.customer_id
  ) then
    raise exception 'manual_inbound_messages site does not belong to company/customer'
      using errcode = '23503';
  end if;

  if new.metering_point_id is not null and not exists (
    select 1
      from public.metering_points mp
     where mp.id = new.metering_point_id
       and mp.company_id = new.company_id
       and mp.customer_id = new.customer_id
       and coalesce(mp.customer_site_id, mp.site_id) = new.customer_site_id
  ) then
    raise exception 'manual_inbound_messages metering point does not belong to company/customer/site'
      using errcode = '23503';
  end if;

  return new;
end
$$;

revoke all on function private.gridex_validate_manual_inbound_tenant_graph() from public;

create trigger manual_inbound_tenant_graph_guard
before insert or update of company_id, customer_id, customer_site_id, metering_point_id
on public.manual_inbound_messages
for each row
execute function private.gridex_validate_manual_inbound_tenant_graph();

alter table public.manual_inbound_messages
  drop constraint if exists manual_inbound_company_customer_site_meter_fk,
  drop constraint if exists manual_inbound_company_customer_site_fk,
  drop constraint if exists manual_inbound_company_customer_fk;

drop index if exists public.metering_points_company_customer_site_row_uidx;
