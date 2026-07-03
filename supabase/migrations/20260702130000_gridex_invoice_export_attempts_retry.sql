-- Migration C: invoice export hardening.
--
-- 1) invoice_export_attempts audit table (one row per outbound send attempt).
-- 2) Retry bookkeeping columns on invoice_export_items.
-- 3) Extended status taxonomy on invoice_export_items (additive):
--    rejected (4xx payload errors, no auto-retry), configuration_error (401/403),
--    failed_retryable (5xx/timeout/network, retried with the same idempotency key),
--    needs_review (409 conflicts and unknown outcomes).

-- -----------------------------------------------------------------------------
-- 1) invoice_export_attempts
-- -----------------------------------------------------------------------------

create table if not exists public.invoice_export_attempts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invoice_export_item_id uuid not null references public.invoice_export_items(id) on delete cascade,
  export_run_id uuid,
  attempt_no integer not null default 1,
  idempotency_key text,
  request_hash text,
  http_status integer,
  outcome text not null,
  error_code text,
  response_excerpt text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invoice_export_attempts_outcome_check check (
    outcome in ('sent', 'rejected', 'configuration_error', 'failed_retryable', 'failed', 'needs_review')
  )
);

create index if not exists invoice_export_attempts_item_idx
  on public.invoice_export_attempts(company_id, invoice_export_item_id, attempt_no);
create index if not exists invoice_export_attempts_run_idx
  on public.invoice_export_attempts(company_id, export_run_id, created_at desc);

alter table if exists public.invoice_export_attempts enable row level security;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role')
     and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invoice_export_attempts' and policyname = 'invoice_export_attempts_service_role_all') then
    create policy invoice_export_attempts_service_role_all on public.invoice_export_attempts for all to service_role using (true) with check (true);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2) Retry bookkeeping columns
-- -----------------------------------------------------------------------------

alter table if exists public.invoice_export_items
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists error_code text;

-- -----------------------------------------------------------------------------
-- 3) Extended status taxonomy (additive)
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.invoice_export_items') is null then
    return;
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.invoice_export_items'::regclass
      and conname = 'invoice_export_items_status_check'
  ) then
    alter table public.invoice_export_items drop constraint invoice_export_items_status_check;
  end if;

  alter table public.invoice_export_items
    add constraint invoice_export_items_status_check
    check (status in (
      'pending', 'sent', 'failed', 'cancelled', 'credited', 'disputed',
      'rejected', 'configuration_error', 'failed_retryable', 'needs_review'
    )) not valid;

  begin
    alter table public.invoice_export_items validate constraint invoice_export_items_status_check;
  exception when others then
    raise notice 'invoice_export_items_status_check left NOT VALID: %', sqlerrm;
  end;

  -- Retry worker hot path: due retryable items.
  create index if not exists invoice_export_items_retry_due_idx
    on public.invoice_export_items(next_retry_at)
    where status = 'failed_retryable';
end $$;
