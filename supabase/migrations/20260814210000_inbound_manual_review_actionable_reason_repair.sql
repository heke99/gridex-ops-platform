-- Close post-#145 residual: open manual_review rows may still carry opaque
-- review_reason ('manual_review' / 'manual_review_unclassified') after the
-- worker invented metadata from the status token without the processor reason.
-- Prefer inbound_email_messages.error_message / match_status when available.
-- Forward-only; does not rewrite 20260814200000.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';
set local search_path = public, auth, pg_catalog;

do $preflight$
begin
  if to_regclass('public.inbound_processing_jobs') is null then
    raise exception 'inbound_processing_jobs_missing';
  end if;

  if to_regclass('public.inbound_email_messages') is null then
    raise exception 'inbound_email_messages_missing';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'inbound_processing_jobs'
      and column_name = 'review_reason'
  ) then
    raise exception 'inbound_manual_review_columns_missing';
  end if;
end
$preflight$;

update public.inbound_processing_jobs as job
set review_reason = coalesce(
      nullif(btrim(msg.error_message), ''),
      nullif(btrim(msg.match_status), ''),
      nullif(btrim(job.error_message), ''),
      'manual_review_unclassified'
    ),
    error_message = coalesce(
      nullif(btrim(job.error_message), ''),
      nullif(btrim(msg.error_message), '')
    ),
    updated_at = now()
from public.inbound_email_messages as msg
where job.inbound_email_message_id = msg.id
  and job.status = 'manual_review'
  and job.review_resolved_at is null
  and job.review_reason in ('manual_review', 'manual_review_unclassified')
  and (
    nullif(btrim(msg.error_message), '') is not null
    or nullif(btrim(msg.match_status), '') is not null
    or nullif(btrim(job.error_message), '') is not null
  );

do $verify$
begin
  -- Opaque token without any recoverable message/match reason is acceptable
  -- only when both job and message lack actionable text; otherwise fail closed.
  if exists (
    select 1
    from public.inbound_processing_jobs job
    left join public.inbound_email_messages msg
      on msg.id = job.inbound_email_message_id
    where job.status = 'manual_review'
      and job.review_resolved_at is null
      and job.review_reason = 'manual_review'
      and (
        nullif(btrim(msg.error_message), '') is not null
        or nullif(btrim(msg.match_status), '') is not null
        or nullif(btrim(job.error_message), '') is not null
      )
  ) then
    raise exception 'opaque_manual_review_reason_still_present';
  end if;
end
$verify$;

commit;
