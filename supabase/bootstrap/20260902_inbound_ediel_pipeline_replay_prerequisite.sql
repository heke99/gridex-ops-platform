-- GRIDEX-REM-002 replay-only prerequisite.
-- Source: migrations/20260528_batch_7a_route_inbound_mail_platform_ui.sql
-- Restore the Batch 7A inbound parser relations omitted by the canonical replay
-- before the recovered tenant-attribution migration references them. This is
-- schema-only; no inbound messages, parser results or match attempts are seeded.

create table if not exists public.inbound_email_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  inbound_email_message_id uuid references public.inbound_email_messages(id) on delete cascade,
  filename text,
  mime_type text,
  size_bytes bigint,
  storage_path text,
  raw_text text,
  is_edifact_candidate boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_inbound_email_attachments_message
  on public.inbound_email_attachments(inbound_email_message_id);

create table if not exists public.inbound_ediel_parse_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  inbound_email_message_id uuid references public.inbound_email_messages(id) on delete cascade,
  message_family text,
  message_code text,
  interchange_reference text,
  transaction_reference text,
  sender_ediel_id text,
  sender_sub_address text,
  receiver_ediel_id text,
  receiver_sub_address text,
  application_reference text,
  parse_status text not null default 'parsed',
  parsed_payload jsonb not null default '{}'::jsonb,
  validation_report jsonb not null default '{}'::jsonb,
  raw_payload text,
  created_at timestamptz not null default now()
);

create index if not exists idx_inbound_ediel_parse_results_company_refs
  on public.inbound_ediel_parse_results(company_id, sender_ediel_id, receiver_ediel_id, interchange_reference, transaction_reference);

create table if not exists public.inbound_ediel_match_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  inbound_email_message_id uuid references public.inbound_email_messages(id) on delete cascade,
  parse_result_id uuid references public.inbound_ediel_parse_results(id) on delete cascade,
  match_type text not null,
  match_status text not null default 'not_checked',
  matched_entity_type text,
  matched_entity_id uuid,
  confidence numeric,
  reasons jsonb not null default '[]'::jsonb,
  candidates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_inbound_ediel_match_attempts_message
  on public.inbound_ediel_match_attempts(inbound_email_message_id, match_type, match_status);

do $$
declare
  t text;
begin
  foreach t in array array[
    'inbound_email_attachments',
    'inbound_ediel_parse_results',
    'inbound_ediel_match_attempts'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_service_role_all', t);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      t || '_service_role_all', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_platform_select', t);
    execute format(
      'create policy %I on public.%I for select using (public.gridex_user_is_platform_admin())',
      t || '_platform_select', t
    );

    execute format('drop policy if exists %I on public.%I', t || '_platform_write', t);
    execute format(
      'create policy %I on public.%I for all using (public.gridex_user_is_platform_admin()) with check (public.gridex_user_is_platform_admin())',
      t || '_platform_write', t
    );
  end loop;
end $$;
