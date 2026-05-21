-- Batch 1/2 completion: import-row action queue hardening, manual review actions, safer row payloads and tenant-test support.
-- Additive/idempotent. Does not touch Ediel generators or approved Ediel facit.

create extension if not exists pgcrypto;

do $$
begin
  if to_regclass('public.customer_import_batches') is not null then
    alter table public.customer_import_batches add column if not exists status text not null default 'previewed';
    alter table public.customer_import_batches add column if not exists metadata jsonb not null default '{}'::jsonb;
    alter table public.customer_import_batches add column if not exists warnings jsonb not null default '[]'::jsonb;
    alter table public.customer_import_batches add column if not exists issues jsonb not null default '[]'::jsonb;
    alter table public.customer_import_batches add column if not exists imported_at timestamptz null;

    alter table public.customer_import_batches drop constraint if exists customer_import_batches_status_check;
    alter table public.customer_import_batches
      add constraint customer_import_batches_status_check
      check (status in ('previewed', 'completed', 'failed', 'imported', 'partially_imported')) not valid;
  end if;

  if to_regclass('public.customer_import_rows') is not null then
    alter table public.customer_import_rows add column if not exists company_id uuid null;
    alter table public.customer_import_rows add column if not exists import_batch_id uuid null;
    alter table public.customer_import_rows add column if not exists row_number integer null;
    alter table public.customer_import_rows add column if not exists status text not null default 'pending';
    alter table public.customer_import_rows add column if not exists normalized_payload jsonb not null default '{}'::jsonb;
    alter table public.customer_import_rows add column if not exists raw_payload jsonb not null default '{}'::jsonb;
    alter table public.customer_import_rows add column if not exists customer_id uuid null;
    alter table public.customer_import_rows add column if not exists error_message text null;
    alter table public.customer_import_rows add column if not exists warnings jsonb not null default '[]'::jsonb;
    alter table public.customer_import_rows add column if not exists issues jsonb not null default '{}'::jsonb;
    alter table public.customer_import_rows add column if not exists parser_confidence integer null;
    alter table public.customer_import_rows add column if not exists reviewed_at timestamptz null;
    alter table public.customer_import_rows add column if not exists reviewed_by uuid null;

    alter table public.customer_import_rows drop constraint if exists customer_import_rows_status_check;
    alter table public.customer_import_rows
      add constraint customer_import_rows_status_check
      check (status in (
        'pending',
        'ready_to_create',
        'requires_review',
        'missing_fields',
        'duplicate_warning',
        'created',
        'skipped',
        'failed',
        'rejected'
      )) not valid;

    alter table public.customer_import_rows drop constraint if exists customer_import_rows_parser_confidence_check;
    alter table public.customer_import_rows
      add constraint customer_import_rows_parser_confidence_check
      check (parser_confidence is null or (parser_confidence >= 0 and parser_confidence <= 100)) not valid;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_import_rows' and column_name = 'company_id')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_import_rows' and column_name = 'status')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_import_rows' and column_name = 'created_at') then
      create index if not exists customer_import_rows_company_status_created_idx
        on public.customer_import_rows(company_id, status, created_at desc);
    end if;

    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_import_rows' and column_name = 'import_batch_id') then
      create index if not exists customer_import_rows_batch_row_idx
        on public.customer_import_rows(import_batch_id, row_number);
    end if;
  end if;

  if to_regclass('public.customer_contract_events') is not null then
    alter table public.customer_contract_events add column if not exists company_id uuid null;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contract_events' and column_name = 'customer_id')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_contract_events' and column_name = 'created_at') then
      create index if not exists customer_contract_events_company_customer_created_idx
        on public.customer_contract_events(company_id, customer_id, created_at desc);
    end if;
  end if;
end $$;

-- RLS/policy hardening for the Batch 1/2 customer-intake tables.
-- These policies are deliberately conservative and tenant-scoped for authenticated users.
-- Platform/admin server actions still use service role and explicit guards.
do $$
declare
  r record;
begin
  for r in
    select unnest(array[
      'customers',
      'customer_contacts',
      'customer_addresses',
      'customer_sites',
      'metering_points',
      'customer_contracts',
      'customer_contract_events',
      'powers_of_attorney',
      'customer_info_requests',
      'customer_cases',
      'customer_import_batches',
      'customer_import_rows'
    ]) as table_name
  loop
    if to_regclass('public.' || r.table_name) is not null then
      execute format('alter table public.%I enable row level security', r.table_name);

      if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = r.table_name and column_name = 'company_id'
      ) and to_regclass('public.company_memberships') is not null then
        execute format('drop policy if exists %I on public.%I', 'tenant_members_read_' || r.table_name, r.table_name);
        if to_regclass('public.user_roles') is not null and to_regclass('public.roles') is not null then
          execute format($policy$
            create policy %I on public.%I
            for select
            to authenticated
            using (
              exists (
                select 1
                from public.company_memberships cm
                where cm.company_id = %I.company_id
                  and cm.user_id = auth.uid()
                  and cm.status = 'active'
              )
              or exists (
                select 1
                from public.user_roles ur
                join public.roles ro on ro.id = ur.role_id
                where ur.user_id = auth.uid()
                  and ro.role_key in ('super_admin', 'superadmin', 'platform_admin')
              )
            )
          $policy$, 'tenant_members_read_' || r.table_name, r.table_name, r.table_name);
        else
          execute format($policy$
            create policy %I on public.%I
            for select
            to authenticated
            using (
              exists (
                select 1
                from public.company_memberships cm
                where cm.company_id = %I.company_id
                  and cm.user_id = auth.uid()
                  and cm.status = 'active'
              )
            )
          $policy$, 'tenant_members_read_' || r.table_name, r.table_name, r.table_name);
        end if;
      end if;
    end if;
  end loop;
end $$;
