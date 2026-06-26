-- Gridex manual grid-owner communication pipeline (Batch: manual facility intake & POA).
--
-- Strictly additive, idempotent, RLS-safe. No DROP of business tables, no
-- destructive DELETE, no data rewrites. CHECK constraints are only rebuilt by
-- "drop constraint if exists" + "add constraint" while preserving every existing
-- allowed value and adding the new ones (backwards compatible).
--
-- Adds the manual (non-Ediel) communication pipeline used for missing facility
-- information, power of attorney evidence and grid-owner exception handling:
--   * powers_of_attorney evidence columns (signer, method, evidence, document, source)
--   * power_of_attorney_events audit trail
--   * grid_owner_contact_channels (platform default + tenant override)
--   * grid_owner_information_requests manual-email channel/status/columns
--   * manual_email_outbox (worker-sent via Resend, idempotent)
--   * manual_inbound_messages (shared mailbox / webhook replies)
--
-- Manual e-mail is NOT Ediel: nothing here touches ediel_outbox / ediel_messages.

-- ---------------------------------------------------------------------------
-- 1) powers_of_attorney: additive evidence + provenance columns
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.powers_of_attorney') is not null then
    alter table public.powers_of_attorney
      add column if not exists signer_name text,
      add column if not exists signer_identity_number text,
      add column if not exists method text,
      add column if not exists evidence_payload jsonb not null default '{}'::jsonb,
      add column if not exists document_id uuid,
      add column if not exists source text;

    create index if not exists powers_of_attorney_company_customer_site_status_idx
      on public.powers_of_attorney (company_id, customer_id, customer_site_id, status);
  end if;
end $$;

comment on column public.powers_of_attorney.method is
  'How the POA was captured: website_acceptance | uploaded_pdf | manual | bankid_future. Additive, nullable.';
comment on column public.powers_of_attorney.source is
  'Origin of the POA row: website_api | manual_intake | admin_upload. Additive, nullable.';
comment on column public.powers_of_attorney.evidence_payload is
  'Immutable acceptance evidence (acceptedAt, IP, user agent, signer data, source). Additive.';

-- ---------------------------------------------------------------------------
-- 2) power_of_attorney_events: audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.power_of_attorney_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  power_of_attorney_id uuid not null,
  event_type text not null check (event_type in (
    'created','accepted','pdf_generated','attached_to_email','revoked','expired'
  )),
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists power_of_attorney_events_poa_idx
  on public.power_of_attorney_events (company_id, power_of_attorney_id, created_at desc);

alter table public.power_of_attorney_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'power_of_attorney_events' and policyname = 'power_of_attorney_events_tenant_read') then
    create policy power_of_attorney_events_tenant_read on public.power_of_attorney_events for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'power_of_attorney_events' and policyname = 'power_of_attorney_events_tenant_write') then
    create policy power_of_attorney_events_tenant_write on public.power_of_attorney_events for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(company_id)) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_user_can_manage_company(company_id));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) grid_owner_contact_channels: platform default + tenant override
