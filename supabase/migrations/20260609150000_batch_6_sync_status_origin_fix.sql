-- Batch 6 verification fix: API-client origins + customer portal identity status mapping.
-- Idempotent patch for existing SaaS databases where Batch 6 tables already exist.

alter table public.integration_api_clients
  add column if not exists allowed_origins text[] not null default '{}';

alter table public.integration_api_clients
  add column if not exists allowed_ips text[] not null default '{}';

alter table public.integration_api_clients
  add column if not exists rate_limit_per_minute integer not null default 60;

alter table public.integration_api_clients
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.integration_api_clients
set allowed_origins = array(
    select jsonb_array_elements_text(metadata -> 'allowed_origins')
  ),
  updated_at = now()
where coalesce(array_length(allowed_origins, 1), 0) = 0
  and jsonb_typeof(metadata -> 'allowed_origins') = 'array';

-- Existing constraints in live DB allow status active/pending_review/rejected/disabled
-- and match_strength strong/weak/manual. Align defaults/data with that production contract.
alter table public.customer_portal_identities
  alter column status set default 'pending_review';

alter table public.customer_portal_identities
  alter column match_strength set default 'manual';

update public.customer_portal_identities
set status = 'active', updated_at = now()
where status = 'linked';

update public.customer_portal_identities
set match_strength = 'manual', updated_at = now()
where match_strength is null or match_strength in ('none', 'rejected');

create index if not exists integration_api_clients_company_status_idx
  on public.integration_api_clients(company_id, status);

create index if not exists integration_api_clients_allowed_origins_gin_idx
  on public.integration_api_clients using gin(allowed_origins);
