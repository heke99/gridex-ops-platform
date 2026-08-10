-- Canonical access bootstrap, invitation intent and provisioning worker v1.
-- External delivery happens only after the durable intent transaction commits.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '180s';
set local search_path = public, auth, pg_catalog;

alter table public.company_provisioning_jobs
  add column if not exists max_attempts integer not null default 5,
  add column if not exists started_at timestamptz,
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists lease_token uuid,
  add column if not exists last_error_message text,
  add column if not exists dead_letter_at timestamptz;

alter table public.company_provisioning_jobs
  drop constraint if exists company_provisioning_jobs_max_attempts_check;
alter table public.company_provisioning_jobs
  add constraint company_provisioning_jobs_max_attempts_check
  check (max_attempts between 1 and 20) not valid;
alter table public.company_provisioning_jobs
  validate constraint company_provisioning_jobs_max_attempts_check;

alter table public.company_provisioning_jobs
  drop constraint if exists company_provisioning_jobs_status_check;
alter table public.company_provisioning_jobs
  add constraint company_provisioning_jobs_status_check
  check(status in (
    'pending','processing','retry','completed','failed','dead_letter',
    'blocked_tenant_state','compensating','compensated'
  )) not valid;
alter table public.company_provisioning_jobs
  validate constraint company_provisioning_jobs_status_check;

update public.company_provisioning_jobs
set status = case when attempt_count >= max_attempts then 'dead_letter' else 'retry' end,
    dead_letter_at = case when attempt_count >= max_attempts then coalesce(dead_letter_at, now()) else dead_letter_at end,
    available_at = case when attempt_count < max_attempts then now() else available_at end,
    updated_at = now()
where status = 'failed';

drop index if exists public.company_provisioning_jobs_claim_idx;
create index company_provisioning_jobs_claim_idx
  on public.company_provisioning_jobs(available_at, created_at)
  where status in ('pending','retry');
create index if not exists company_provisioning_jobs_stale_lease_idx
  on public.company_provisioning_jobs(locked_at)
  where status = 'processing';

alter table public.company_invitations
  add column if not exists idempotency_key text;
create unique index if not exists company_invitations_company_idempotency_key
  on public.company_invitations(company_id, idempotency_key)
  where idempotency_key is not null;

alter table public.company_invitations
  drop constraint if exists company_invitations_status_check;
alter table public.company_invitations
  add constraint company_invitations_status_check
  check(status in (
    'pending','sending','sent','delivery_uncertain','accepted','revoked',
    'expired','invitation_revoked','invited','failed'
  )) not valid;
alter table public.company_invitations
  validate constraint company_invitations_status_check;

