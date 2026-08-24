-- Gridex inbound operations foundation.
--
-- Additive, forward-only foundation for cross-transport inbound orchestration.
-- E-mail/EDIFACT/API remain transport-specific sources; this table is only the
-- correlation/orchestration index above them. No business source is duplicated.

-- ---------------------------------------------------------------------------
-- 1) Enrich manual inbound messages with deterministic correlation evidence.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.manual_inbound_messages') is not null then
    alter table public.manual_inbound_messages
      add column if not exists in_reply_to text,
      add column if not exists reference_message_ids jsonb not null default '[]'::jsonb,
      add column if not exists mailbox_company_id uuid references public.companies(id) on delete set null,
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

    create index if not exists manual_inbound_messages_mailbox_provider_idx
      on public.manual_inbound_messages (mailbox, provider_message_id)
      where provider_message_id is not null;
    create index if not exists manual_inbound_messages_company_customer_idx
      on public.manual_inbound_messages (company_id, customer_id, received_at desc)
      where company_id is not null and customer_id is not null;
    create index if not exists manual_inbound_messages_company_site_idx
      on public.manual_inbound_messages (company_id, customer_site_id, received_at desc)
      where company_id is not null and customer_site_id is not null;
    create index if not exists manual_inbound_messages_in_reply_to_idx
      on public.manual_inbound_messages (in_reply_to)
      where in_reply_to is not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Cross-transport orchestration index. Original payload remains in source.
-- ---------------------------------------------------------------------------
create table if not exists public.inbound_operation_events (
  id uuid primary key default gen_random_uuid(),
  source_transport text not null check (source_transport in ('edifact','email','webhook','api')),
  source_id text not null,
  company_id uuid references public.companies(id) on delete set null,
  tenant_resolution_status text not null check (tenant_resolution_status in ('matched','ambiguous','unmatched','ignored')),
  tenant_resolution_method text,
  business_process text,
  intent text,
  intent_confidence numeric(5,4),
  grid_owner_id uuid,
  customer_id uuid,
  customer_site_id uuid,
  metering_point_id uuid,
  business_object_id text,
  processing_state text not null default 'received' check (processing_state in (
    'received','normalized','matched','ambiguous','needs_review','applied','supplemental_evidence','conflict','ignored','unmatched','failed'
  )),
  evidence jsonb not null default '{}'::jsonb,
  business_event_fingerprint text,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists inbound_operation_events_idempotency_uidx
  on public.inbound_operation_events (idempotency_key);
create index if not exists inbound_operation_events_company_created_idx
  on public.inbound_operation_events (company_id, created_at desc)
  where company_id is not null;
create index if not exists inbound_operation_events_customer_created_idx
  on public.inbound_operation_events (company_id, customer_id, created_at desc)
  where company_id is not null and customer_id is not null;
create index if not exists inbound_operation_events_fingerprint_idx
  on public.inbound_operation_events (business_event_fingerprint)
  where business_event_fingerprint is not null;

alter table public.inbound_operation_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'inbound_operation_events'
      and policyname = 'inbound_operation_events_read'
  ) then
    create policy inbound_operation_events_read
      on public.inbound_operation_events
      for select
      using (
        auth.role() = 'service_role'
        or public.gridex_user_is_platform_admin()
        or (company_id is not null and public.gridex_can_read_company(company_id))
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'inbound_operation_events'
      and policyname = 'inbound_operation_events_write'
  ) then
    create policy inbound_operation_events_write
      on public.inbound_operation_events
      for all
      using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin())
      with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
end $$;

comment on table public.inbound_operation_events is
  'Cross-transport inbound orchestration index. source_id points to the canonical transport row; raw payload remains in the source table.';
