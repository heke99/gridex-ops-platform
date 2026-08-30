begin;

insert into public.companies (id, name)
values
  ('00000000-0000-4000-8000-00000000a001'::uuid, 'GRIDEX tenant graph regression A'),
  ('00000000-0000-4000-8000-00000000b001'::uuid, 'GRIDEX tenant graph regression B');

insert into public.customers (id, company_id, customer_number, name, customer_type)
values
  ('00000000-0000-4000-8000-00000000a101'::uuid, '00000000-0000-4000-8000-00000000a001'::uuid, 'TG-A-1', 'Tenant graph A customer', 'private'),
  ('00000000-0000-4000-8000-00000000a102'::uuid, '00000000-0000-4000-8000-00000000a001'::uuid, 'TG-A-2', 'Tenant graph A second customer', 'private'),
  ('00000000-0000-4000-8000-00000000b101'::uuid, '00000000-0000-4000-8000-00000000b001'::uuid, 'TG-B-1', 'Tenant graph B customer', 'private');

insert into public.customer_sites (id, company_id, customer_id, site_name, site_type, status, country)
values
  ('00000000-0000-4000-8000-00000000a201'::uuid, '00000000-0000-4000-8000-00000000a001'::uuid, '00000000-0000-4000-8000-00000000a101'::uuid, 'Tenant graph A site', 'consumption', 'active', 'SE'),
  ('00000000-0000-4000-8000-00000000a202'::uuid, '00000000-0000-4000-8000-00000000a001'::uuid, '00000000-0000-4000-8000-00000000a102'::uuid, 'Tenant graph A second site', 'consumption', 'active', 'SE'),
  ('00000000-0000-4000-8000-00000000b201'::uuid, '00000000-0000-4000-8000-00000000b001'::uuid, '00000000-0000-4000-8000-00000000b101'::uuid, 'Tenant graph B site', 'consumption', 'active', 'SE');

insert into public.metering_points (
  id, company_id, customer_id, site_id, customer_site_id,
  metering_point_id, reading_frequency, measurement_type, is_settlement_relevant
)
values
  ('00000000-0000-4000-8000-00000000a301'::uuid, '00000000-0000-4000-8000-00000000a001'::uuid, '00000000-0000-4000-8000-00000000a101'::uuid, '00000000-0000-4000-8000-00000000a201'::uuid, '00000000-0000-4000-8000-00000000a201'::uuid, 'TG-A-MP-1', 'hourly', 'consumption', true),
  ('00000000-0000-4000-8000-00000000b301'::uuid, '00000000-0000-4000-8000-00000000b001'::uuid, '00000000-0000-4000-8000-00000000b101'::uuid, '00000000-0000-4000-8000-00000000b201'::uuid, '00000000-0000-4000-8000-00000000b201'::uuid, 'TG-B-MP-1', 'hourly', 'consumption', true);

insert into public.manual_inbound_messages (id, company_id, customer_id, customer_site_id, metering_point_id)
values (
  '00000000-0000-4000-8000-00000000a401'::uuid,
  '00000000-0000-4000-8000-00000000a001'::uuid,
  '00000000-0000-4000-8000-00000000a101'::uuid,
  '00000000-0000-4000-8000-00000000a201'::uuid,
  '00000000-0000-4000-8000-00000000a301'::uuid
);

do $$
declare rejected boolean := false;
begin
  begin
    update public.manual_inbound_messages
       set customer_id = '00000000-0000-4000-8000-00000000b101'::uuid
     where id = '00000000-0000-4000-8000-00000000a401'::uuid;
  exception when foreign_key_violation or check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'cross-tenant customer write was not rejected';
  end if;
end $$;

do $$
declare rejected boolean := false;
begin
  begin
    update public.manual_inbound_messages
       set customer_site_id = '00000000-0000-4000-8000-00000000a202'::uuid
     where id = '00000000-0000-4000-8000-00000000a401'::uuid;
  exception when foreign_key_violation or check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'wrong customer/site write was not rejected';
  end if;
end $$;

do $$
declare rejected boolean := false;
begin
  begin
    update public.manual_inbound_messages
       set metering_point_id = '00000000-0000-4000-8000-00000000b301'::uuid
     where id = '00000000-0000-4000-8000-00000000a401'::uuid;
  exception when foreign_key_violation or check_violation then
    rejected := true;
  end;
  if not rejected then
    raise exception 'wrong tenant metering point write was not rejected';
  end if;
end $$;

rollback;
