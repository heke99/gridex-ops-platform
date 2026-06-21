-- Customer info dispatch finalizer
-- Keeps customer_info_requests, grid_owner_data_requests, outbound_requests and jobs correlated by operation_id.

alter table if exists public.grid_owner_data_requests add column if not exists operation_id uuid;
alter table if exists public.outbound_requests add column if not exists operation_id uuid;
alter table if exists public.ediel_messages add column if not exists operation_id uuid;

create index if not exists grid_owner_data_requests_company_operation_idx
  on public.grid_owner_data_requests(company_id, operation_id, created_at desc)
  where operation_id is not null;

create index if not exists grid_owner_data_requests_company_operation_scope_idx
  on public.grid_owner_data_requests(company_id, operation_id, customer_id, site_id, grid_owner_id, request_scope, created_at desc)
  where operation_id is not null;

create index if not exists outbound_requests_company_operation_idx
  on public.outbound_requests(company_id, operation_id, created_at desc)
  where operation_id is not null;

create index if not exists outbound_requests_source_operation_idx
  on public.outbound_requests(company_id, source_type, source_id, request_type, operation_id, created_at desc)
  where operation_id is not null;

create index if not exists ediel_messages_company_operation_idx
  on public.ediel_messages(company_id, operation_id, created_at desc)
  where operation_id is not null;

-- Backfill operation_id into grid-owner data requests when the customer info request already has it.
update public.grid_owner_data_requests godr
set operation_id = cir.operation_id,
    updated_at = now()
from public.customer_info_requests cir
where godr.operation_id is null
  and cir.operation_id is not null
  and cir.company_id = godr.company_id
  and (
    cir.grid_owner_data_request_id = godr.id
    or (
      cir.grid_owner_data_request_id is null
      and cir.customer_id = godr.customer_id
      and coalesce(cir.site_id::text, '') = coalesce(godr.site_id::text, '')
      and coalesce(cir.metering_point_id::text, '') = coalesce(godr.metering_point_id::text, '')
      and coalesce(cir.grid_owner_id::text, '') = coalesce(godr.grid_owner_id::text, '')
      and cir.request_type = 'z01_customer_masterdata'
      and godr.request_scope = 'customer_masterdata'
      and (
        cir.external_reference = godr.external_reference
        or cir.verified_payload->>'externalReference' = godr.external_reference
      )
    )
  );

-- Link draft customer-info requests to already-created grid-owner requests so they cannot remain empty drafts.
with candidates as (
  select distinct on (cir.id)
    cir.id as customer_info_request_id,
    godr.id as grid_owner_data_request_id,
    godr.operation_id,
    godr.external_reference
  from public.customer_info_requests cir
  join public.grid_owner_data_requests godr
    on godr.company_id = cir.company_id
   and godr.customer_id = cir.customer_id
   and coalesce(godr.site_id::text, '') = coalesce(cir.site_id::text, '')
   and coalesce(godr.metering_point_id::text, '') = coalesce(cir.metering_point_id::text, '')
   and coalesce(godr.grid_owner_id::text, '') = coalesce(cir.grid_owner_id::text, '')
   and godr.request_scope = 'customer_masterdata'
  where cir.request_type = 'z01_customer_masterdata'
    and cir.grid_owner_data_request_id is null
    and cir.status = 'draft'
    and (
      godr.operation_id = cir.operation_id
      or cir.external_reference = godr.external_reference
      or cir.verified_payload->>'externalReference' = godr.external_reference
    )
  order by cir.id, godr.created_at desc
)
update public.customer_info_requests cir
set grid_owner_data_request_id = candidates.grid_owner_data_request_id,
    operation_id = coalesce(cir.operation_id, candidates.operation_id),
    external_reference = coalesce(cir.external_reference, candidates.external_reference),
    route_resolution_status = coalesce(cir.route_resolution_status, 'grid_owner_request_created'),
    next_required_action = coalesce(cir.next_required_action, 'Förbered PRODAT Z01 eller granska blockeraren.'),
    verified_payload = coalesce(cir.verified_payload, '{}'::jsonb)
      || jsonb_build_object('gridOwnerDataRequestId', candidates.grid_owner_data_request_id),
    updated_at = now()
from candidates
where cir.id = candidates.customer_info_request_id;