-- ---------------------------------------------------------------------------
create table if not exists public.grid_owner_contact_channels (
  id uuid primary key default gen_random_uuid(),
  grid_owner_id uuid not null,
  company_id uuid references public.companies(id) on delete cascade,
  channel_type text not null check (channel_type in (
    'facility_information_request','supplier_switch_manual','power_of_attorney','ai_list','escalation'
  )),
  email text,
  phone text,
  label text,
  is_enabled boolean not null default true,
  is_verified boolean not null default false,
  source text not null default 'manual_admin' check (source in (
    'platform_default','tenant_override','imported_actor_registry','manual_admin'
  )),
  verified_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- platform default usable by tenants when company_id is null; tenant override when set.
create index if not exists grid_owner_contact_channels_owner_type_idx
  on public.grid_owner_contact_channels (grid_owner_id, channel_type, is_enabled);
create index if not exists grid_owner_contact_channels_company_owner_type_idx
  on public.grid_owner_contact_channels (company_id, grid_owner_id, channel_type, is_enabled);
create unique index if not exists grid_owner_contact_channels_default_uidx
  on public.grid_owner_contact_channels (grid_owner_id, channel_type)
  where company_id is null;
create unique index if not exists grid_owner_contact_channels_override_uidx
  on public.grid_owner_contact_channels (company_id, grid_owner_id, channel_type)
  where company_id is not null;

alter table public.grid_owner_contact_channels enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'grid_owner_contact_channels' and policyname = 'grid_owner_contact_channels_read') then
    create policy grid_owner_contact_channels_read on public.grid_owner_contact_channels for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or company_id is null or public.gridex_can_read_company(company_id));
  end if;
  -- Platform defaults (company_id is null) are platform-admin managed; tenant overrides are tenant managed.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'grid_owner_contact_channels' and policyname = 'grid_owner_contact_channels_platform_write') then
    create policy grid_owner_contact_channels_platform_write on public.grid_owner_contact_channels for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'grid_owner_contact_channels' and policyname = 'grid_owner_contact_channels_tenant_write') then
    create policy grid_owner_contact_channels_tenant_write on public.grid_owner_contact_channels for all using (auth.role() = 'service_role' or (company_id is not null and public.gridex_user_can_manage_company(company_id))) with check (auth.role() = 'service_role' or (company_id is not null and public.gridex_user_can_manage_company(company_id)));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) grid_owner_information_requests: manual-email channel/status/columns
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.grid_owner_information_requests') is not null then
    -- Widen request_type (preserve existing + add manual exception families).
    alter table public.grid_owner_information_requests drop constraint if exists grid_owner_information_requests_request_type_check;
    alter table public.grid_owner_information_requests
      add constraint grid_owner_information_requests_request_type_check check (request_type in (
        'facility_lookup','metering_point_lookup','grid_area_confirmation','metering_values_request','switch_prerequisite_check',
        'facility_identifier_lookup','supplier_switch_manual','grid_contract_information','ai_list_request'
      ));

    -- Widen channel (preserve existing + add manual pipeline channels).
    alter table public.grid_owner_information_requests drop constraint if exists grid_owner_information_requests_channel_check;
    alter table public.grid_owner_information_requests
      add constraint grid_owner_information_requests_channel_check check (channel in (
        'email','ediel','portal','manual',
        'manual_email','ediel_prodat','manual_phone','ai_list','manual_upload'
      ));

    -- Widen status (preserve every existing value + add manual lifecycle states).
    alter table public.grid_owner_information_requests drop constraint if exists grid_owner_information_requests_status_check;
    alter table public.grid_owner_information_requests
      add constraint grid_owner_information_requests_status_check check (status in (
        'draft','ready_to_send','sent','waiting_response','received','completed','failed','needs_review',
        'facility_data_invalid','customer_information_mismatch','grid_owner_rejected_request','negative_aperak_received',
        'z02_rejected','needs_customer_correction','needs_grid_owner_followup','timeout','retry_blocked',
        'blocked_missing_poa','blocked_missing_grid_owner_contact','ready_to_send_manual_email',
        'manual_email_queued','manual_email_sent','waiting_manual_response','manual_response_received',
        'manual_response_parsed','cancelled'
      ));

    -- Manual pipeline columns.
    alter table public.grid_owner_information_requests
      add column if not exists case_reference text,
      add column if not exists recipient_email text,
      add column if not exists from_email text,
      add column if not exists reply_to text,
      add column if not exists parsed_payload jsonb not null default '{}'::jsonb,
      add column if not exists confidence_score numeric(5,4),
      add column if not exists due_at timestamptz,
      add column if not exists next_follow_up_at timestamptz,
      add column if not exists follow_up_count integer not null default 0,
      add column if not exists last_error_code text,
      add column if not exists last_error_message text,
      add column if not exists updated_by uuid;

    -- Indexes for the manual query paths.
    create unique index if not exists grid_owner_information_requests_case_reference_uidx
      on public.grid_owner_information_requests (case_reference)
      where case_reference is not null;
    create index if not exists grid_owner_information_requests_company_channel_status_idx
      on public.grid_owner_information_requests (company_id, channel, status, updated_at desc);
    create index if not exists grid_owner_information_requests_company_site_type_status_idx
      on public.grid_owner_information_requests (company_id, customer_site_id, request_type, status);

    -- Recreate the open-request uniqueness to also cover manual-open statuses so
    -- repeated clicks reuse an existing open request (idempotency).
    drop index if exists public.grid_owner_information_requests_open_uidx;
    create unique index if not exists grid_owner_information_requests_open_uidx
      on public.grid_owner_information_requests (company_id, customer_site_id, request_type)
      where status in (
        'draft','ready_to_send','sent','waiting_response','needs_review',
        'blocked_missing_poa','blocked_missing_grid_owner_contact','ready_to_send_manual_email',
        'manual_email_queued','manual_email_sent','waiting_manual_response','manual_response_received'
      );
  end if;