create or replace function public.canonical_tenant_operation_decision(
  p_company_id uuid,
  p_operation text
)
returns table (
  allowed boolean,
  reason_code text,
  company_status text,
  capability_status text,
  production_status text,
  state_version bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_company public.companies%rowtype;
  v_capability text;
  v_capability_row public.company_capabilities%rowtype;
  v_production_status text;
  v_base_allowed boolean := false;
begin
  select * into v_company from public.companies where id = p_company_id;
  if not found then
    return query select false, 'tenant_not_found', null::text, 'missing'::text, null::text, 0::bigint;
    return;
  end if;

  if to_regclass('public.ediel_production_state') is not null then
    execute 'select state from public.ediel_production_state where company_id = $1'
      into v_production_status using p_company_id;
  end if;
  v_production_status := coalesce(
    v_production_status,
    v_company.ediel_production_status,
    v_company.production_status,
    'disabled'
  );

  v_capability := case p_operation
    when 'email.send' then 'email_outbound'
    when 'webhook.deliver' then 'webhooks'
    when 'ediel.production.send' then 'ediel_production'
    when 'ediel.test.process' then 'ediel_test'
    when 'customer_automation.execute' then 'customer_automation'
    when 'facility_lookup.execute' then 'facility_lookup'
    when 'contract_channel.sell' then 'website_sales'
    when 'api_client.execute' then 'api_sales'
    else null
  end;

  if v_capability is not null then
    select * into v_capability_row
    from public.company_capabilities
    where company_id = p_company_id and capability_code = v_capability;
  end if;

  v_base_allowed := case coalesce(v_company.status, '__unknown__')
    when 'onboarding' then p_operation in (
      'tenant.provisioning.execute','ediel.test.process','invitation.accept',
      'company_user.manage','production.prepare','production.pause'
    )
    when 'active' then p_operation in (
      'tenant.provisioning.execute','email.send','webhook.deliver',
      'ediel.production.send','ediel.test.process','customer_automation.execute',
      'facility_lookup.execute','invitation.accept','company_user.manage',
      'production.prepare','production.activate','production.pause',
      'production.resume','contract_channel.sell','api_client.execute'
    )
    else false
  end;

  if not v_base_allowed then
    return query select false,
      case coalesce(v_company.status, '__unknown__')
        when 'paused' then 'tenant_paused'
        when 'suspended' then 'tenant_suspended'
        when 'archived' then 'tenant_archived'
        when 'pending_deletion' then 'tenant_pending_deletion'
        when 'closed' then 'tenant_closed'
        when 'deleted_test_only' then 'tenant_deleted_test_only'
        when 'onboarding' then 'operation_not_allowed_during_onboarding'
        else 'tenant_status_unknown'
      end,
      v_company.status,
      case when v_capability is null then 'not_required' else coalesce(v_capability_row.readiness_status, 'missing') end,
      v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  if v_capability is not null and not (
    coalesce(v_capability_row.enabled, false)
    and coalesce(v_capability_row.readiness_status, 'missing') = 'ready'
  ) then
    return query select false, 'capability_not_ready', v_company.status,
      coalesce(v_capability_row.readiness_status, 'missing'), v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  if p_operation = 'ediel.production.send' and v_production_status <> 'live' then
    return query select false, 'ediel_production_not_live', v_company.status,
      coalesce(v_capability_row.readiness_status, 'missing'), v_production_status,
      v_company.lifecycle_state_version;
    return;
  end if;

  return query select true, 'allowed', v_company.status,
    case when v_capability is null then 'not_required' else coalesce(v_capability_row.readiness_status, 'missing') end,
    v_production_status,
    v_company.lifecycle_state_version;
end
$function$;

revoke all on function public.canonical_tenant_operation_decision(uuid,text)
  from public, anon, authenticated;
grant execute on function public.canonical_tenant_operation_decision(uuid,text)
  to service_role;

create or replace function public.canonical_claim_company_provisioning_jobs(
  p_worker_id text,
  p_limit integer default 20,
  p_lease_seconds integer default 300
)
returns table (
  id uuid,
  company_id uuid,
  job_key text,
  idempotency_key text,
  attempt_count integer,
  max_attempts integer,
  lease_token uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'worker_id_required';
  end if;

  update public.company_provisioning_jobs job
  set status = case when job.attempt_count >= job.max_attempts then 'dead_letter' else 'retry' end,
      dead_letter_at = case when job.attempt_count >= job.max_attempts then coalesce(job.dead_letter_at, now()) else job.dead_letter_at end,
      available_at = case when job.attempt_count < job.max_attempts then now() else job.available_at end,
      last_error_code = 'stale_worker_lease',
      last_error_message = 'Provisioning worker lease expired before completion.',
      locked_at = null,
      locked_by = null,
      lease_token = null,
      updated_at = now()
  where job.status = 'processing'
    and job.locked_at < now() - make_interval(secs => greatest(30, least(p_lease_seconds, 3600)));

  return query
  with candidates as (
    select job.id
    from public.company_provisioning_jobs job
    join public.companies company on company.id = job.company_id
    where job.status in ('pending','retry')
      and job.available_at <= now()
      and job.attempt_count < job.max_attempts
      and company.status in ('onboarding','active')
      and (select decision.allowed
           from public.canonical_tenant_operation_decision(job.company_id, 'tenant.provisioning.execute') decision
           limit 1)
    order by job.available_at, job.created_at
    for update of job skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  ), claimed as (
    update public.company_provisioning_jobs job
    set status = 'processing',
        attempt_count = job.attempt_count + 1,
        started_at = coalesce(job.started_at, now()),
        claimed_at = now(),
        locked_at = now(),
        locked_by = p_worker_id,
        lease_token = gen_random_uuid(),
        last_error_code = null,
        last_error_message = null,
        updated_at = now()
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select claimed.id, claimed.company_id, claimed.job_key,
         claimed.idempotency_key, claimed.attempt_count,
         claimed.max_attempts, claimed.lease_token
  from claimed;
end
$function$;

create or replace function public.canonical_complete_company_provisioning_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_error_code text default null,
  p_error_message text default null,
  p_error_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_job public.company_provisioning_jobs%rowtype;
  v_status text;
  v_delay_seconds integer;
begin
  select * into v_job
  from public.company_provisioning_jobs
  where id = p_job_id
  for update;
  if not found then raise exception 'provisioning_job_not_found'; end if;
  if v_job.status <> 'processing' or v_job.lease_token is distinct from p_lease_token then
    raise exception 'provisioning_job_lease_conflict';
  end if;

  if p_succeeded then
    v_status := 'completed';
  elsif v_job.attempt_count >= v_job.max_attempts then
    v_status := 'dead_letter';
  else
    v_status := 'retry';
  end if;
  v_delay_seconds := least(3600, 30 * (2 ^ greatest(v_job.attempt_count - 1, 0))::integer);

  update public.company_provisioning_jobs
  set status = v_status,
      completed_at = case when p_succeeded then now() else completed_at end,
      dead_letter_at = case when v_status = 'dead_letter' then now() else null end,
      available_at = case when v_status = 'retry' then now() + make_interval(secs => v_delay_seconds) else available_at end,
      last_error_code = case when p_succeeded then null else coalesce(nullif(p_error_code, ''), 'provisioning_job_failed') end,
      last_error_message = case when p_succeeded then null else left(coalesce(p_error_message, 'Provisioning job failed.'), 1000) end,
      last_error_details = case when p_succeeded then '{}'::jsonb else coalesce(p_error_details, '{}'::jsonb) end,
      locked_at = null,
      locked_by = null,
      lease_token = null,
      updated_at = now()
  where id = p_job_id;

  return jsonb_build_object(
    'job_id', p_job_id,
    'status', v_status,
    'attempt_count', v_job.attempt_count,
    'max_attempts', v_job.max_attempts
  );
end
$function$;

revoke all on function public.canonical_claim_company_provisioning_jobs(text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.canonical_claim_company_provisioning_jobs(text,integer,integer)
  to service_role;
revoke all on function public.canonical_complete_company_provisioning_job(uuid,uuid,boolean,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.canonical_complete_company_provisioning_job(uuid,uuid,boolean,text,text,jsonb)
  to service_role;

create or replace function public.canonical_sync_provisioning_jobs_for_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.status in ('paused','suspended','archived','pending_deletion','closed') then
    update public.company_provisioning_jobs job
    set status = 'blocked_tenant_state',
        lifecycle_blocked_by_tenant = true,
        lifecycle_previous_status = job.status,
        locked_at = null,
        locked_by = null,
        lease_token = null,
        last_error_code = 'tenant_lifecycle_blocked',
        last_error_message = 'Tenant lifecycle blocks provisioning work.',
        updated_at = now()
    where job.company_id = new.id
      and job.status in ('pending','retry');
  elsif new.status = 'active' then
    update public.company_provisioning_jobs job
    set status = case when job.lifecycle_previous_status in ('pending','retry') then job.lifecycle_previous_status else 'pending' end,
        lifecycle_blocked_by_tenant = false,
        lifecycle_previous_status = null,
        available_at = now(),
        last_error_code = null,
        last_error_message = null,
        updated_at = now()
    where job.company_id = new.id
      and job.status = 'blocked_tenant_state'
      and job.lifecycle_blocked_by_tenant;
  end if;
  return new;
end
$function$;

revoke all on function public.canonical_sync_provisioning_jobs_for_lifecycle()
  from public, anon, authenticated;
drop trigger if exists companies_canonical_provisioning_lifecycle on public.companies;
create trigger companies_canonical_provisioning_lifecycle
after update of status on public.companies
for each row when (old.status is distinct from new.status)
execute function public.canonical_sync_provisioning_jobs_for_lifecycle();

create or replace function public.canonical_create_tenant_invitation(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_company_id uuid := nullif(p_command->>'company_id','')::uuid;
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id','')::uuid;
  v_email text := lower(btrim(p_command->>'email'));
  v_idempotency_key text := btrim(p_command->>'idempotency_key');
  v_token uuid;
  v_invitation_id uuid;
  v_existing jsonb;
  v_event_id uuid;
  v_result jsonb;
begin
  if v_company_id is null or nullif(v_email,'') is null or nullif(v_idempotency_key,'') is null then
    raise exception 'company_email_and_idempotency_key_required';
  end if;
  if not (
    public.canonical_actor_is_authorized(v_company_id,v_actor_user_id,'tenants.invite',false)
    or public.canonical_actor_is_authorized(v_company_id,v_actor_user_id,'users.write',false)
  ) then
    raise exception using errcode='42501', message='actor_not_authorized_for_tenant_invitation';
  end if;

  select result_payload into v_existing
  from public.canonical_command_results
  where company_id=v_company_id
    and command_type='tenant.invitation.create'
    and idempotency_key=v_idempotency_key;
  if found then return v_existing; end if;

  v_token := gen_random_uuid();
  insert into public.company_invitations(
    company_id,email,full_name,membership_role,role_key,status,token,
    invited_by,expires_at,accept_token_hash,idempotency_key,metadata
  ) values (
    v_company_id,v_email,nullif(btrim(p_command->>'full_name'),''),
    coalesce(nullif(lower(btrim(p_command->>'membership_role')),''),'member'),
    coalesce(nullif(lower(btrim(p_command->>'role_key')),''),'member'),
    'pending',v_token,v_actor_user_id,now()+interval '14 days',
    encode(digest(v_token::text,'sha256'),'hex'),v_idempotency_key,
    jsonb_build_object(
      'invite_source',coalesce(nullif(p_command->>'source',''),'canonical_invitation'),
      'access_source','verified_auth_invitation_link',
      'provider_delivery_status','pending'
    )
  )
  returning id into v_invitation_id;

  insert into public.company_provisioning_jobs(company_id,job_key,idempotency_key)
  values(v_company_id,'auth_invite',v_idempotency_key)
  on conflict(company_id,job_key,idempotency_key) do nothing;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,
    idempotency_key,after_state
  ) values (
    v_company_id,'TENANT_INVITATION_CREATED','company_invitation',v_invitation_id,
    v_actor_user_id,'Durable invitation intent created before provider delivery.',
    v_idempotency_key,jsonb_build_object('status','pending','role_key',p_command->>'role_key')
  );
  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,idempotency_key,payload,created_by
  ) values (
    v_company_id,'TENANT_INVITATION_CREATED','company_invitation',v_invitation_id,
    v_idempotency_key,jsonb_build_object('invitation_id',v_invitation_id,'status','pending'),v_actor_user_id
  ) returning id into v_event_id;
  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
  values(v_company_id,v_event_id,'tenant.invitation.created',v_idempotency_key,
    jsonb_build_object('invitation_id',v_invitation_id));

  v_result := jsonb_build_object(
    'invitation_id',v_invitation_id,
    'company_id',v_company_id,
    'token',v_token,
    'status','pending'
  );
  insert into public.canonical_command_results(
    company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id
  ) values (
    v_company_id,'tenant.invitation.create',v_idempotency_key,
    p_command - 'email',v_result,v_actor_user_id
  );
  return v_result;
end
$function$;

revoke all on function public.canonical_create_tenant_invitation(jsonb)
  from public, anon, authenticated;
grant execute on function public.canonical_create_tenant_invitation(jsonb)
  to service_role;

do $rename_provision$
begin
  if to_regprocedure('public.canonical_provision_company(jsonb)') is not null
     and to_regprocedure('public.canonical_provision_company_v3_pre_invitation_intent(jsonb)') is null then
    alter function public.canonical_provision_company(jsonb)
      rename to canonical_provision_company_v3_pre_invitation_intent;
  end if;
end
$rename_provision$;

revoke all on function public.canonical_provision_company_v3_pre_invitation_intent(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.canonical_provision_company(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_result jsonb;
  v_company_id uuid;
  v_email text := lower(btrim(p_command->>'initial_admin_email'));
  v_token uuid;
  v_invitation_id uuid;
begin
  v_result := public.canonical_provision_company_v3_pre_invitation_intent(p_command);
  v_company_id := (v_result->>'company_id')::uuid;

  if nullif(v_email,'') is not null then
    v_token := gen_random_uuid();
    insert into public.company_invitations(
      company_id,email,full_name,membership_role,role_key,status,token,
      invited_by,expires_at,accept_token_hash,idempotency_key,metadata
    ) values (
      v_company_id,v_email,nullif(btrim(p_command->>'initial_admin_name'),''),
      'company_admin','company_admin','pending',v_token,
      nullif(p_command->>'actor_user_id','')::uuid,now()+interval '14 days',
      encode(digest(v_token::text,'sha256'),'hex'),
      (p_command->>'idempotency_key')||':initial-admin',
      jsonb_build_object(
        'invite_source','create_company_initial_admin',
        'access_source','verified_auth_invitation_link',
        'provider_delivery_status','pending'
      )
    )
    on conflict (company_id,idempotency_key) where idempotency_key is not null
    do update set updated_at=now()
    returning id into v_invitation_id;
  end if;

  return v_result || jsonb_build_object(
    'initial_admin_invitation_id',v_invitation_id,
    'external_delivery_queued',v_invitation_id is not null
  );
end
$function$;

revoke all on function public.canonical_provision_company(jsonb)
  from public, anon, authenticated;
grant execute on function public.canonical_provision_company(jsonb)
  to service_role;

create or replace function public.canonical_authenticated_tenant_context(
  p_selected_company_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_platform boolean := false;
  v_profile_active boolean := false;
  v_selected_company_id uuid;
  v_memberships jsonb := '[]'::jsonb;
  v_roles jsonb := '[]'::jsonb;
  v_permissions jsonb := '[]'::jsonb;
  v_company jsonb;
  v_policy jsonb := '{}'::jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('authorized',false,'reason_code','authentication_required');
  end if;

  select exists(
    select 1 from auth.users u
    join public.user_profiles profile on profile.id=u.id
    where u.id=v_user_id and u.deleted_at is null
      and (u.banned_until is null or u.banned_until <= now())
      and u.email_confirmed_at is not null
      and profile.user_status='active'
  ) into v_profile_active;
  if not v_profile_active then
    return jsonb_build_object('authorized',false,'reason_code','identity_not_active');
  end if;

  v_platform := public.canonical_actor_is_platform_admin(v_user_id);
  select u.email into v_user_email from auth.users u where u.id=v_user_id;

  if v_platform then
    select coalesce(jsonb_agg(jsonb_build_object(
      'membership_id',null,
      'company_id',company.id,
      'company_name',company.name,
      'company_slug',company.slug,
      'org_number',company.org_number,
      'membership_role','platform_admin',
      'role_key','platform_admin',
      'status',company.status
    ) order by company.name),'[]'::jsonb)
    into v_memberships
    from public.companies company
    where company.status <> 'deleted_test_only';

    if p_selected_company_id is not null and exists(
      select 1 from public.companies where id=p_selected_company_id and status <> 'deleted_test_only'
    ) then
      v_selected_company_id := p_selected_company_id;
    end if;
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'membership_id',membership.id,
      'company_id',company.id,
      'company_name',company.name,
      'company_slug',company.slug,
      'org_number',company.org_number,
      'membership_role',membership.membership_role,
      'role_key',role.key,
      'status',company.status
    ) order by (membership.membership_role='owner') desc, company.name),'[]'::jsonb)
    into v_memberships
    from public.company_memberships membership
    join public.companies company on company.id=membership.company_id
    join public.user_roles user_role
      on user_role.user_id=membership.user_id
     and user_role.company_id=membership.company_id
     and coalesce(user_role.status,'active')='active'
     and coalesce(user_role.is_active,true)
    join public.roles role on role.id=user_role.role_id and coalesce(role.is_active,true)
    where membership.user_id=v_user_id
      and membership.status='active'
      and coalesce(membership.is_active,true);

    select company_id into v_selected_company_id
    from public.company_memberships membership
    where membership.user_id=v_user_id
      and membership.status='active'
      and coalesce(membership.is_active,true)
      and (p_selected_company_id is null or membership.company_id=p_selected_company_id)
      and exists(
        select 1 from public.user_roles user_role
        where user_role.user_id=membership.user_id
          and user_role.company_id=membership.company_id
          and coalesce(user_role.status,'active')='active'
          and coalesce(user_role.is_active,true)
      )
    order by (membership.company_id=p_selected_company_id) desc,
             (membership.membership_role='owner') desc,
             membership.created_at
    limit 1;
  end if;

  select coalesce(jsonb_agg(distinct role.key),'[]'::jsonb)
  into v_roles
  from public.user_roles user_role
  join public.roles role on role.id=user_role.role_id and coalesce(role.is_active,true)
  where user_role.user_id=v_user_id
    and coalesce(user_role.status,'active')='active'
    and coalesce(user_role.is_active,true)
    and (user_role.company_id is null or user_role.company_id=v_selected_company_id);

  select coalesce(jsonb_agg(distinct permission.key),'[]'::jsonb)
  into v_permissions
  from public.user_roles user_role
  join public.roles role on role.id=user_role.role_id and coalesce(role.is_active,true)
  join public.role_permissions role_permission on role_permission.role_id=role.id
  join public.permissions permission on permission.id=role_permission.permission_id
  where user_role.user_id=v_user_id
    and coalesce(user_role.status,'active')='active'
    and coalesce(user_role.is_active,true)
    and (user_role.company_id is null or user_role.company_id=v_selected_company_id)
    and coalesce(role_permission.effect,'allow')='allow';

  if v_selected_company_id is not null then
    select jsonb_build_object(
      'id',company.id,
      'name',company.name,
      'slug',company.slug,
      'org_number',company.org_number,
      'status',company.status,
      'lifecycle_status',company.lifecycle_status,
      'lifecycle_state_version',company.lifecycle_state_version
    ) into v_company
    from public.companies company where company.id=v_selected_company_id;

    select coalesce(jsonb_object_agg(operation.operation, to_jsonb(decision)),'{}'::jsonb)
    into v_policy
    from unnest(array[
      'tenant.provisioning.execute','email.send','webhook.deliver',
      'customer_automation.execute','facility_lookup.execute',
      'contract_channel.sell','api_client.execute'
    ]::text[]) operation(operation)
    cross join lateral public.canonical_tenant_operation_decision(
      v_selected_company_id, operation.operation
    ) decision;
  end if;

  return jsonb_build_object(
    'authorized',true,
    'user_id',v_user_id,
    'user_email',v_user_email,
    'is_platform_admin',v_platform,
    'selected_company_id',v_selected_company_id,
    'memberships',v_memberships,
    'roles',v_roles,
    'permissions',v_permissions,
    'company',v_company,
    'operation_policy',v_policy,
    'access_invariant_ok',v_platform or v_selected_company_id is not null
  );
end
$function$;

revoke all on function public.canonical_authenticated_tenant_context(uuid)
  from public, anon;
grant execute on function public.canonical_authenticated_tenant_context(uuid)
  to authenticated;

commit;

