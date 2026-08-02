-- Canonical tenant provisioning saga and atomic tenant access invariants.

begin;

-- Normalize the membership columns used by the canonical access RPC without
-- changing or removing any legacy fields.
alter table public.company_memberships
  add column if not exists membership_role text not null default 'member',
  add column if not exists status text not null default 'active',
  add column if not exists is_active boolean not null default true,
  add column if not exists invited_by uuid,
  add column if not exists accepted_at timestamptz,
  add column if not exists suspended_at timestamptz,
  add column if not exists disabled_at timestamptz,
  add column if not exists removed_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.company_provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_key text not null,
  status text not null default 'pending',
  idempotency_key text not null,
  attempt_count integer not null default 0,
  last_error_code text,
  last_error_details jsonb not null default '{}'::jsonb,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_provisioning_jobs_status_check
    check(status in ('pending','processing','completed','failed','blocked_tenant_state','compensating','compensated')),
  constraint company_provisioning_jobs_company_key unique(company_id,job_key,idempotency_key)
);

create index if not exists company_provisioning_jobs_claim_idx
  on public.company_provisioning_jobs(status,available_at,created_at);

alter table public.company_provisioning_jobs enable row level security;
drop policy if exists company_provisioning_jobs_service_role_all on public.company_provisioning_jobs;
create policy company_provisioning_jobs_service_role_all on public.company_provisioning_jobs
for all to service_role using(true) with check(true);
drop policy if exists company_provisioning_jobs_tenant_read on public.company_provisioning_jobs;
create policy company_provisioning_jobs_tenant_read on public.company_provisioning_jobs
for select to authenticated using(public.gridex_can_read_company(company_id));
grant all on public.company_provisioning_jobs to service_role;
grant select on public.company_provisioning_jobs to authenticated;

create or replace function public.canonical_seed_company_capabilities(p_company_id uuid)
returns void language sql security definer set search_path=public,pg_temp as $$
  insert into public.company_capabilities(company_id,capability_code,enabled,readiness_status)
  select p_company_id, capability_code, false, 'not_configured'
  from unnest(array[
    'customer_intake','website_sales','api_sales','ediel_test','ediel_production',
    'webhooks','email_outbound','customer_automation','billing','facility_lookup'
  ]::text[]) capability_code
  on conflict(company_id,capability_code) do nothing;
$$;

create or replace function public.canonical_company_capability_seed_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.canonical_seed_company_capabilities(new.id);
  return new;
end;
$$;
drop trigger if exists companies_canonical_capability_seed on public.companies;
create trigger companies_canonical_capability_seed
after insert on public.companies
for each row execute function public.canonical_company_capability_seed_trigger();


create table if not exists public.canonical_provisioning_requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  company_id uuid not null references public.companies(id) on delete cascade,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.canonical_provisioning_requests enable row level security;
drop policy if exists canonical_provisioning_requests_platform_read on public.canonical_provisioning_requests;
create policy canonical_provisioning_requests_platform_read on public.canonical_provisioning_requests
for select to authenticated
using(public.gridex_user_is_platform_admin());
grant all on public.canonical_provisioning_requests to service_role;
grant select on public.canonical_provisioning_requests to authenticated;