end $$;

-- Widen dispatch_status (preserve existing + add response_received / blocked).
do $$
begin
  if to_regclass('public.grid_owner_information_requests') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'grid_owner_information_requests' and column_name = 'dispatch_status'
     ) then
    alter table public.grid_owner_information_requests drop constraint if exists grid_owner_information_requests_dispatch_status_check;
    alter table public.grid_owner_information_requests
      add constraint grid_owner_information_requests_dispatch_status_check check (dispatch_status in (
        'not_started','ready','blocked','queued','sent','waiting_response','response_received','completed','failed','skipped'
      ));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5) manual_email_outbox: worker-sent (Resend), idempotent
-- ---------------------------------------------------------------------------
create table if not exists public.manual_email_outbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  request_id uuid references public.grid_owner_information_requests(id) on delete set null,
  to_email text not null,
  from_email text,
  reply_to text,
  subject text not null,
  body_html text not null default '',
  body_text text,
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  provider text not null default 'resend',
  provider_message_id text,
  idempotency_key text not null,
  attempts integer not null default 0,
  last_error text,
  locked_at timestamptz,
  locked_by text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists manual_email_outbox_idempotency_uidx
  on public.manual_email_outbox (idempotency_key);
create index if not exists manual_email_outbox_status_queued_idx
  on public.manual_email_outbox (status, queued_at);
create index if not exists manual_email_outbox_company_status_queued_idx
  on public.manual_email_outbox (company_id, status, queued_at);
create index if not exists manual_email_outbox_request_idx
  on public.manual_email_outbox (request_id) where request_id is not null;

alter table public.manual_email_outbox enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'manual_email_outbox' and policyname = 'manual_email_outbox_tenant_read') then
    create policy manual_email_outbox_tenant_read on public.manual_email_outbox for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or public.gridex_can_read_company(company_id));
  end if;
  -- Sending is performed by the worker (service role); platform admins may intervene.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'manual_email_outbox' and policyname = 'manual_email_outbox_write') then
    create policy manual_email_outbox_write on public.manual_email_outbox for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6) manual_inbound_messages: shared mailbox / webhook replies
-- ---------------------------------------------------------------------------
create table if not exists public.manual_inbound_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  request_id uuid references public.grid_owner_information_requests(id) on delete set null,
  mailbox text,
  from_email text,
  from_name text,
  to_email text,
  subject text,
  body_text text,
  body_html text,
  received_at timestamptz not null default now(),
  provider_message_id text,
  thread_id text,
  attachments jsonb not null default '[]'::jsonb,
  resolution_status text not null default 'unmatched' check (resolution_status in (
    'matched','ambiguous','unmatched','ignored'
  )),
  extracted_payload jsonb not null default '{}'::jsonb,
  confidence_score numeric(5,4),
  created_at timestamptz not null default now()
);

create index if not exists manual_inbound_messages_request_idx
  on public.manual_inbound_messages (request_id, received_at desc) where request_id is not null;
create index if not exists manual_inbound_messages_provider_idx
  on public.manual_inbound_messages (provider_message_id) where provider_message_id is not null;
create index if not exists manual_inbound_messages_company_idx
  on public.manual_inbound_messages (company_id, received_at desc) where company_id is not null;

alter table public.manual_inbound_messages enable row level security;

do $$
begin
  -- Unresolved (company_id null) rows are only visible to platform admins / service role.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'manual_inbound_messages' and policyname = 'manual_inbound_messages_tenant_read') then
    create policy manual_inbound_messages_tenant_read on public.manual_inbound_messages for select using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin() or (company_id is not null and public.gridex_can_read_company(company_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'manual_inbound_messages' and policyname = 'manual_inbound_messages_write') then
    create policy manual_inbound_messages_write on public.manual_inbound_messages for all using (auth.role() = 'service_role' or public.gridex_user_is_platform_admin()) with check (auth.role() = 'service_role' or public.gridex_user_is_platform_admin());
  end if;
end $$;
