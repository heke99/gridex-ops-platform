-- GRIDEX OPS canonical architecture P0 convergence.
-- Forward-only: stop access/event inconsistencies, repair deterministic orphaned
-- access and queue state, and leave an audited compatibility adapter while the
-- deprecated canonical_* event tables are retired.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';
set local search_path = public, auth, pg_catalog;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Audited, idempotent data repair foundation.
-- ---------------------------------------------------------------------------
create table if not exists public.canonical_data_repair_audit (
  id uuid primary key default gen_random_uuid(),
  repair_key text not null,
  entity_type text not null,
  entity_id text not null,
  company_id uuid references public.companies(id) on delete set null,
  classification text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (repair_key, entity_type, entity_id)
);

alter table public.canonical_data_repair_audit enable row level security;
drop policy if exists canonical_data_repair_audit_service_role_all
  on public.canonical_data_repair_audit;
create policy canonical_data_repair_audit_service_role_all
on public.canonical_data_repair_audit
for all to service_role using (true) with check (true);
revoke all on public.canonical_data_repair_audit from public, anon, authenticated;
grant select, insert, update on public.canonical_data_repair_audit to service_role;

-- ---------------------------------------------------------------------------
-- 2. Membership and role convergence. Membership alone grants no permission.
-- ---------------------------------------------------------------------------
insert into public.roles(key, name, description, scope, is_system_role, is_active)
values (
  'owner',
  'Bolagsägare',
  'Canonical tenant owner role. Permissions are copied from company_admin.',
  'company',
  true,
  true
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  scope = excluded.scope,
  is_active = true;

insert into public.role_permissions(
  role_id, role_key, permission_id, permission_key, effect
)
select
  owner_role.id,
  'owner',
  rp.permission_id,
  rp.permission_key,
  rp.effect
from public.roles owner_role
join public.roles admin_role on admin_role.key = 'company_admin'
join public.role_permissions rp on rp.role_id = admin_role.id
where owner_role.key = 'owner'
  and not exists (
    select 1
    from public.role_permissions existing
    where existing.role_id = owner_role.id
      and existing.permission_id is not distinct from rp.permission_id
      and existing.permission_key is not distinct from rp.permission_key
      and existing.effect = rp.effect
  );

-- stale_platform_identity: retain the before image before removing an access
-- grant that can never resolve to an Auth identity.
insert into public.canonical_data_repair_audit(
  repair_key, entity_type, entity_id, company_id, classification, before_state,
  after_state, verified_at
)
select
  '20260810184247_stale_platform_identity',
  'user_role',
  ur.id::text,
  ur.company_id,
  'stale_platform_identity',
  jsonb_build_object(
    'user_id', ur.user_id,
    'company_id', ur.company_id,
    'role', coalesce(ur.role, r.key, r.name),
    'status', ur.status,
    'is_active', ur.is_active
  ),
  jsonb_build_object('action', 'deleted_orphaned_access_grant'),
  now()
from public.user_roles ur
left join public.roles r on r.id = ur.role_id
left join auth.users au on au.id = ur.user_id
where au.id is null
on conflict (repair_key, entity_type, entity_id) do nothing;

delete from public.user_roles ur
where not exists (select 1 from auth.users au where au.id = ur.user_id);

-- membership_without_role: deterministically materialize the role mapped by the
-- active membership before permission fallbacks are removed.
insert into public.canonical_data_repair_audit(
  repair_key, entity_type, entity_id, company_id, classification, before_state,
  after_state, verified_at
)
select
  '20260810184247_membership_without_role',
  'company_membership',
  cm.id::text,
  cm.company_id,
  'membership_without_role',
  jsonb_build_object(
    'user_id', cm.user_id,
    'membership_role', cm.membership_role,
    'role_key', cm.role_key
  ),
  jsonb_build_object(
    'action', 'canonical_role_backfilled',
    'role_key', coalesce(nullif(lower(cm.role_key), ''), nullif(lower(cm.membership_role), ''), 'member')
  ),
  now()
from public.company_memberships cm
where cm.status = 'active'
  and coalesce(cm.is_active, true)
  and exists (select 1 from auth.users au where au.id = cm.user_id)
  and not exists (
    select 1 from public.user_roles ur
    where ur.company_id = cm.company_id
      and ur.user_id = cm.user_id
      and coalesce(ur.status, 'active') = 'active'
      and coalesce(ur.is_active, true)
  )
on conflict (repair_key, entity_type, entity_id) do nothing;

insert into public.user_roles(
  user_id, company_id, role, role_id, status, is_active, created_at, updated_at
)
select
  cm.user_id,
  cm.company_id,
  role_definition.key,
  role_definition.id,
  'active',
  true,
  now(),
  now()
from public.company_memberships cm
join public.roles role_definition
  on role_definition.key = coalesce(
    nullif(lower(cm.role_key), ''),
    nullif(lower(cm.membership_role), ''),
    'member'
  )
where cm.status = 'active'
  and coalesce(cm.is_active, true)
  and exists (select 1 from auth.users au where au.id = cm.user_id)
  and not exists (
    select 1 from public.user_roles ur
    where ur.company_id = cm.company_id
      and ur.user_id = cm.user_id
      and coalesce(ur.status, 'active') = 'active'
      and coalesce(ur.is_active, true)
  );

create unique index if not exists user_roles_company_user_single_active_uidx
  on public.user_roles(company_id, user_id)
  where company_id is not null
    and coalesce(status, 'active') = 'active'
    and coalesce(is_active, true);

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_roles'::regclass
      and conname = 'user_roles_user_id_auth_users_fk'
  ) then
    alter table public.user_roles
      add constraint user_roles_user_id_auth_users_fk
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.company_memberships'::regclass
      and conname = 'company_memberships_user_id_auth_users_fk'
  ) then
    alter table public.company_memberships
      add constraint company_memberships_user_id_auth_users_fk
      foreign key (user_id) references auth.users(id) on delete cascade not valid;
  end if;
