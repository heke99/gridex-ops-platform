-- Final hardening for Batch 1-5:
-- 1) allow customer_masterdata as a real outbound/route scope for PRODAT Z01/Z02
-- 2) keep constraints idempotent so older environments can migrate safely

do $$
declare
  constraint_row record;
begin
  if to_regclass('public.communication_routes') is not null then
    for constraint_row in
      select conname
      from pg_constraint
      where conrelid = 'public.communication_routes'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%route_scope%'
    loop
      execute format('alter table public.communication_routes drop constraint if exists %I', constraint_row.conname);
    end loop;

    alter table public.communication_routes
      add constraint communication_routes_route_scope_check
      check (route_scope in ('supplier_switch', 'customer_masterdata', 'meter_values', 'billing_underlay'))
      not valid;

    alter table public.communication_routes validate constraint communication_routes_route_scope_check;
  end if;

  if to_regclass('public.outbound_requests') is not null then
    for constraint_row in
      select conname
      from pg_constraint
      where conrelid = 'public.outbound_requests'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) ilike '%request_type%'
    loop
      execute format('alter table public.outbound_requests drop constraint if exists %I', constraint_row.conname);
    end loop;

    alter table public.outbound_requests
      add constraint outbound_requests_request_type_check
      check (request_type in ('supplier_switch', 'customer_masterdata', 'meter_values', 'billing_underlay'))
      not valid;

    alter table public.outbound_requests validate constraint outbound_requests_request_type_check;
  end if;
end $$;

create index if not exists idx_communication_routes_customer_masterdata
  on public.communication_routes (company_id, route_scope, grid_owner_id, is_active)
  where route_scope = 'customer_masterdata';

create index if not exists idx_outbound_requests_customer_masterdata
  on public.outbound_requests (company_id, source_type, source_id, status)
  where request_type = 'customer_masterdata';