-- Propagate operation_id to outbound and Ediel messages.
update public.outbound_requests outbound
set operation_id = godr.operation_id,
    payload = coalesce(outbound.payload, '{}'::jsonb) || jsonb_build_object('operation_id', godr.operation_id),
    updated_at = now()
from public.grid_owner_data_requests godr
where outbound.operation_id is null
  and godr.operation_id is not null
  and outbound.company_id = godr.company_id
  and outbound.source_type = 'grid_owner_data_request'
  and outbound.source_id = godr.id;

update public.customer_info_requests cir
set outbound_request_id = outbound.id,
    operation_id = coalesce(cir.operation_id, outbound.operation_id),
    route_resolution_status = coalesce(cir.route_resolution_status, 'outbound_created'),
    verified_payload = coalesce(cir.verified_payload, '{}'::jsonb)
      || jsonb_build_object('outboundRequestId', outbound.id),
    updated_at = now()
from public.outbound_requests outbound
where cir.outbound_request_id is null
  and cir.grid_owner_data_request_id = outbound.source_id
  and outbound.source_type = 'grid_owner_data_request'
  and outbound.request_type = 'customer_masterdata'
  and cir.company_id = outbound.company_id;

update public.ediel_messages msg
set operation_id = coalesce(msg.operation_id, cir.operation_id),
    updated_at = now()
from public.customer_info_requests cir
where msg.operation_id is null
  and cir.operation_id is not null
  and msg.company_id = cir.company_id
  and (
    msg.id = cir.ediel_message_id
    or msg.grid_owner_data_request_id = cir.grid_owner_data_request_id
    or msg.outbound_request_id = cir.outbound_request_id
  );

-- Finalize old empty drafts into explicit review/blocker states when a child row exists but Z01 did not finish.
update public.customer_info_requests cir
set status = case
      when cir.outbound_request_id is not null then 'blocked'
      when cir.grid_owner_data_request_id is not null then 'blocked'
      else cir.status
    end,
    blocker_code = coalesce(cir.blocker_code, 'operational_route_missing'),
    blocker_reason = coalesce(cir.blocker_reason, 'Uppgiftsbegäran skapades men PRODAT Z01 finaliserades inte. Granska route/outbox och kör om.'),
    blocker_details = coalesce(cir.blocker_details, '{}'::jsonb)
      || jsonb_build_object(
        'blocker_code', coalesce(cir.blocker_code, 'operational_route_missing'),
        'blocker_reason', coalesce(cir.blocker_reason, 'Uppgiftsbegäran skapades men PRODAT Z01 finaliserades inte. Granska route/outbox och kör om.'),
        'next_required_action', 'Granska route/outbox och kör om uppgiftsbegäran.'
      ),
    route_resolution_status = coalesce(cir.route_resolution_status, 'z01_prepare_failed'),
    route_resolution_reason = coalesce(cir.route_resolution_reason, 'PRODAT Z01 finaliserades inte efter att underbegäran skapades.'),
    next_required_action = coalesce(cir.next_required_action, 'Granska route/outbox och kör om uppgiftsbegäran.'),
    updated_at = now()
where cir.request_type = 'z01_customer_masterdata'
  and cir.status = 'draft'
  and (cir.grid_owner_data_request_id is not null or cir.outbound_request_id is not null);

-- Move queued customer-data jobs with known correlated requests out of retry loops.
update public.customer_operation_jobs job
set status = 'needs_review',
    result = coalesce(job.result, '{}'::jsonb)
      || jsonb_build_object(
        'customer_info_request_id', cir.id,
        'grid_owner_data_request_id', cir.grid_owner_data_request_id,
        'outbound_request_id', cir.outbound_request_id,
        'reason', coalesce(cir.blocker_code, cir.status, 'customer_info_dispatch_finalized')
      ),
    last_error = null,
    locked_at = null,
    locked_by = null,
    lock_token = null,
    heartbeat_at = null,
    completed_at = coalesce(job.completed_at, now()),
    updated_at = now()
from public.customer_info_requests cir
where job.job_type = 'request_customer_data'
  and job.status = 'queued'
  and job.operation_id = cir.operation_id
  and cir.request_type = 'z01_customer_masterdata'
  and cir.status in ('blocked', 'route_missing', 'missing_authorization', 'manual_review_required', 'z01_prepared')
  and (job.last_error is null or job.last_error = 'Kundautomation misslyckades.' or job.last_error ilike '%Kundautomation%');
