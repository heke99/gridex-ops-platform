-- Read-only postflight for Operations Foundation + Contract Lifecycle V1.
-- Expected production-safe result: every *_violations count is 0.

select
  to_regprocedure('public.gridex_customer_operation_outcome_class(text,integer,integer)') is not null as outcome_function_exists,
  to_regprocedure('public.gridex_enqueue_signed_contract_operation_v1()') is not null as lifecycle_trigger_function_exists,
  to_regclass('public.customer_operation_outcomes_v') is not null as outcome_view_exists,
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.customer_contracts'::regclass
      and tgname = 'customer_contracts_signed_operation_v1'
      and not tgisinternal
  ) as signed_contract_trigger_exists,
  exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'customer_operation_jobs'
      and indexname = 'customer_operation_jobs_contract_signed_uidx'
  ) as permanent_idempotency_index_exists;

select count(*) as duplicate_contract_signed_jobs_violations
from (
  select company_id, job_type, idempotency_key
  from public.customer_operation_jobs
  where job_type = 'start_supplier_switch'
    and idempotency_key like 'contract-signed:%'
  group by company_id, job_type, idempotency_key
  having count(*) > 1
) d;

select count(*) as queued_snapshot_violations
from public.customer_operation_jobs j
where j.job_type = 'start_supplier_switch'
  and j.idempotency_key like 'contract-signed:%'
  and j.status in ('queued', 'running', 'waiting_response')
  and (
    j.customer_site_id is null
    or nullif(j.request_snapshot ->> 'address_hash', '') is null
    or j.request_snapshot ->> 'site_id' is distinct from j.customer_site_id::text
  );

select count(*) as tenant_site_scope_violations
from public.customer_operation_jobs j
where j.customer_site_id is not null
  and j.idempotency_key like 'contract-signed:%'
  and not exists (
    select 1
    from public.customer_sites s
    where s.id = j.customer_site_id
      and s.company_id = j.company_id
      and s.customer_id = j.customer_id
  );

select count(*) as missing_lifecycle_tracking_violations
from public.customer_contracts c
where c.status = 'signed'
  and c.signed_at is not null
  and coalesce(c.energy_direction, 'consumption') = 'consumption'
  and not exists (
    select 1
    from public.customer_operation_jobs j
    where j.company_id = c.company_id
      and j.job_type = 'start_supplier_switch'
      and j.idempotency_key = 'contract-signed:' || c.id::text
  )
  and not exists (
    select 1
    from public.supplier_switch_requests s
    where s.company_id = c.company_id
      and s.customer_id = c.customer_id
      and (
        s.customer_contract_id = c.id
        or s.contract_id = c.id
        or (
          coalesce(s.customer_site_id, s.site_id) = coalesce(c.customer_site_id, c.site_id)
          and coalesce(c.customer_site_id, c.site_id) is not null
        )
      )
  );

select outcome_class, count(*)
from public.customer_operation_outcomes_v
where idempotency_key like 'contract-signed:%'
group by outcome_class
order by outcome_class;

select status, review_reason_code, count(*)
from public.customer_operation_jobs
where job_type = 'start_supplier_switch'
  and idempotency_key like 'contract-signed:%'
group by status, review_reason_code
order by status, review_reason_code;

-- Historical reconciliation is intentionally REVIEW-only. It must not create a
-- supplier-switch or outbound request by itself. Validate with the deployment
-- baseline captured immediately before applying the migrations.
select count(*) as historical_reconciliation_jobs
from public.customer_operation_jobs
where job_type = 'start_supplier_switch'
  and review_reason_code = 'historical_signed_contract_requires_reconciliation';

-- Recovery/rollback strategy:
--   1. Disable/drop customer_contracts_signed_operation_v1 first to stop new work.
--   2. Preserve operation jobs/events/tasks as audit evidence; do not blindly delete.
--   3. Drop customer_operation_outcomes_v and the helper function only after consumers stop.
--   4. Drop customer_operation_jobs_contract_signed_uidx only if reverting the immutable edge contract.
-- Existing supplier-switch, Ediel and outbound domain state is not owned by this migration.
