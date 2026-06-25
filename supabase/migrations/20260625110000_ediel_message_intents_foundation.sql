-- Ediel message intent pipeline foundation.
-- Introduces ediel_message_intents as the mandatory, tenant-safe object that all
-- outbound Ediel rendering/sending must originate from. Additive and idempotent:
-- no DROP of business tables, no destructive DELETE, nullable intent_id links so
-- existing approved Ediel flows keep working until they route through the gate.

create table if not exists public.ediel_message_intents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  environment text not null default 'test',
  market text not null default 'electricity',
  message_family text not null,
  message_code text not null,
  business_process text not null,
  direction text not null default 'outbound',

  sender_ediel_id text not null,
  sender_subaddress text,
  receiver_ediel_id text not null,
  receiver_subaddress text,

  application_reference text not null,
  route_profile_id uuid,
  communication_route_id uuid,
  certificate_profile_id uuid,

  customer_id uuid,
  customer_site_id uuid,
  grid_owner_information_request_id uuid,
  supplier_switch_request_id uuid,
  customer_info_request_id uuid,
  operation_id uuid,

  facility_id text,
  metering_point_id text,
  grid_area_code text,

  requested_effective_date date,
  send_not_before timestamptz,
  send_window_opens_at timestamptz,
  send_window_closes_at timestamptz,

  interchange_reference text not null,
  message_reference text not null,
  transaction_reference text,

  payload jsonb not null default '{}'::jsonb,
  validation_result jsonb not null default '{}'::jsonb,
  blocking_reasons jsonb not null default '[]'::jsonb,
  idempotency_key text not null,

  expected_rule_version text,
  expected_field_matrix_version text,

  ediel_message_id uuid references public.ediel_messages(id) on delete set null,
  outbound_request_id uuid references public.outbound_requests(id) on delete set null,

  validation_status text not null default 'draft',
  render_status text not null default 'not_rendered',
  outbox_status text not null default 'not_queued',

  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'ediel_message_intents'
      and constraint_name = 'ediel_message_intents_validation_status_chk'
  ) then
    alter table public.ediel_message_intents
      add constraint ediel_message_intents_validation_status_chk
      check (validation_status in ('draft', 'blocked', 'validated'));
  end if;

  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'ediel_message_intents'
      and constraint_name = 'ediel_message_intents_render_status_chk'
  ) then
    alter table public.ediel_message_intents
      add constraint ediel_message_intents_render_status_chk
      check (render_status in ('not_rendered', 'rendered', 'failed'));
  end if;

  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'ediel_message_intents'
      and constraint_name = 'ediel_message_intents_outbox_status_chk'
  ) then
    alter table public.ediel_message_intents
      add constraint ediel_message_intents_outbox_status_chk
      check (outbox_status in ('not_queued', 'queued', 'sent', 'failed'));
  end if;

  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'ediel_message_intents'
      and constraint_name = 'ediel_message_intents_direction_chk'
  ) then
    alter table public.ediel_message_intents
      add constraint ediel_message_intents_direction_chk
      check (direction in ('outbound', 'inbound_response'));
  end if;
end $$;

create unique index if not exists ediel_message_intents_idempotency_uidx
  on public.ediel_message_intents (company_id, environment, idempotency_key);

create index if not exists ediel_message_intents_family_code_idx
  on public.ediel_message_intents (company_id, environment, message_family, message_code);

create index if not exists ediel_message_intents_customer_site_idx
  on public.ediel_message_intents (company_id, customer_site_id)
  where customer_site_id is not null;

create index if not exists ediel_message_intents_grid_owner_request_idx
  on public.ediel_message_intents (company_id, grid_owner_information_request_id)
  where grid_owner_information_request_id is not null;

create index if not exists ediel_message_intents_supplier_switch_idx
  on public.ediel_message_intents (company_id, supplier_switch_request_id)
  where supplier_switch_request_id is not null;

create index if not exists ediel_message_intents_validation_status_idx
  on public.ediel_message_intents (company_id, validation_status);

create index if not exists ediel_message_intents_outbox_status_idx
  on public.ediel_message_intents (company_id, outbox_status);

alter table public.ediel_message_intents enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ediel_message_intents'
      and policyname = 'ediel_message_intents_read_company_or_platform'
  ) then
    create policy ediel_message_intents_read_company_or_platform
      on public.ediel_message_intents
      for select
      using (
        ((select auth.role()) = 'service_role')
        or (select public.gridex_user_is_platform_admin())
        or public.gridex_can_read_company(company_id)
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ediel_message_intents'
      and policyname = 'ediel_message_intents_write_company_or_service'
  ) then
    create policy ediel_message_intents_write_company_or_service
      on public.ediel_message_intents
      for all
      using (
        ((select auth.role()) = 'service_role')
        or (select public.gridex_user_is_platform_admin())
        or public.gridex_can_write_company(company_id)
      )
      with check (
        ((select auth.role()) = 'service_role')
        or (select public.gridex_user_is_platform_admin())
        or public.gridex_can_write_company(company_id)
      );
  end if;
end $$;

drop trigger if exists trg_ediel_message_intents_updated_at on public.ediel_message_intents;
create trigger trg_ediel_message_intents_updated_at
  before update on public.ediel_message_intents
  for each row execute function public.set_updated_at_timestamp();

-- Link existing message + outbox rows back to the intent that produced them.
alter table if exists public.ediel_messages
  add column if not exists intent_id uuid references public.ediel_message_intents(id) on delete set null;

alter table if exists public.ediel_outbox
  add column if not exists intent_id uuid references public.ediel_message_intents(id) on delete set null;

create index if not exists ediel_messages_intent_idx
  on public.ediel_messages (intent_id)
  where intent_id is not null;

create index if not exists ediel_outbox_intent_idx
  on public.ediel_outbox (intent_id)
  where intent_id is not null;

comment on table public.ediel_message_intents is 'Mandatory pre-render object for outbound Ediel. Business processes create intents only; RenderGateway validates and renders.';
comment on column public.ediel_message_intents.application_reference is 'Policy-driven Application Reference. Route profile may declare an expected value but must not override policy.';
comment on column public.ediel_message_intents.blocking_reasons is 'Structured list of blocking reason codes/messages that prevented validation/render/queue.';
comment on column public.ediel_message_intents.idempotency_key is 'Deterministic key; unique per (company_id, environment) to prevent duplicate intents/outbox.';
comment on column public.ediel_messages.intent_id is 'EdielMessageIntent that produced this message (null for legacy/inbound rows).';
comment on column public.ediel_outbox.intent_id is 'EdielMessageIntent that produced this outbox item (null for legacy rows).';
