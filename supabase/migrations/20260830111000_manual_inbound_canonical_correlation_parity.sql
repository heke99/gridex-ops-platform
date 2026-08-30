-- Compatibility replay for repositories that previously tracked this parity migration
-- at 20260830111000. The live database already contains the same schema under
-- 20260830091937; every operation remains idempotent so normal migration deploy can
-- safely converge history without rewriting an applied migration.

alter table public.manual_inbound_messages
  add column if not exists mailbox_company_id uuid,
  add column if not exists in_reply_to text,
  add column if not exists reference_message_ids text[] not null default '{}'::text[],
  add column if not exists grid_owner_id uuid,
  add column if not exists customer_id uuid,
  add column if not exists customer_site_id uuid,
  add column if not exists metering_point_id uuid,
  add column if not exists tenant_resolution_method text,
  add column if not exists entity_resolution_method text,
  add column if not exists correlation_evidence jsonb not null default '{}'::jsonb,
  add column if not exists normalized_text text,
  add column if not exists business_process text,
  add column if not exists intent text,
  add column if not exists processing_state text not null default 'received';

create index if not exists manual_inbound_messages_processing_idx
  on public.manual_inbound_messages (processing_state, received_at desc);

create index if not exists manual_inbound_messages_customer_idx
  on public.manual_inbound_messages (company_id, customer_id, received_at desc)
  where customer_id is not null;

create index if not exists manual_inbound_messages_site_idx
  on public.manual_inbound_messages (company_id, customer_site_id, received_at desc)
  where customer_site_id is not null;

create index if not exists manual_inbound_messages_metering_point_idx
  on public.manual_inbound_messages (company_id, metering_point_id, received_at desc)
  where metering_point_id is not null;

create index if not exists manual_inbound_messages_grid_owner_idx
  on public.manual_inbound_messages (grid_owner_id, received_at desc)
  where grid_owner_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'manual_inbound_messages_mailbox_company_id_fkey') then
    alter table public.manual_inbound_messages add constraint manual_inbound_messages_mailbox_company_id_fkey foreign key (mailbox_company_id) references public.companies(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'manual_inbound_messages_grid_owner_id_fkey') then
    alter table public.manual_inbound_messages add constraint manual_inbound_messages_grid_owner_id_fkey foreign key (grid_owner_id) references public.grid_owners(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'manual_inbound_messages_customer_id_fkey') then
    alter table public.manual_inbound_messages add constraint manual_inbound_messages_customer_id_fkey foreign key (customer_id) references public.customers(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'manual_inbound_messages_customer_site_id_fkey') then
    alter table public.manual_inbound_messages add constraint manual_inbound_messages_customer_site_id_fkey foreign key (customer_site_id) references public.customer_sites(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'manual_inbound_messages_metering_point_id_fkey') then
    alter table public.manual_inbound_messages add constraint manual_inbound_messages_metering_point_id_fkey foreign key (metering_point_id) references public.metering_points(id) on delete set null;
  end if;
end
$$;

comment on column public.manual_inbound_messages.processing_state is
  'Canonical manual-inbound processing state; raw mail starts as received and is enriched by the correlation engine.';
