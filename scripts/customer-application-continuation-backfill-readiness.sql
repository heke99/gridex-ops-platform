-- Gridex OPS: dry-run/read-only readiness report before or after applying
-- 20260724210000_customer_application_continuation_orchestrator.sql.
--
-- This script NEVER mutates data and NEVER sends mail/Ediel/webhooks. It
-- classifies existing website customer applications so operations can review
-- unsafe rows before workers process the migration's deduplicated continuation
-- jobs.

with application_workflows as (
  select
    a.id as application_id,
    a.company_id,
    a.customer_id,
    a.customer_site_id,
    a.metering_point_id,
    a.contract_id,
    a.status as application_status,
    a.next_step as application_next_step,
    a.created_at as application_created_at,
    a.updated_at as application_updated_at,
    w.id as workflow_id,
    w.operation_id,
    w.state as workflow_state,
    w.next_action,
    w.last_transition_at,
    w.updated_at as workflow_updated_at,
    j.id as continuation_job_id,
    j.status as continuation_job_status,
    j.attempts,
    j.max_attempts,
    j.last_error_code,
    j.last_error_message
  from public.website_customer_applications a
  left join lateral (
    select w.*
    from public.customer_application_workflows w
    where w.company_id=a.company_id
      and w.customer_application_id=a.id
    order by w.created_at desc
    limit 1
  ) w on true
  left join lateral (
    select j.*
    from public.customer_operation_jobs j
    where j.company_id=a.company_id
      and j.workflow_id=w.id
      and j.job_type='customer_application_continuation'
    order by j.created_at desc
    limit 1
  ) j on true
), classified as (
  select
    aw.*,
    case
      when aw.workflow_state='completed'
        or exists (
          select 1 from public.customer_supply_periods sp
          where sp.company_id=aw.company_id
            and sp.customer_id=aw.customer_id
            and sp.status='active'
        )
        then 'completed'
      when aw.workflow_state in ('cancelled','failed','validation_failed')
        or aw.application_status in ('failed','rejected')
        then 'unsafe_to_replay'
      when aw.workflow_state in ('manual_review','facility_response_needs_review','switch_rejected')
        or aw.application_status in ('pending_review','needs_information')
        then 'manual_review_required'
      when aw.workflow_state in (
          'canonical_data_committed','initial_notifications_pending','initial_notifications_queued'
        )
        and not exists (
          select 1 from public.customer_application_workflow_events e
          where e.company_id=aw.company_id
            and e.workflow_id=aw.workflow_id
            and e.event_code='workflow.initial_notifications_queued'
        )
        then 'missing_notification'
      when aw.workflow_state in (
          'facility_information_check','facility_information_required','facility_request_pending'
        )
        and not exists (
          select 1 from public.grid_owner_information_requests r
          where r.company_id=aw.company_id
            and r.customer_id=aw.customer_id
            and (aw.customer_site_id is null or r.customer_site_id=aw.customer_site_id)
            and r.status not in ('cancelled','completed')
        )
        then 'missing_facility_request'
      when aw.workflow_state in ('switch_readiness_check','switch_request_pending','switch_request_queued')
        and not exists (
          select 1 from public.supplier_switch_requests sr
          where sr.company_id=aw.company_id
            and sr.customer_id=aw.customer_id
            and (aw.customer_site_id is null or sr.customer_site_id=aw.customer_site_id or sr.site_id=aw.customer_site_id)
            and sr.status not in ('cancelled','rejected','completed')
        )
        then 'missing_switch_request'
      when aw.workflow_id is null
        or aw.continuation_job_id is null
        or aw.continuation_job_status in ('failed','blocked','delivery_uncertain','needs_review')
        then 'ready_to_continue'
      else 'in_progress_or_waiting'
    end as backfill_category
  from application_workflows aw
)
select
  backfill_category,
  count(*) as application_count,
  min(coalesce(workflow_updated_at,application_updated_at)) as oldest_updated_at,
  max(coalesce(workflow_updated_at,application_updated_at)) as newest_updated_at
from classified
group by backfill_category
order by backfill_category;

-- Detailed rows for operations review. Keep this second query when running in
-- Supabase SQL Editor; it exposes IDs and errors but does not expose payloads,
-- personnummer, fullmakt evidence or other sensitive customer data.
with application_workflows as (
  select
    a.id as application_id,
    a.company_id,
    a.customer_id,
    a.customer_site_id,
    a.status as application_status,
    a.next_step as application_next_step,
    a.updated_at as application_updated_at,
    w.id as workflow_id,
    w.state as workflow_state,
    w.next_action,
    w.updated_at as workflow_updated_at,
    j.id as continuation_job_id,
    j.status as continuation_job_status,
    j.attempts,
    j.max_attempts,
    j.last_error_code,
    j.last_error_message
  from public.website_customer_applications a
  left join lateral (
    select w.* from public.customer_application_workflows w
    where w.company_id=a.company_id and w.customer_application_id=a.id
    order by w.created_at desc limit 1
  ) w on true
  left join lateral (
    select j.* from public.customer_operation_jobs j
    where j.company_id=a.company_id and j.workflow_id=w.id
      and j.job_type='customer_application_continuation'
    order by j.created_at desc limit 1
  ) j on true
)
select *
from application_workflows
where workflow_id is null
   or continuation_job_id is null
   or continuation_job_status in ('failed','blocked','delivery_uncertain','needs_review')
   or workflow_state in ('manual_review','facility_response_needs_review','switch_rejected','failed','validation_failed')
order by coalesce(workflow_updated_at,application_updated_at) asc;
