-- Batch 6C: Metering, billing readiness, audit and tenant-safety hardening.
-- Idempotent. Keeps export granular: one incomplete customer/underlay is flagged and skipped, not used as a global export blocker.

create extension if not exists pgcrypto;

-- Ensure core operational rows are company-scoped.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'grid_owner_data_requests',
    'metering_values',
    'billing_underlays',
    'partner_exports',
    'outbound_requests',
    'audit_logs'
  ] loop
    if to_regclass('public.' || target_table) is not null then
      execute format('alter table public.%I add column if not exists company_id uuid', target_table);
      execute format('create index if not exists %I on public.%I(company_id)', target_table || '_company_id_idx', target_table);
    end if;
  end loop;
end $$;

-- Backfill from customer/site/metering point when possible.
do $$
begin
  if to_regclass('public.grid_owner_data_requests') is not null and to_regclass('public.customers') is not null then
    update public.grid_owner_data_requests r
       set company_id = c.company_id
      from public.customers c
     where r.customer_id = c.id
       and r.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.metering_values') is not null and to_regclass('public.customers') is not null then
    update public.metering_values mv
       set company_id = c.company_id
      from public.customers c
     where mv.customer_id = c.id
       and mv.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.billing_underlays') is not null and to_regclass('public.customers') is not null then
    update public.billing_underlays bu
       set company_id = c.company_id
      from public.customers c
     where bu.customer_id = c.id
       and bu.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.partner_exports') is not null and to_regclass('public.customers') is not null then
    update public.partner_exports pe
       set company_id = c.company_id
      from public.customers c
     where pe.customer_id = c.id
       and pe.company_id is null
       and c.company_id is not null;
  end if;

  if to_regclass('public.outbound_requests') is not null and to_regclass('public.customers') is not null then
    update public.outbound_requests o
       set company_id = c.company_id
      from public.customers c
     where o.customer_id = c.id
       and o.company_id is null
       and c.company_id is not null;
  end if;
end $$;

-- Metering value versioning: corrections must not overwrite earlier values without traceability.
do $$
begin
  if to_regclass('public.metering_values') is not null then
    alter table public.metering_values add column if not exists source_ediel_message_id uuid null;
    alter table public.metering_values add column if not exists canonical_dedupe_key text null;
    alter table public.metering_values add column if not exists is_current boolean not null default true;
    alter table public.metering_values add column if not exists previous_value_id uuid null;
    alter table public.metering_values add column if not exists replaced_by_value_id uuid null;
    alter table public.metering_values add column if not exists revision_number integer not null default 1;
    alter table public.metering_values add column if not exists correction_reason text null;
    alter table public.metering_values add column if not exists value_status text not null default 'current';

    update public.metering_values
       set canonical_dedupe_key = concat_ws('|', company_id::text, metering_point_id::text, reading_type, read_at::text, coalesce(period_start::text, 'no-period-start'), coalesce(period_end::text, 'no-period-end'))
     where canonical_dedupe_key is null
       and company_id is not null
       and metering_point_id is not null
       and read_at is not null;

    create index if not exists metering_values_company_period_idx
      on public.metering_values(company_id, metering_point_id, period_start, period_end);

    create index if not exists metering_values_company_current_idx
      on public.metering_values(company_id, metering_point_id, is_current, read_at desc);

    create index if not exists metering_values_source_ediel_idx
      on public.metering_values(source_ediel_message_id);

    create unique index if not exists metering_values_current_dedupe_uidx
      on public.metering_values(company_id, canonical_dedupe_key)
      where is_current = true and canonical_dedupe_key is not null;
  end if;
end $$;

-- Billing readiness is stored per underlay so exports can be partial and transparent.
do $$
begin
  if to_regclass('public.billing_underlays') is not null then
    alter table public.billing_underlays add column if not exists readiness_status text not null default 'not_checked';
    alter table public.billing_underlays add column if not exists readiness_issues jsonb not null default '[]'::jsonb;

    create index if not exists billing_underlays_company_period_readiness_idx
      on public.billing_underlays(company_id, underlay_year, underlay_month, readiness_status);
  end if;
end $$;

-- Partner exports get a batch key so partial export batches are auditable.
do $$
begin
  if to_regclass('public.partner_exports') is not null then
    alter table public.partner_exports add column if not exists export_batch_key text null;
    create index if not exists partner_exports_company_batch_idx
      on public.partner_exports(company_id, export_batch_key);
  end if;
end $$;

-- Guard view for operator dashboards: shows underlays that are blocked/flagged without blocking the whole batch.
do $$
begin
  if to_regclass('public.billing_underlays') is not null then
    execute $view$
      create or replace view public.billing_readiness_flags as
      select
        bu.id as billing_underlay_id,
        bu.company_id,
        bu.customer_id,
        bu.site_id,
        bu.metering_point_id,
        bu.underlay_year,
        bu.underlay_month,
        bu.status as underlay_status,
        bu.readiness_status,
        bu.readiness_issues,
        bu.updated_at
      from public.billing_underlays bu
      where coalesce(bu.readiness_status, 'not_checked') in ('warning', 'blocked', 'requires_correction')
    $view$;
  end if;
end $$;