end
$constraints$;

alter table public.user_roles
  validate constraint user_roles_user_id_auth_users_fk;
alter table public.company_memberships
  validate constraint company_memberships_user_id_auth_users_fk;

create or replace function public.canonical_actor_is_authorized(
  p_company_id uuid,
  p_actor_user_id uuid,
  p_permission_key text,
  p_platform_only boolean default false
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  select public.canonical_actor_is_platform_admin(p_actor_user_id)
    or (
      not p_platform_only
      and p_company_id is not null
      and exists (
        select 1
        from auth.users u
        join public.user_profiles up on up.id = u.id
        join public.company_memberships cm
          on cm.user_id = u.id
         and cm.company_id = p_company_id
         and cm.status = 'active'
         and coalesce(cm.is_active, true)
        join public.user_roles ur
          on ur.user_id = u.id
         and ur.company_id = p_company_id
         and coalesce(ur.status, 'active') = 'active'
         and coalesce(ur.is_active, true)
        join public.roles r on r.id = ur.role_id and coalesce(r.is_active, true)
        join public.role_permissions rp on rp.role_id = r.id
        join public.permissions p on p.id = rp.permission_id
        where u.id = p_actor_user_id
          and u.deleted_at is null
          and (u.banned_until is null or u.banned_until <= now())
          and u.email_confirmed_at is not null
          and up.user_status = 'active'
          and p.key = p_permission_key
      )
    )
$function$;

revoke all on function public.canonical_actor_is_authorized(uuid, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.canonical_actor_is_authorized(uuid, uuid, text, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. External integration authentication is fail-closed on readiness.
-- ---------------------------------------------------------------------------
do $rename_auth$
begin
  if to_regprocedure(
    'public.authenticate_integration_request_v1(text,text,text,text[],text[],text,text,integer,integer)'
  ) is not null
  and to_regprocedure(
    'public.authenticate_integration_request_v1_credential_core(text,text,text,text[],text[],text,text,integer,integer)'
  ) is null then
    alter function public.authenticate_integration_request_v1(
      text,text,text,text[],text[],text,text,integer,integer
    ) rename to authenticate_integration_request_v1_credential_core;
  end if;
end
$rename_auth$;

revoke all on function public.authenticate_integration_request_v1_credential_core(
  text,text,text,text[],text[],text,text,integer,integer
) from public, anon, authenticated;
grant execute on function public.authenticate_integration_request_v1_credential_core(
  text,text,text,text[],text[],text,text,integer,integer
) to service_role;

create function public.authenticate_integration_request_v1(
  p_key_prefix text,
  p_secret_hash text,
  p_route text,
  p_required_all text[] default array[]::text[],
  p_required_any text[] default array[]::text[],
  p_client_ip text default null,
  p_origin text default null,
  p_rate_limit_cost integer default 1,
  p_window_seconds integer default 60
)
returns table (
  auth_outcome text,
  error_code text,
  tenant_status text,
  client_id uuid,
  company_id uuid,
  client_name text,
  client_status text,
  key_prefix text,
  secret_hash text,
  scopes text[],
  allowed_ips text[],
  allowed_origins text[],
  metadata jsonb,
  rate_limit_per_minute integer,
  expires_at timestamptz,
  request_count integer,
  route_limit integer,
  reset_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $function$
  with auth as (
    select *
    from public.authenticate_integration_request_v1_credential_core(
      p_key_prefix, p_secret_hash, p_route, p_required_all, p_required_any,
      p_client_ip, p_origin, p_rate_limit_cost, p_window_seconds
    )
  ), readiness as (
    select
      auth.*,
      exists (
        select 1
        from public.integration_api_clients client
        where client.id = auth.client_id
          and client.company_id = auth.company_id
          and client.launch_ready is true
          and jsonb_typeof(coalesce(client.launch_blockers, '[]'::jsonb)) = 'array'
          and jsonb_array_length(coalesce(client.launch_blockers, '[]'::jsonb)) = 0
      ) as client_ready,
      exists (
        select 1
        from public.tenant_website_installation_receipts receipt
        where receipt.api_client_id = auth.client_id
          and receipt.company_id = auth.company_id
          and receipt.state = 'completed'
          and receipt.completed_at is not null
          and nullif(receipt.receipt_sha256, '') is not null
      ) as receipt_ready,
      exists (
        select 1
        from public.company_capabilities capability
        where capability.company_id = auth.company_id
          and capability.capability_code = 'api_sales'
          and capability.enabled is true
          and capability.readiness_status = 'ready'
      ) as capability_ready
    from auth
  )
  select
    case
      when readiness.auth_outcome <> 'allowed' then readiness.auth_outcome
      when readiness.client_ready and readiness.receipt_ready and readiness.capability_ready then 'allowed'
      else 'denied'
    end,
    case
      when readiness.auth_outcome <> 'allowed' then readiness.error_code
      when not readiness.client_ready then 'api_client_not_launch_ready'
      when not readiness.receipt_ready then 'integration_receipt_not_verified'
      when not readiness.capability_ready then 'integration_capability_not_ready'
      else null
    end,
    readiness.tenant_status,
    readiness.client_id,
    readiness.company_id,
    readiness.client_name,
    readiness.client_status,
    readiness.key_prefix,
    readiness.secret_hash,
    readiness.scopes,
    readiness.allowed_ips,
    readiness.allowed_origins,
    readiness.metadata,
    readiness.rate_limit_per_minute,
    readiness.expires_at,
    readiness.request_count,
    readiness.route_limit,
    readiness.reset_at
  from readiness
$function$;

revoke all on function public.authenticate_integration_request_v1(
  text,text,text,text[],text[],text,text,integer,integer
) from public, anon, authenticated;
grant execute on function public.authenticate_integration_request_v1(
  text,text,text,text[],text[],text,text,integer,integer
) to service_role;

create or replace function public.authenticate_provisioning_smoke_request_v1(
  p_key_prefix text,
  p_secret_hash text,
  p_receipt_id uuid,
  p_route text,
  p_required_all text[] default array[]::text[],
  p_required_any text[] default array[]::text[],
  p_client_ip text default null,
  p_origin text default null,
  p_rate_limit_cost integer default 1,
  p_window_seconds integer default 60
)
returns table (
  auth_outcome text,
  error_code text,
  tenant_status text,
  client_id uuid,
  company_id uuid,
  client_name text,
  client_status text,
  key_prefix text,
  secret_hash text,
  scopes text[],
  allowed_ips text[],
  allowed_origins text[],
  metadata jsonb,
  rate_limit_per_minute integer,
  expires_at timestamptz,
  request_count integer,
  route_limit integer,
  reset_at timestamptz
)
language sql
security definer
set search_path = public, pg_temp
as $function$
  with auth as (
    select *
    from public.authenticate_integration_request_v1_credential_core(
      p_key_prefix, p_secret_hash, p_route, p_required_all, p_required_any,
      p_client_ip, p_origin, p_rate_limit_cost, p_window_seconds
    )
  ), checked as (
    select
      auth.*,
      p_route like 'provisioning-smoke:%'
      and exists (
        select 1
        from public.tenant_website_installation_receipts receipt
        where receipt.id = p_receipt_id
          and receipt.api_client_id = auth.client_id
          and receipt.company_id = auth.company_id
          and receipt.state in (
            'client_ready','credential_created','preflight_passed',
            'feed_verified','failed'
          )
      ) as smoke_allowed
    from auth
  )
  select
    case
      when checked.auth_outcome <> 'allowed' then checked.auth_outcome
      when checked.smoke_allowed then 'allowed'
      else 'denied'
    end,
    case
      when checked.auth_outcome <> 'allowed' then checked.error_code
      when not checked.smoke_allowed then 'provisioning_smoke_receipt_invalid'
      else null
    end,
    checked.tenant_status,
    checked.client_id,
    checked.company_id,
    checked.client_name,
    checked.client_status,
    checked.key_prefix,
    checked.secret_hash,
    checked.scopes,
    checked.allowed_ips,
    checked.allowed_origins,
    checked.metadata,
    checked.rate_limit_per_minute,
    checked.expires_at,
    checked.request_count,
    checked.route_limit,
    checked.reset_at
  from checked
$function$;

revoke all on function public.authenticate_provisioning_smoke_request_v1(
  text,text,uuid,text,text[],text[],text,text,integer,integer
) from public, anon, authenticated;
grant execute on function public.authenticate_provisioning_smoke_request_v1(
  text,text,uuid,text,text[],text[],text,text,integer,integer
) to service_role;

insert into public.canonical_data_repair_audit(
  repair_key, entity_type, entity_id, company_id, classification,
  before_state, after_state, verified_at
)
select
  '20260810184247_pause_unready_api_client',
  'integration_api_client',
  client.id::text,
  client.company_id,
  'active_credential_without_canonical_readiness',
  jsonb_build_object(
    'status', client.status,
    'launch_ready', client.launch_ready,
    'launch_blockers', client.launch_blockers
  ),
  jsonb_build_object('status', 'paused', 'reason', 'canonical_readiness_required'),
  now()
from public.integration_api_clients client
where client.status = 'active'
  and client.deleted_at is null
  and coalesce(client.launch_ready, false) = false
on conflict (repair_key, entity_type, entity_id) do nothing;

update public.integration_api_clients client
set status = 'paused',
    launch_ready = false,
    launch_blockers = coalesce(client.launch_blockers, '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object(
        'code', 'canonical_readiness_required',
        'source', '20260810184247_gridex_canonical_architecture_p0'
      )),
    metadata = coalesce(client.metadata, '{}'::jsonb)
      || jsonb_build_object(
        'canonical_readiness_paused_at', now(),
        'canonical_readiness_pause_reason', 'verified_receipt_and_api_sales_capability_required'
      ),
    updated_at = now()
where client.status = 'active'
  and client.deleted_at is null
  and coalesce(client.launch_ready, false) = false;

-- ---------------------------------------------------------------------------
-- 4. One canonical lifecycle write path plus additive lifecycle projection.
-- ---------------------------------------------------------------------------
alter table public.companies
  add column if not exists lifecycle_status text;

alter table public.companies
  drop constraint if exists companies_lifecycle_status_check;
alter table public.companies
  add constraint companies_lifecycle_status_check
  check (lifecycle_status in (
    'creating','provisioning','onboarding','ready','active',
    'suspended','closing','closed'
  )) not valid;

update public.companies
set lifecycle_status = case status
  when 'active' then 'active'
  when 'onboarding' then 'onboarding'
  when 'paused' then 'suspended'
  when 'suspended' then 'suspended'
  when 'archived' then 'closing'
  when 'pending_deletion' then 'closing'
  when 'closed' then 'closed'
  when 'deleted_test_only' then 'closed'
  else 'creating'
end
where lifecycle_status is null;

alter table public.companies
  alter column lifecycle_status set default 'creating';
alter table public.companies
  alter column lifecycle_status set not null;
alter table public.companies
  validate constraint companies_lifecycle_status_check;

create or replace function public.gridex_sync_company_lifecycle_status()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
begin
  new.lifecycle_status := case new.status
    when 'active' then 'active'
    when 'onboarding' then 'onboarding'
    when 'paused' then 'suspended'
    when 'suspended' then 'suspended'
    when 'archived' then 'closing'
    when 'pending_deletion' then 'closing'
    when 'closed' then 'closed'
    when 'deleted_test_only' then 'closed'
    else coalesce(new.lifecycle_status, 'creating')
  end;
  return new;
end
$function$;

drop trigger if exists companies_lifecycle_status_projection on public.companies;
create trigger companies_lifecycle_status_projection
before insert or update of status on public.companies
for each row execute function public.gridex_sync_company_lifecycle_status();

-- ---------------------------------------------------------------------------
-- 5. Retire the unconsumed canonical outbox as an active bus. New inserts are
-- synchronously mirrored with the same IDs into domain_events/event_outbox and
-- marked processed in the compatibility table.
-- ---------------------------------------------------------------------------
create or replace function public.gridex_bridge_deprecated_canonical_event_bus()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_event public.canonical_domain_events%rowtype;
  v_event_type text;
begin
  select * into v_event
  from public.canonical_domain_events
  where id = new.domain_event_id;
  if not found then
    raise exception using errcode = '23503', message = 'canonical_domain_event_missing';
  end if;

  v_event_type := lower(regexp_replace(v_event.event_type, '_', '.', 'g'));
  if v_event_type !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' then
    v_event_type := 'canonical.' || lower(regexp_replace(v_event.event_type, '[^a-zA-Z0-9]+', '_', 'g'));
  end if;

  insert into public.domain_events(
    id, company_id, event_type, aggregate_type, aggregate_id, actor_user_id,
    source, event_version, idempotency_key, payload, occurred_at, created_at
  ) values (
    v_event.id, v_event.company_id, v_event_type, v_event.aggregate_type,
    v_event.aggregate_id::text, v_event.created_by,
    'canonical_event_bus_deprecation',
    greatest(1, least(coalesce(v_event.aggregate_version, 1), 2147483647)::integer),
    'canonical:' || v_event.id::text,
    v_event.payload,
    v_event.occurred_at,
    v_event.occurred_at
  ) on conflict (id) do nothing;

  insert into public.event_outbox(
    id, company_id, domain_event_id, destination_type, destination_key,
    status, attempts, max_attempts, available_at, payload, created_at, updated_at
  ) values (
    new.id, new.company_id, v_event.id, 'webhook', 'webhook_fanout_v1',
    'queued', 0, 12, new.available_at,
    coalesce(new.payload, '{}'::jsonb)
      || jsonb_build_object('canonical_topic', new.topic),
    new.created_at, now()
  ) on conflict (id) do nothing;

  update public.canonical_event_outbox
  set status = 'processed',
      processed_at = coalesce(processed_at, now()),
      last_error = 'canonical_event_bus_deprecation:mirrored_to_domain_events',
      claimed_at = coalesce(claimed_at, now())
  where id = new.id;

  return new;
end
$function$;

drop trigger if exists canonical_event_outbox_deprecation_bridge
  on public.canonical_event_outbox;
create trigger canonical_event_outbox_deprecation_bridge
after insert on public.canonical_event_outbox
for each row execute function public.gridex_bridge_deprecated_canonical_event_bus();

-- Preserve existing outbox identities; only correct the destination contract so
-- the active worker can claim the six stranded contract.closed rows.
insert into public.canonical_data_repair_audit(
  repair_key, entity_type, entity_id, company_id, classification,
  before_state, after_state, verified_at
)
select
  '20260810184247_contract_closed_outbox',
  'event_outbox',
  outbox.id::text,
  outbox.company_id,
  'stranded_destination_key',
  jsonb_build_object(
    'destination_type', outbox.destination_type,
    'destination_key', outbox.destination_key,
    'status', outbox.status,
    'attempts', outbox.attempts
  ),
  jsonb_build_object(
    'destination_type', 'webhook',
    'destination_key', 'webhook_fanout_v1',
    'status', 'queued'
  ),
  now()
from public.event_outbox outbox
where outbox.destination_key = 'contract.closed'
on conflict (repair_key, entity_type, entity_id) do nothing;

update public.event_outbox
set destination_type = 'webhook',
    destination_key = 'webhook_fanout_v1',
    status = 'queued',
    available_at = least(available_at, now()),
    locked_at = null,
    locked_by = null,
    last_error = null,
    updated_at = now()
where destination_key = 'contract.closed'
  and status in ('queued', 'failed', 'processing');

-- Backfill any canonical compatibility rows created before the bridge. The
-- connected baseline currently has none, but this makes replay deterministic.
insert into public.domain_events(
  id, company_id, event_type, aggregate_type, aggregate_id, actor_user_id,
  source, event_version, idempotency_key, payload, occurred_at, created_at
)
select
  event.id,
  event.company_id,
  case
    when lower(regexp_replace(event.event_type, '_', '.', 'g'))
      ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
      then lower(regexp_replace(event.event_type, '_', '.', 'g'))
    else 'canonical.' || lower(regexp_replace(event.event_type, '[^a-zA-Z0-9]+', '_', 'g'))
  end,
  event.aggregate_type,
  event.aggregate_id::text,
  event.created_by,
  'canonical_event_bus_deprecation',
  greatest(1, least(coalesce(event.aggregate_version, 1), 2147483647)::integer),
  'canonical:' || event.id::text,
  event.payload,
  event.occurred_at,
  event.occurred_at
from public.canonical_domain_events event
on conflict (id) do nothing;

insert into public.event_outbox(
  id, company_id, domain_event_id, destination_type, destination_key,
  status, attempts, max_attempts, available_at, payload, created_at, updated_at
)
select
  outbox.id,
  outbox.company_id,
  outbox.domain_event_id,
  'webhook',
  'webhook_fanout_v1',
  'queued',
  0,
  12,
  outbox.available_at,
  coalesce(outbox.payload, '{}'::jsonb)
    || jsonb_build_object('canonical_topic', outbox.topic),
  outbox.created_at,
  now()
from public.canonical_event_outbox outbox
where outbox.status in ('pending', 'processing', 'failed')
on conflict (id) do nothing;

update public.canonical_event_outbox outbox
set status = 'processed',
    processed_at = coalesce(outbox.processed_at, now()),
    claimed_at = coalesce(outbox.claimed_at, now()),
    last_error = 'canonical_event_bus_deprecation:mirrored_to_domain_events'
where outbox.status in ('pending', 'processing', 'failed')
  and exists (select 1 from public.event_outbox active where active.id = outbox.id);

-- ---------------------------------------------------------------------------
-- 6. Persist actionable reconciliation ownership and repair instructions.
-- ---------------------------------------------------------------------------
alter table public.platform_reconciliation_findings
  add column if not exists owner text,
  add column if not exists repair_action text,
  add column if not exists sla_due_at timestamptz,
  add column if not exists check_error text;

update public.canonical_data_repair_audit
set verified_at = coalesce(verified_at, now())
where repair_key like '20260810184247_%';

commit;

