-- Prevent observability writes from rejecting valid external operations and add
-- a tenant/client scoped idempotency store for integration write endpoints.
-- Forward-only and additive apart from widening the polymorphic usage entity ID
-- from uuid to text. Historical UUID values are preserved losslessly.

begin;

alter table public.platform_usage_events
  alter column entity_id type text using entity_id::text;

comment on column public.platform_usage_events.entity_id is
  'Polymorphic internal UUID or stable external resource reference. The entity_type column defines its namespace.';

create index if not exists platform_usage_events_company_entity_reference_idx
  on public.platform_usage_events(
    company_id,
    entity_type,
    entity_id,
    occurred_at desc
  )
  where entity_id is not null;

create table if not exists public.platform_usage_event_failures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid null references public.companies(id) on delete cascade,
  api_client_id uuid null references public.integration_api_clients(id) on delete set null,
  actor_user_id uuid null,
  customer_id uuid null,
  event_key text not null,
  entity_type text not null,
  entity_id text null,
  source text not null,
  event_payload jsonb not null default '{}'::jsonb,
  database_code text null,
  database_message text not null,
  status text not null default 'open'
    check (status in ('open','resolved','ignored')),
  resolved_at timestamptz null,
  resolution_note text null,
  created_at timestamptz not null default now()
);

comment on table public.platform_usage_event_failures is
  'Best-effort remediation queue for non-critical platform usage telemetry. Business mutations must not be rolled back or reported as failed because this queue is unavailable.';

create index if not exists platform_usage_event_failures_open_created_idx
  on public.platform_usage_event_failures(status, created_at desc)
  where status = 'open';
create index if not exists platform_usage_event_failures_company_created_idx
  on public.platform_usage_event_failures(company_id, created_at desc);

alter table public.platform_usage_event_failures enable row level security;
revoke all on table public.platform_usage_event_failures from public, anon, authenticated;
grant select, insert, update on table public.platform_usage_event_failures to service_role;

create table if not exists public.integration_api_write_idempotency (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  api_client_id uuid not null references public.integration_api_clients(id) on delete cascade,
  route text not null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null default 'processing'
    check (status in ('processing','completed','failed')),
  response_status integer null
    check (response_status is null or response_status between 100 and 599),
  response_body jsonb null,
  error_code text null,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_api_write_idempotency_key_length_check
    check (char_length(idempotency_key) between 8 and 200),
  constraint integration_api_write_idempotency_request_hash_check
    check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint integration_api_write_idempotency_terminal_state_check
    check (
      (status = 'processing' and completed_at is null)
      or (status = 'completed' and completed_at is not null and response_status is not null and response_body is not null)
      or (status = 'failed' and completed_at is not null and error_code is not null)
    ),
  unique(company_id, api_client_id, route, idempotency_key)
);

comment on table public.integration_api_write_idempotency is
  'Durable exactly-once claim and replay store for tenant integration API writes that do not yet have a customer identity, including website quote creation.';

create index if not exists integration_api_write_idempotency_lookup_idx
  on public.integration_api_write_idempotency(
    company_id,
    api_client_id,
    route,
    idempotency_key
  );
create index if not exists integration_api_write_idempotency_processing_idx
  on public.integration_api_write_idempotency(started_at)
  where status = 'processing';

alter table public.integration_api_write_idempotency enable row level security;
revoke all on table public.integration_api_write_idempotency from public, anon, authenticated;
grant select, insert, update on table public.integration_api_write_idempotency to service_role;

commit;
