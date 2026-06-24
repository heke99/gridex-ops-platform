-- gridex_automatic_facility_lookup_edifact_dispatch
-- Makes facility lookup requests first-class Ediel dispatch objects instead of
-- leaving production-ready requests in a manual ready_to_send state.

alter table if exists public.grid_owner_information_requests
  add column if not exists communication_route_id uuid references public.communication_routes(id) on delete set null,
  add column if not exists ediel_route_profile_id uuid references public.ediel_route_profiles(id) on delete set null,
  add column if not exists outbound_request_id uuid references public.outbound_requests(id) on delete set null,
  add column if not exists ediel_message_id uuid references public.ediel_messages(id) on delete set null,
  add column if not exists operation_id uuid,
  add column if not exists dispatch_status text not null default 'not_started',
  add column if not exists dispatch_attempted_at timestamptz,
  add column if not exists dispatch_error_code text,
  add column if not exists dispatch_error_message text;

alter table if exists public.outbound_requests
  add column if not exists grid_owner_information_request_id uuid references public.grid_owner_information_requests(id) on delete set null;

alter table if exists public.ediel_messages
  add column if not exists grid_owner_information_request_id uuid references public.grid_owner_information_requests(id) on delete set null;

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'grid_owner_information_requests'
      and constraint_name = 'grid_owner_information_requests_dispatch_status_check'
  ) then
    alter table public.grid_owner_information_requests
      drop constraint grid_owner_information_requests_dispatch_status_check;
  end if;

  alter table public.grid_owner_information_requests
    add constraint grid_owner_information_requests_dispatch_status_check
    check (dispatch_status in (
      'not_started',
      'ready',
      'queued',
      'sent',
      'waiting_response',
      'completed',
      'failed',
      'skipped'
    ));
end $$;

update public.grid_owner_information_requests
set communication_route_id = case
      when metadata->>'communication_route_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (metadata->>'communication_route_id')::uuid
      else communication_route_id
    end,
    ediel_route_profile_id = case
      when metadata->>'ediel_route_profile_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (metadata->>'ediel_route_profile_id')::uuid
      else ediel_route_profile_id
    end,
    outbound_request_id = case
      when metadata->>'outbound_request_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (metadata->>'outbound_request_id')::uuid
      else outbound_request_id
    end,
    ediel_message_id = case
      when metadata->>'ediel_message_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (metadata->>'ediel_message_id')::uuid
      else ediel_message_id
    end,
    operation_id = case
      when metadata->>'operation_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (metadata->>'operation_id')::uuid
      else operation_id
    end
where request_type = 'facility_lookup'
  and metadata is not null;

update public.grid_owner_information_requests
set dispatch_status = case
    when status in ('sent', 'waiting_response') then 'waiting_response'
    when status in ('received', 'completed') then 'completed'
    when status = 'ready_to_send' and channel = 'ediel' then 'ready'
    when status in ('failed', 'needs_review') then 'failed'
    else dispatch_status
  end
where request_type = 'facility_lookup';

update public.outbound_requests o
set grid_owner_information_request_id = g.id
from public.grid_owner_information_requests g
where o.grid_owner_information_request_id is null
  and g.outbound_request_id = o.id;

update public.ediel_messages e
set grid_owner_information_request_id = g.id
from public.grid_owner_information_requests g
where e.grid_owner_information_request_id is null
  and g.ediel_message_id = e.id;

create index if not exists grid_owner_information_requests_dispatch_idx
  on public.grid_owner_information_requests (company_id, status, channel, dispatch_status, updated_at)
  where request_type = 'facility_lookup';

create index if not exists grid_owner_information_requests_outbound_idx
  on public.grid_owner_information_requests (outbound_request_id)
  where outbound_request_id is not null;

create index if not exists grid_owner_information_requests_ediel_message_idx
  on public.grid_owner_information_requests (ediel_message_id)
  where ediel_message_id is not null;

create index if not exists grid_owner_information_requests_route_idx
  on public.grid_owner_information_requests (company_id, communication_route_id, ediel_route_profile_id)
  where request_type = 'facility_lookup';

create index if not exists outbound_requests_grid_owner_information_request_idx
  on public.outbound_requests (grid_owner_information_request_id)
  where grid_owner_information_request_id is not null;

create index if not exists ediel_messages_grid_owner_information_request_idx
  on public.ediel_messages (grid_owner_information_request_id)
  where grid_owner_information_request_id is not null;

comment on column public.grid_owner_information_requests.communication_route_id is 'Materialized production communication route used for automated facility lookup Ediel dispatch.';
comment on column public.grid_owner_information_requests.ediel_route_profile_id is 'Route profile used when facility lookup is dispatched as PRODAT Z01.';
comment on column public.grid_owner_information_requests.outbound_request_id is 'Outbound request created for the facility lookup Ediel dispatch.';
comment on column public.grid_owner_information_requests.ediel_message_id is 'Queued Ediel message created for the facility lookup request.';
comment on column public.grid_owner_information_requests.dispatch_status is 'Dispatch lifecycle for automated facility lookup Ediel dispatch.';
comment on column public.outbound_requests.grid_owner_information_request_id is 'Facility lookup business request linked to this outbound dispatch.';
comment on column public.ediel_messages.grid_owner_information_request_id is 'Facility lookup business request linked to this Ediel message.';
