-- Production readiness hardening: supplier switch + customer intake constraints.
--
-- Migration notes
--   Tables changed:
--     - supplier_switch_requests: + readiness_snapshot, readiness_checked_at
--     - customer_application_intakes: + customer_id, result, completed_at
--   Indexes added (all guarded, partial-unique so legacy data cannot break the
--   migration; if live duplicates exist the index is skipped with a NOTICE and
--   must be cleaned up manually before re-running):
--     - supplier_switch_requests_open_site_uidx: max one open supplier switch
--       per company + site
--     - customer_application_intakes_admin_idem_uidx: admin (api_client_id IS
--       NULL) intake idempotency
--     - customer_contracts_single_active_per_site_uidx: max one ACTIVE contract
--       per company + site
--   Backfill behavior: none required (new columns are nullable).
--   Manual cleanup: only when NOTICEs report existing duplicates.
--   Rollback: drop the added indexes/columns; no data is mutated.

-- 1. Supplier switch readiness snapshot ---------------------------------------
do $$
begin
  if to_regclass('public.supplier_switch_requests') is not null then
    alter table public.supplier_switch_requests
      add column if not exists readiness_snapshot jsonb;
    alter table public.supplier_switch_requests
      add column if not exists readiness_checked_at timestamptz;
    comment on column public.supplier_switch_requests.readiness_snapshot is
      'Persisted result of checkSupplierSwitchReadiness at creation/dispatch time (proof of what was validated).';
  end if;
end $$;

-- 2. Duplicate open supplier switch prevention (per company + site) -----------
-- Open statuses = canonical open statuses UNION legacy runtime statuses.
do $$
declare
  duplicate_count integer;
begin
  if to_regclass('public.supplier_switch_requests') is null then
    return;
  end if;

  select count(*) into duplicate_count
  from (
    select company_id, site_id
    from public.supplier_switch_requests
    where site_id is not null
      and company_id is not null
      and status in (
        'draft','queued','submitted','accepted','cancellation_requested',
        'cancellation_sent','manual_followup_required',
        'pending','ready','prepared','in_progress','sent',
        'waiting_response','awaiting_confirmation','confirmed'
      )
    group by company_id, site_id
    having count(*) > 1
  ) duplicates;

  if duplicate_count > 0 then
    raise notice 'gridex: skipped supplier_switch_requests_open_site_uidx — % site(s) already have multiple open supplier switches. Resolve duplicates manually (cancel/complete the stale requests), then re-run: create unique index supplier_switch_requests_open_site_uidx ...', duplicate_count;
  else
    create unique index if not exists supplier_switch_requests_open_site_uidx
      on public.supplier_switch_requests (company_id, site_id)
      where site_id is not null
        and company_id is not null
        and status in (
          'draft','queued','submitted','accepted','cancellation_requested',
          'cancellation_sent','manual_followup_required',
          'pending','ready','prepared','in_progress','sent',
          'waiting_response','awaiting_confirmation','confirmed'
        );
  end if;
end $$;

-- 3. Admin intake idempotency -------------------------------------------------
-- customer_application_intakes has UNIQUE(company_id, api_client_id, route,
-- method, idempotency_key), but Postgres treats NULLs as distinct, so admin
-- rows (api_client_id IS NULL) were not actually protected against races.
do $$
begin
  if to_regclass('public.customer_application_intakes') is null then
    return;
  end if;

  alter table public.customer_application_intakes
    add column if not exists customer_id uuid references public.customers(id) on delete set null;
  alter table public.customer_application_intakes
    add column if not exists result jsonb;
  alter table public.customer_application_intakes
    add column if not exists completed_at timestamptz;
end $$;

do $$
declare
  duplicate_count integer;
begin
  if to_regclass('public.customer_application_intakes') is null then
    return;
  end if;

  select count(*) into duplicate_count
  from (
    select company_id, route, method, idempotency_key
    from public.customer_application_intakes
    where api_client_id is null
      and idempotency_key is not null
    group by company_id, route, method, idempotency_key
    having count(*) > 1
  ) duplicates;

  if duplicate_count > 0 then
    raise notice 'gridex: skipped customer_application_intakes_admin_idem_uidx — % duplicate admin intake key group(s) exist. Clean up duplicates, then re-run the index creation.', duplicate_count;
  else
    create unique index if not exists customer_application_intakes_admin_idem_uidx
      on public.customer_application_intakes (company_id, route, method, idempotency_key)
      where api_client_id is null
        and idempotency_key is not null;
  end if;
end $$;

-- 4. Single ACTIVE contract per site -------------------------------------------
-- Overlapping/parallel ACTIVE contracts for the same site are a P0 billing risk
-- (double billing). Consecutive contracts (signed → active) are unaffected: only
-- status = 'active' rows participate.
do $$
declare
  duplicate_count integer;
begin
  if to_regclass('public.customer_contracts') is null then
    return;
  end if;

  select count(*) into duplicate_count
  from (
    select company_id, coalesce(customer_site_id, site_id) as effective_site_id
    from public.customer_contracts
    where status = 'active'
      and company_id is not null
      and coalesce(customer_site_id, site_id) is not null
    group by company_id, coalesce(customer_site_id, site_id)
    having count(*) > 1
  ) duplicates;

  if duplicate_count > 0 then
    raise notice 'gridex: skipped customer_contracts_single_active_per_site_uidx — % site(s) already have multiple ACTIVE contracts. Terminate/correct the stale contracts manually, then re-run the index creation.', duplicate_count;
  else
    create unique index if not exists customer_contracts_single_active_per_site_uidx
      on public.customer_contracts (company_id, coalesce(customer_site_id, site_id))
      where status = 'active'
        and company_id is not null
        and coalesce(customer_site_id, site_id) is not null;
  end if;
end $$;

-- 5. Helpful lookup indexes (non-unique, safe) ---------------------------------
do $$
begin
  if to_regclass('public.supplier_switch_requests') is not null then
    create index if not exists supplier_switch_requests_company_status_idx
      on public.supplier_switch_requests (company_id, status);
  end if;

  if to_regclass('public.customer_application_intakes') is not null then
    create index if not exists customer_application_intakes_customer_idx
      on public.customer_application_intakes (company_id, customer_id)
      where customer_id is not null;
  end if;
end $$;
