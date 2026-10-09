-- Market-data writers (spot price import, spot settlement lock, SVK geodata
-- import) insert company-less events without event_scope, so the column
-- default 'tenant' violates canonical_energy_flow_events_scope_check and the
-- import/lock fails. Classify only known market-data event families as
-- platform scope. Every other company-less row keeps 'tenant' and is still
-- rejected by the check, so no tenant event can become platform-readable.

create or replace function public.gridex_canonical_energy_event_platform_scope_v1()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.company_id is null
     and new.event_scope = 'tenant'
     and (new.event_type like 'market_price.%' or new.event_type like 'energy_geodata.%') then
    new.event_scope := 'platform';
  end if;
  return new;
end;
$$;

revoke all on function public.gridex_canonical_energy_event_platform_scope_v1() from public, anon, authenticated;

drop trigger if exists canonical_energy_flow_events_platform_scope on public.canonical_energy_flow_events;
create trigger canonical_energy_flow_events_platform_scope
  before insert on public.canonical_energy_flow_events
  for each row execute function public.gridex_canonical_energy_event_platform_scope_v1();