create or replace function public.canonical_provision_company(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_company_id uuid:=nullif(p_command->>'company_id','')::uuid;
  v_actor_user_id uuid:=nullif(p_command->>'actor_user_id','')::uuid;
  v_idempotency_key text:=p_command->>'idempotency_key';
  v_existing jsonb;
  v_event_id uuid;
  v_result jsonb;
  v_job_key text;
begin
  if nullif(btrim(p_command->>'name'),'') is null
     or nullif(btrim(p_command->>'slug'),'') is null
     or nullif(btrim(v_idempotency_key),'') is null then
    raise exception 'name_slug_and_idempotency_key_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_idempotency_key,0));

  select result_payload into v_existing
  from public.canonical_provisioning_requests
  where idempotency_key=v_idempotency_key;
  if found and v_existing is not null then return v_existing; end if;
  if found then raise exception 'tenant_provisioning_request_in_progress'; end if;

  v_company_id:=coalesce(v_company_id,gen_random_uuid());

  insert into public.companies(
    id,name,slug,org_number,status,primary_contact_email,primary_contact_name,
    phone,website,industry,metadata,created_by,created_at,updated_at
  ) values (
    v_company_id,btrim(p_command->>'name'),lower(btrim(p_command->>'slug')),
    nullif(btrim(p_command->>'organization_number'),''),'onboarding',
    nullif(lower(btrim(p_command->>'primary_contact_email')),''),
    nullif(btrim(p_command->>'primary_contact_name'),''),
    nullif(btrim(p_command->>'phone'),''),nullif(btrim(p_command->>'website'),''),
    coalesce(nullif(btrim(p_command->>'industry'),''),'electricity_supplier'),
    coalesce(p_command->'metadata','{}'::jsonb)||jsonb_build_object('canonical_provisioning_idempotency_key',v_idempotency_key),
    v_actor_user_id,now(),now()
  );

  insert into public.canonical_provisioning_requests(idempotency_key,company_id,request_payload)
  values(v_idempotency_key,v_company_id,p_command);

  perform public.canonical_seed_company_capabilities(v_company_id);
  perform public.gridex_seed_company_onboarding_tasks(v_company_id);

  insert into public.company_onboarding_lifecycle(company_id,current_step,status)
  values(v_company_id,'created','in_progress')
  on conflict(company_id) do nothing;

  foreach v_job_key in array array[
    'legal_profile','email_configuration','capability_review','onboarding_tasks',
    'admin_access','auth_invite','ediel_configuration'
  ] loop
    insert into public.company_provisioning_jobs(company_id,job_key,idempotency_key)
    values(v_company_id,v_job_key,v_idempotency_key)
    on conflict do nothing;
  end loop;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,state_version,actor_user_id,
    reason,idempotency_key,after_state,metadata
  ) values (
    v_company_id,'TENANT_PROVISIONING_STARTED','company',v_company_id,0,v_actor_user_id,
    'Canonical tenant provisioning started.',v_idempotency_key,
    jsonb_build_object('status','onboarding'),p_command
  );
  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,aggregate_version,
    idempotency_key,payload,created_by
  ) values (
    v_company_id,'TENANT_PROVISIONING_STARTED','company',v_company_id,0,v_idempotency_key,
    jsonb_build_object('company_id',v_company_id,'status','onboarding'),v_actor_user_id
  ) returning id into v_event_id;
  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
  values(v_company_id,v_event_id,'tenant.provisioning.started',v_idempotency_key,
    jsonb_build_object('company_id',v_company_id));

  v_result:=jsonb_build_object('company_id',v_company_id,'status','onboarding','provisioning_started',true);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(v_company_id,'tenant.provision',v_idempotency_key,p_command,v_result,v_actor_user_id);
  update public.canonical_provisioning_requests
  set result_payload=v_result,completed_at=now()
  where idempotency_key=v_idempotency_key;
  return v_result;
end;
$$;

revoke all on function public.canonical_provision_company(jsonb) from public,anon,authenticated;
grant execute on function public.canonical_provision_company(jsonb) to service_role;

create or replace function public.canonical_actor_is_platform_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public,auth,pg_temp
as $$
  select p_user_id is not null and (
    exists(
      select 1 from public.admin_users au
      where au.user_id=p_user_id
        and coalesce(au.is_active,true)
        and lower(replace(coalesce(au.role,''),'-','_')) in ('super_admin','superadmin','platform_admin','platformadmin')
    )
    or exists(
      select 1
      from public.user_roles ur
      left join public.roles r on r.id=ur.role_id
      where ur.user_id=p_user_id
        and coalesce(ur.is_active,true)
        and coalesce(ur.status,'active')='active'
        and lower(replace(coalesce(ur.role,r.key,r.name,''),'-','_'))
          in ('super_admin','superadmin','platform_admin','platformadmin')
    )
  )
$$;
revoke all on function public.canonical_actor_is_platform_admin(uuid) from public,anon,authenticated;
grant execute on function public.canonical_actor_is_platform_admin(uuid) to service_role;

