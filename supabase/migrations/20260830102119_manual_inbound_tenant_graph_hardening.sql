create unique index if not exists metering_points_company_customer_site_row_uidx
  on public.metering_points (company_id, customer_id, site_id, id);

alter table public.manual_inbound_messages
  add constraint manual_inbound_customer_requires_company_ck
    check (customer_id is null or company_id is not null) not valid,
  add constraint manual_inbound_site_requires_customer_ck
    check (customer_site_id is null or (company_id is not null and customer_id is not null)) not valid,
  add constraint manual_inbound_meter_requires_site_ck
    check (metering_point_id is null or (company_id is not null and customer_id is not null and customer_site_id is not null)) not valid;

alter table public.manual_inbound_messages
  add constraint manual_inbound_company_customer_fk
    foreign key (company_id, customer_id)
    references public.customers(company_id, id)
    on delete set null (customer_id)
    not valid,
  add constraint manual_inbound_company_customer_site_fk
    foreign key (company_id, customer_id, customer_site_id)
    references public.customer_sites(company_id, customer_id, id)
    on delete set null (customer_site_id)
    not valid,
  add constraint manual_inbound_company_customer_site_meter_fk
    foreign key (company_id, customer_id, customer_site_id, metering_point_id)
    references public.metering_points(company_id, customer_id, site_id, id)
    on delete set null (metering_point_id)
    not valid;

alter table public.manual_inbound_messages validate constraint manual_inbound_customer_requires_company_ck;
alter table public.manual_inbound_messages validate constraint manual_inbound_site_requires_customer_ck;
alter table public.manual_inbound_messages validate constraint manual_inbound_meter_requires_site_ck;
alter table public.manual_inbound_messages validate constraint manual_inbound_company_customer_fk;
alter table public.manual_inbound_messages validate constraint manual_inbound_company_customer_site_fk;
alter table public.manual_inbound_messages validate constraint manual_inbound_company_customer_site_meter_fk;
