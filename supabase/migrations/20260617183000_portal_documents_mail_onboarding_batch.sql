-- Portal documents, mail cron readiness, onboarding work queue and API client cleanup.
-- This migration is idempotent and does not UPDATE immutable customer_legal_acceptances.

begin;

-- Identity columns used by tenant website/customer portal contract.
do $$
begin
  if to_regclass('public.customers') is not null then
    alter table public.customers add column if not exists external_customer_id text null;
  end if;
  if to_regclass('public.powers_of_attorney') is not null then
    alter table public.powers_of_attorney add column if not exists customer_number text null;
    alter table public.powers_of_attorney add column if not exists external_customer_id text null;
  end if;
end $$;

-- Customer documents must be able to represent generated/snapshot documents from signed POA records.
do $$
begin
  if to_regclass('public.customer_documents') is not null then
    alter table public.customer_documents add column if not exists customer_site_id uuid null;
    alter table public.customer_documents add column if not exists metering_point_id uuid null;
    alter table public.customer_documents add column if not exists contract_id uuid null;
    alter table public.customer_documents add column if not exists customer_contract_id uuid null;
    alter table public.customer_documents add column if not exists power_of_attorney_id uuid null;
    alter table public.customer_documents add column if not exists status text not null default 'available';
    alter table public.customer_documents add column if not exists raw_payload jsonb not null default '{}'::jsonb;
    alter table public.customer_documents add column if not exists metadata jsonb not null default '{}'::jsonb;
    alter table public.customer_documents add column if not exists document_version text null;
    alter table public.customer_documents add column if not exists storage_key text null;
    alter table public.customer_documents add column if not exists source text null;
    alter table public.customer_documents add column if not exists audit jsonb not null default '{}'::jsonb;
    alter table public.customer_documents add column if not exists customer_number text null;
    alter table public.customer_documents add column if not exists external_customer_id text null;
  end if;
end $$;

do $$
begin
  if to_regclass('public.customer_documents') is not null then
    create index if not exists customer_documents_company_customer_type_idx
      on public.customer_documents(company_id, customer_id, document_type, created_at desc);

    create unique index if not exists customer_documents_power_of_attorney_uidx
      on public.customer_documents(company_id, power_of_attorney_id)
      where power_of_attorney_id is not null and document_type = 'power_of_attorney';
  end if;
end $$;

-- Backfill signed fullmakter to customer_documents without touching legal acceptance rows.
do $$
begin
  if to_regclass('public.customer_documents') is not null and to_regclass('public.powers_of_attorney') is not null then
    insert into public.customer_documents (
      company_id,
      customer_id,
      customer_site_id,
      metering_point_id,
      contract_id,
      customer_contract_id,
      power_of_attorney_id,
      document_type,
      title,
      file_name,
      mime_type,
      source_system,
      source,
      status,
      customer_number,
      external_customer_id,
      raw_payload,
      metadata,
      audit,
      created_at,
      updated_at
    )
    select
      p.company_id,
      p.customer_id,
      coalesce(p.customer_site_id, p.site_id),
      p.metering_point_id,
      p.contract_id,
      p.customer_contract_id,
      p.id,
      'power_of_attorney',
      coalesce('Signerad fullmakt ' || nullif(p.reference, ''), 'Signerad fullmakt'),
      'fullmakt-' || coalesce(nullif(p.reference, ''), p.id::text) || '.json',
      'application/json',
      'ops_powers_of_attorney',
      'powers_of_attorney_backfill',
      'available',
      coalesce(p.customer_number, c.customer_number),
      coalesce(p.external_customer_id, c.external_customer_id),
      jsonb_build_object(
        'source', 'powers_of_attorney',
        'power_of_attorney_id', p.id,
        'reference', p.reference,
        'scope', p.scope,
        'status', p.status,
        'accepted_at', coalesce(p.accepted_at, p.signed_at),
        'signed_at', p.signed_at,
        'valid_from', p.valid_from,
        'valid_to', p.valid_to,
        'valid_until', p.valid_until,
        'legal_text_version_id', p.legal_text_version_id,
        'snapshot', coalesce(p.fullmakt_snapshot, '{}'::jsonb)
      ),
      jsonb_build_object(
        'generated_from', 'powers_of_attorney.fullmakt_snapshot',
        'generated_by', 'migration_20260617183000',
        'document_kind', 'power_of_attorney_snapshot',
        'power_of_attorney_id', p.id,
        'reference', p.reference,
        'accepted_at', coalesce(p.accepted_at, p.signed_at),
        'immutable_legal_acceptances', 'not_updated'
      ),
      jsonb_build_object(
        'created_from', 'migration_backfill',
        'legal_acceptances_mutated', false
      ),
      coalesce(p.accepted_at, p.signed_at, p.created_at, now()),
      now()
    from public.powers_of_attorney p
    left join public.customers c on c.id = p.customer_id and c.company_id = p.company_id
    where p.status = 'signed'
      and not exists (
        select 1
        from public.customer_documents d
        where d.company_id = p.company_id
          and d.power_of_attorney_id = p.id
          and d.document_type = 'power_of_attorney'
      );
  end if;
end $$;

-- Do not require document_path for a signed POA in data readiness. Preserve evidence via accepted_at/signed_at/snapshot.
-- Runtime code also applies this rule.

-- Track email outbox cron runs so admins can see whether automation is alive.
create table if not exists public.tenant_email_outbox_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete set null,
  status text not null default 'completed',
  scanned integer not null default 0,
  claimed integer not null default 0,
  sent integer not null default 0,
  retried integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tenant_email_outbox_runs_company_created_idx
  on public.tenant_email_outbox_runs(company_id, created_at desc);

-- Index open customer work tasks; runtime code dedupes without risking migration failure on historic duplicates.
do $$
begin
  if to_regclass('public.customer_operation_tasks') is not null then
    create index if not exists customer_operation_tasks_open_lookup_idx
      on public.customer_operation_tasks(company_id, customer_id, site_id, task_type, status)
      where status in ('open','in_progress','blocked');
  end if;
end $$;

-- Soft-revoke duplicate Gridex website API clients. Keep the most recently used/created active client per company/name.
do $$
begin
  if to_regclass('public.integration_api_clients') is not null then
    alter table public.integration_api_clients drop constraint if exists integration_api_clients_status_check;
    alter table public.integration_api_clients
      add constraint integration_api_clients_status_check check (status in ('active','paused','disabled','revoked','expired'));

    with ranked as (
      select
        id,
        row_number() over (
          partition by company_id, name
          order by coalesce(last_used_at, created_at) desc nulls last, created_at desc nulls last, id desc
        ) as rn
      from public.integration_api_clients
      where deleted_at is null
        and status = 'active'
        and lower(coalesce(name, '')) = lower('Gridex hemsida · Mina sidor')
    )
    update public.integration_api_clients c
    set
      status = 'revoked',
      revoked_at = coalesce(c.revoked_at, now()),
      revoke_reason = coalesce(nullif(c.revoke_reason, ''), 'duplicate_client_replaced'),
      metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object('soft_revoked_by_migration', '20260617183000', 'reason', 'duplicate_client_replaced'),
      updated_at = now()
    from ranked r
    where c.id = r.id
      and r.rn > 1
      and c.status = 'active';
  end if;
end $$;

commit;