create or replace function public.canonical_change_tenant_user_access(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path=public,auth,pg_temp
as $$
declare
  v_company_id uuid:=(p_command->>'company_id')::uuid;
  v_user_id uuid:=(p_command->>'user_id')::uuid;
  v_actor_user_id uuid:=nullif(p_command->>'actor_user_id','')::uuid;
  v_action text:=lower(p_command->>'action');
  v_membership_role text:=lower(coalesce(nullif(p_command->>'membership_role',''),'member'));
  v_role_key text:=lower(coalesce(nullif(p_command->>'role_key',''),v_membership_role));
  v_idempotency_key text:=p_command->>'idempotency_key';
  v_company_status text;
  v_current_role text;
  v_current_status text;
  v_actor_membership_role text;
  v_actor_is_platform_admin boolean:=false;
  v_owner_count integer;
  v_admin_count integer;
  v_target_auth_active boolean:=false;
  v_target_profile_active boolean:=false;
  v_existing jsonb;
  v_result jsonb;
  v_event_id uuid;
begin
  if v_company_id is null or v_user_id is null or v_actor_user_id is null
     or nullif(btrim(v_idempotency_key),'') is null then
    raise exception 'company_user_actor_and_idempotency_required';
  end if;
  if v_action not in ('upsert','remove','disable') then raise exception 'invalid_access_action'; end if;
  if v_membership_role not in ('owner','admin','company_admin','member','viewer') then raise exception 'invalid_membership_role'; end if;

  select result_payload into v_existing from public.canonical_command_results
  where company_id=v_company_id and command_type='tenant.user_access.change' and idempotency_key=v_idempotency_key;
  if found then return v_existing; end if;

  select status into v_company_status from public.companies where id=v_company_id for update;
  if not found then raise exception 'tenant_not_found'; end if;
  if v_company_status not in ('onboarding','active','paused') then
    raise exception 'tenant_state_blocks_user_management:%',coalesce(v_company_status,'unknown');
  end if;

  v_actor_is_platform_admin:=public.canonical_actor_is_platform_admin(v_actor_user_id);
  if not v_actor_is_platform_admin then
    select membership_role into v_actor_membership_role
    from public.company_memberships
    where company_id=v_company_id and user_id=v_actor_user_id
      and status='active' and coalesce(is_active,true)
    for update;
    if v_actor_membership_role not in ('owner','admin','company_admin') then
      raise exception 'actor_not_authorized_for_tenant_user_management';
    end if;
  end if;

  select membership_role,status into v_current_role,v_current_status
  from public.company_memberships
  where company_id=v_company_id and user_id=v_user_id
  for update;

  select count(*) into v_owner_count from public.company_memberships
  where company_id=v_company_id and status='active' and coalesce(is_active,true) and membership_role='owner';
  select count(*) into v_admin_count from public.company_memberships
  where company_id=v_company_id and status='active' and coalesce(is_active,true)
    and membership_role in ('owner','admin','company_admin');

  if v_current_status='active' and v_current_role='owner' and v_owner_count<=1
     and (v_action<>'upsert' or v_membership_role<>'owner') then
    raise exception 'last_active_owner_cannot_be_removed_or_downgraded';
  end if;
  if v_current_status='active' and v_current_role in ('owner','admin','company_admin') and v_admin_count<=1
     and (v_action<>'upsert' or v_membership_role not in ('owner','admin','company_admin')) then
    raise exception 'last_active_admin_cannot_be_removed_or_downgraded';
  end if;
  if not v_actor_is_platform_admin and v_membership_role='owner' and v_actor_membership_role<>'owner' then
    raise exception 'only_owner_or_platform_admin_can_assign_owner';
  end if;
  if not v_actor_is_platform_admin and v_current_role='owner' and v_actor_membership_role<>'owner' then
    raise exception 'only_owner_or_platform_admin_can_modify_owner';
  end if;

  if v_action='upsert' then
    select exists(select 1 from auth.users u where u.id=v_user_id and coalesce(u.banned_until,now()-interval '1 second')<=now())
      into v_target_auth_active;
    select exists(select 1 from public.user_profiles up where up.id=v_user_id and up.user_status='active')
      into v_target_profile_active;
    if not v_target_auth_active then raise exception 'target_auth_user_missing_or_inactive'; end if;
    if not v_target_profile_active then raise exception 'target_user_profile_missing_or_inactive'; end if;

    insert into public.company_memberships(
      company_id,user_id,membership_role,status,is_active,invited_by,accepted_at,
      suspended_at,disabled_at,removed_at,metadata
    ) values (
      v_company_id,v_user_id,v_membership_role,'active',true,v_actor_user_id,now(),
      null,null,null,jsonb_build_object('canonical_access_command',v_idempotency_key)
    )
    on conflict(company_id,user_id) do update set
      membership_role=excluded.membership_role,status='active',is_active=true,
      accepted_at=coalesce(public.company_memberships.accepted_at,now()),
      suspended_at=null,disabled_at=null,removed_at=null,
      metadata=coalesce(public.company_memberships.metadata,'{}'::jsonb)||excluded.metadata,
      updated_at=now();

    update public.user_roles set status='disabled',is_active=false,updated_at=now()
    where company_id=v_company_id and user_id=v_user_id and is_active=true;
    insert into public.user_roles(user_id,company_id,role,status,is_active,created_at,updated_at)
    values(v_user_id,v_company_id,v_role_key,'active',true,now(),now());
  else
    update public.company_memberships
      set status=case when v_action='remove' then 'removed' else 'disabled' end,
          is_active=false,
          disabled_at=case when v_action='disable' then now() else disabled_at end,
          removed_at=case when v_action='remove' then now() else removed_at end,
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('canonical_access_command',v_idempotency_key),
          updated_at=now()
      where company_id=v_company_id and user_id=v_user_id;
    update public.user_roles set status='disabled',is_active=false,updated_at=now()
      where company_id=v_company_id and user_id=v_user_id and is_active=true;
  end if;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,idempotency_key,before_state,after_state
  ) values (
    v_company_id,'TENANT_USER_ROLE_CHANGED','tenant_user',v_user_id,v_actor_user_id,
    p_command->>'reason',v_idempotency_key,
    jsonb_build_object('membership_role',v_current_role,'status',v_current_status),
    jsonb_build_object('action',v_action,'membership_role',v_membership_role,'role_key',v_role_key)
  );
  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,idempotency_key,payload,created_by
  ) values (
    v_company_id,'TENANT_USER_ROLE_CHANGED','tenant_user',v_user_id,v_idempotency_key,
    jsonb_build_object('action',v_action,'membership_role',v_membership_role,'role_key',v_role_key),v_actor_user_id
  ) returning id into v_event_id;
  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
  values(v_company_id,v_event_id,'tenant.user.role.changed',v_idempotency_key,
    jsonb_build_object('company_id',v_company_id,'user_id',v_user_id,'action',v_action));

  v_result:=jsonb_build_object('changed',true,'company_id',v_company_id,'user_id',v_user_id,
    'action',v_action,'membership_role',v_membership_role,'role_key',v_role_key);
  insert into public.canonical_command_results(company_id,command_type,idempotency_key,request_payload,result_payload,actor_user_id)
  values(v_company_id,'tenant.user_access.change',v_idempotency_key,p_command,v_result,v_actor_user_id);
  return v_result;
end;
$$;

revoke all on function public.canonical_change_tenant_user_access(jsonb) from public,anon,authenticated;
grant execute on function public.canonical_change_tenant_user_access(jsonb) to service_role;

create or replace function public.guard_tenant_invitation_acceptance()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_status text;
begin
  if new.status='accepted'
     and (tg_op='INSERT' or old.status is distinct from 'accepted') then
    select status into v_status from public.companies where id=new.company_id;
    if v_status not in ('onboarding','active') then
      raise exception 'tenant_state_blocks_invitation_acceptance:%',coalesce(v_status,'unknown');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists company_invitations_tenant_accept_guard on public.company_invitations;
create trigger company_invitations_tenant_accept_guard
before insert or update on public.company_invitations
for each row execute function public.guard_tenant_invitation_acceptance();

commit;
