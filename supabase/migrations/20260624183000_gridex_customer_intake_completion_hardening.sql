-- gridex_customer_intake_completion_hardening
-- Completes the last customer-intake gaps after automated facility lookup dispatch:
-- billing cron support, facility response completion lifecycle, and work queue visibility.

alter table if exists public.grid_owner_information_requests
  add column if not exists completed_at timestamptz,
  add column if not exists received_at timestamptz;

update public.grid_owner_information_requests
set dispatch_status = 'completed'
where request_type = 'facility_lookup'
  and status = 'completed'
  and dispatch_status is distinct from 'completed';

update public.customer_info_requests
set status = 'ready_for_switch',
    next_required_action = 'Starta leverantörsbyte när readiness är grön.',
    updated_at = now()
where blocker_code is null
  and route_resolution_status = 'facility_identifier_received'
  and status in ('pending', 'blocked', 'needs_review');

create index if not exists grid_owner_information_requests_work_queue_idx
  on public.grid_owner_information_requests (company_id, customer_id, status, dispatch_status, updated_at desc)
  where request_type = 'facility_lookup'
    and status in ('draft', 'ready_to_send', 'needs_review', 'failed', 'waiting_response');

create index if not exists customer_info_requests_ready_for_switch_idx
  on public.customer_info_requests (company_id, customer_id, site_id, status, updated_at desc)
  where status = 'ready_for_switch';

comment on index public.grid_owner_information_requests_work_queue_idx is 'Speeds up operations work queue for facility lookup dispatch and response states.';
comment on index public.customer_info_requests_ready_for_switch_idx is 'Speeds up intake completion checks after facility data has been received.';
