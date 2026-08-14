-- Close post-#144 residual: open manual_review rows may still lack owner/reason/SLA
-- because the worker historically did not invent operational metadata on entry.
-- Forward-only; mirrors defaults from 20260811080000 / 20260814193000.

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
      and column_name = 'review_owner'
  ) then
    raise exception 'inbound_manual_review_columns_missing';
  end if;
end
$preflight$;

update public.inbound_processing_jobs
set review_owner = coalesce(nullif(review_owner, ''), 'tenant_operations'),
    review_priority = coalesce(nullif(review_priority, ''), 'normal'),
    review_reason = coalesce(
      nullif(review_reason, ''),
      nullif(error_message, ''),
      nullif(step, ''),
      nullif(payload ->> 'reason', ''),
      'manual_review_unclassified'
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
    where status = 'manual_review'
      and review_resolved_at is null
      and (
        nullif(review_owner, '') is null
        or nullif(review_reason, '') is null
        or review_sla_due_at is null
      )
  ) then
    raise exception 'manual_review_without_owner_or_sla_still_present';
  end if;
end
$verify$;

commit;
