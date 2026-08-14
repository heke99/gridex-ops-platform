-- Close post-#143 second-order residual: requeue → reprocess → manual_review left
-- review_resolved_at sticky, so open-review UI and the resolve RPC refused the job.
-- Also normalize any legacy terminal status `completed` written before #143 to `done`.
-- Forward-only: do not rewrite 20260814190000.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local search_path = public, auth, pg_catalog;

do $preflight$
begin
  if to_regclass('public.inbound_processing_jobs') is null then
    raise exception 'inbound_processing_jobs_missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inbound_processing_jobs'
      and column_name = 'review_resolved_at'
  ) then
    raise exception 'inbound_manual_review_columns_missing';
  end if;
end
$preflight$;

-- Legacy resolve vocabulary before #143 persisted completed; worker uses done.
update public.inbound_processing_jobs
set status = 'done',
    updated_at = coalesce(updated_at, now())
where status = 'completed';

-- Stuck reopen rows: status already manual_review but a prior resolve left the stamp.
update public.inbound_processing_jobs
set review_resolved_at = null,
    review_resolution = null,
    updated_at = now()
where status = 'manual_review'
  and review_resolved_at is not null;

-- Keep open manual-review rows actionable for ops queues (same defaults as 20260811080000).
update public.inbound_processing_jobs
set review_owner = coalesce(nullif(review_owner, ''), 'tenant_operations'),
    review_priority = coalesce(nullif(review_priority, ''), 'normal'),
    review_reason = coalesce(
      nullif(review_reason, ''),
      nullif(error_message, ''),
      nullif(payload ->> 'reason', ''),
      'manual_review_reopened_unclassified'
    ),
    review_sla_due_at = coalesce(
      review_sla_due_at,
      coalesce(updated_at, created_at, now()) + interval '24 hours'
    ),
    updated_at = now()
where status = 'manual_review'
  and review_resolved_at is null
  and (
    nullif(review_owner, '') is null
    or nullif(review_priority, '') is null
    or nullif(review_reason, '') is null
    or review_sla_due_at is null
  );

do $verify$
begin
  if exists (
    select 1
    from public.inbound_processing_jobs
    where status = 'completed'
  ) then
    raise exception 'legacy_inbound_completed_status_still_present';
  end if;

  if exists (
    select 1
    from public.inbound_processing_jobs
    where status = 'manual_review'
      and review_resolved_at is not null
  ) then
    raise exception 'sticky_manual_review_resolution_still_present';
  end if;
end
$verify$;

commit;
