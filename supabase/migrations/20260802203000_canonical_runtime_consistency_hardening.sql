-- Canonical runtime consistency hardening.
-- Forward-only and additive: atomizes platform access changes, enforces tenant
-- access role mapping, distinguishes uncertain external delivery, and separates
-- AGT/TGT/bilateral active test configuration identities.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- 1. Canonical tenant membership/system-role mapping.
-- ---------------------------------------------------------------------------
create table if not exists public.canonical_tenant_access_role_mapping (
  role_key text primary key,
  membership_role text not null,
  is_assignable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_tenant_access_role_mapping_membership_check
    check (membership_role in ('owner','admin','company_admin','operations','support','member','viewer'))
);

insert into public.canonical_tenant_access_role_mapping(role_key,membership_role,is_assignable)
values
  ('owner','owner',true),
  ('company_admin','company_admin',true),
  ('admin','admin',true),
  ('operations_manager','operations',true),
  ('operations_agent','operations',true),
  ('customer_service_manager','support',true),
  ('customer_service_agent','support',true),
  ('sales_manager','member',true),
  ('pricing_manager','member',true),
  ('pricing_approver','viewer',true),
  ('finance_readonly','viewer',true),
  ('executive_readonly','viewer',true),
  ('compliance_manager','viewer',true),
  ('partner_manager','member',true),
  ('partner_api_user','member',true)
on conflict(role_key) do update set
  membership_role=excluded.membership_role,
  is_assignable=excluded.is_assignable,
  updated_at=now();

alter table public.canonical_tenant_access_role_mapping enable row level security;
alter table public.canonical_tenant_access_role_mapping force row level security;
drop policy if exists canonical_tenant_access_role_mapping_service_role_all
  on public.canonical_tenant_access_role_mapping;
create policy canonical_tenant_access_role_mapping_service_role_all
on public.canonical_tenant_access_role_mapping
for all to service_role
using (true)
with check (true);
revoke all on table public.canonical_tenant_access_role_mapping
  from public, anon, authenticated, service_role;
grant select,insert,update on table public.canonical_tenant_access_role_mapping
  to service_role;

-- The historical UNIQUE(user_id, role_id) is global and prevents one identity
-- from holding the same tenant role in two companies. Replace it with explicit
-- global-role uniqueness; tenant role uniqueness remains company-qualified.
alter table public.user_roles
  drop constraint if exists user_roles_user_id_role_id_key;
create unique index if not exists user_roles_global_user_role_uidx
  on public.user_roles(user_id,role_id)
  where company_id is null and user_id is not null and role_id is not null;
create unique index if not exists user_roles_company_user_role_active_uidx
  on public.user_roles(company_id,user_id,role_id)
  where company_id is not null and user_id is not null and role_id is not null
    and coalesce(status,'active')='active' and coalesce(is_active,true);

-- Wrap the previous canonical access command so membership_role can never be
-- chosen independently of the system role. Historical implementation remains
-- callable only by this new wrapper.
do $rename$
begin
  if to_regprocedure('public.canonical_change_tenant_user_access(jsonb)') is not null
     and to_regprocedure('public.canonical_change_tenant_user_access_v2_unmapped(jsonb)') is null then
    execute 'alter function public.canonical_change_tenant_user_access(jsonb) rename to canonical_change_tenant_user_access_v2_unmapped';
  end if;
end
$rename$;

revoke all on function public.canonical_change_tenant_user_access_v2_unmapped(jsonb)
  from public, anon, authenticated, service_role;

create function public.canonical_change_tenant_user_access(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_action text := lower(coalesce(p_command->>'action',''));
  v_company_id uuid := nullif(p_command->>'company_id','')::uuid;
  v_user_id uuid := nullif(p_command->>'user_id','')::uuid;
  v_role_key text := lower(nullif(btrim(p_command->>'role_key'),''));
  v_requested_membership text := lower(nullif(btrim(p_command->>'membership_role'),''));
  v_membership_role text;
  v_normalized jsonb := p_command;
begin
  if v_action = 'upsert' then
    if v_role_key is null then
      raise exception using errcode='22023', message='canonical_role_key_required';
    end if;

    select m.membership_role
      into v_membership_role
    from public.canonical_tenant_access_role_mapping m
    where m.role_key=v_role_key and m.is_assignable;

    if v_membership_role is null then
      raise exception using errcode='22023', message='canonical_tenant_role_not_assignable';
    end if;

    if v_requested_membership is not null
       and v_requested_membership is distinct from v_membership_role then
      raise exception using errcode='23514', message='membership_role_role_key_mismatch';
    end if;

    v_normalized := v_normalized || jsonb_build_object(
      'role_key',v_role_key,
      'membership_role',v_membership_role
    );
  end if;

  v_normalized := v_normalized || jsonb_build_object('actor_user_id',nullif(p_command->>'actor_user_id',''));

  declare
    v_result jsonb;
    v_role_id uuid;
    v_active_user_role_id uuid;
    v_existing_mapped_role_id uuid;
  begin
    v_result := public.canonical_change_tenant_user_access_v2_unmapped(v_normalized);

    if v_action = 'upsert' and v_company_id is not null and v_user_id is not null then
      select r.id into v_role_id
      from public.roles r
      where lower(coalesce(r.key,r.name))=v_role_key
      order by r.created_at asc,r.id asc
      limit 1;
      if v_role_id is null then
        raise exception using errcode='22023', message='canonical_tenant_role_definition_missing';
      end if;
      select ur.id into v_active_user_role_id
      from public.user_roles ur
      where ur.company_id=v_company_id and ur.user_id=v_user_id
        and coalesce(ur.is_active,true) and coalesce(ur.status,'active')='active'
      order by ur.created_at desc,ur.id desc
      limit 1
      for update;
      if v_active_user_role_id is null then
        raise exception using errcode='P0001', message='canonical_active_tenant_role_missing_after_access_change';
      end if;

      select ur.id into v_existing_mapped_role_id
      from public.user_roles ur
      where ur.company_id=v_company_id and ur.user_id=v_user_id
        and ur.role_id=v_role_id and ur.id<>v_active_user_role_id
      order by ur.created_at asc,ur.id asc
      limit 1
      for update;

      if v_existing_mapped_role_id is null then
        update public.user_roles
        set role=v_role_key,role_id=v_role_id,status='active',is_active=true,updated_at=now()
        where id=v_active_user_role_id;
      else
        update public.user_roles
        set status='disabled',is_active=false,updated_at=now()
        where id=v_active_user_role_id;
        update public.user_roles
        set role=v_role_key,role_id=v_role_id,status='active',is_active=true,updated_at=now()
        where id=v_existing_mapped_role_id;
      end if;
    end if;

    return v_result;
  end;
end
$function$;

revoke all on function public.canonical_change_tenant_user_access(jsonb)
  from public, anon, authenticated;
grant execute on function public.canonical_change_tenant_user_access(jsonb)
  to service_role;

create or replace function public.canonical_accept_tenant_invitation(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id','')::uuid;
  v_user_id uuid := nullif(p_command->>'user_id','')::uuid;
  v_invitation_id uuid := nullif(p_command->>'invitation_id','')::uuid;
  v_idempotency_key text := nullif(btrim(p_command->>'idempotency_key'),'');
  v_invitation public.company_invitations%rowtype;
  v_company_status text;
  v_auth_email text;
  v_profile_active boolean;
  v_role_key text;
  v_membership_role text;
  v_role_id uuid;
  v_existing_user_role_id uuid;
  v_request jsonb := p_command - 'actor_user_id';
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_result jsonb;
  v_event_id uuid;
begin
  if v_actor_user_id is null or v_user_id is null or v_actor_user_id<>v_user_id
     or v_invitation_id is null or v_idempotency_key is null then
    raise exception using errcode='22023', message='verified_user_invitation_and_idempotency_required';
  end if;

  select * into v_invitation
  from public.company_invitations
  where id=v_invitation_id
  for update;
  if not found then
    raise exception using errcode='P0002', message='tenant_invitation_not_found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tenant-invitation:'||v_invitation.company_id::text||':'||v_invitation_id::text,0));
  v_hash := public.canonical_json_sha256(v_request);

  select * into v_existing
  from public.canonical_command_results
  where company_id=v_invitation.company_id
    and command_type='tenant.invitation.accept'
    and idempotency_key=v_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception using errcode='23505', message='IDEMPOTENCY_KEY_REUSE_MISMATCH';
    end if;
    return v_existing.result_payload;
  end if;

  if coalesce(v_invitation.status,'')='accepted'
     and v_invitation.invited_user_id=v_user_id then
    v_result:=jsonb_build_object(
      'changed',false,'already_accepted',true,'company_id',v_invitation.company_id,
      'user_id',v_user_id,'invitation_id',v_invitation_id
    );
    insert into public.canonical_command_results(
      company_id,command_type,idempotency_key,request_hash,request_payload,result_payload,actor_user_id
    ) values(
      v_invitation.company_id,'tenant.invitation.accept',v_idempotency_key,v_hash,v_request,v_result,v_actor_user_id
    );
    return v_result;
  end if;

  if coalesce(v_invitation.status,'')<>'pending' then
    raise exception using errcode='23514', message='tenant_invitation_not_pending';
  end if;
  if v_invitation.expires_at is not null and v_invitation.expires_at<=now() then
    raise exception using errcode='23514', message='tenant_invitation_expired';
  end if;
  if v_invitation.invited_user_id is not null and v_invitation.invited_user_id<>v_user_id then
    raise exception using errcode='42501', message='tenant_invitation_user_mismatch';
  end if;

  select lower(u.email),
         exists(select 1 from public.user_profiles up where up.id=u.id and up.user_status='active')
    into v_auth_email,v_profile_active
  from auth.users u
  where u.id=v_user_id and u.deleted_at is null
    and (u.banned_until is null or u.banned_until<=now());
  if v_auth_email is null or not coalesce(v_profile_active,false) then
    raise exception using errcode='42501', message='target_auth_user_missing_or_inactive';
  end if;
  if v_auth_email<>lower(coalesce(v_invitation.email,v_invitation.invited_email,'')) then
    raise exception using errcode='42501', message='tenant_invitation_email_mismatch';
  end if;

  select status into v_company_status
  from public.companies where id=v_invitation.company_id for update;
  if v_company_status not in ('onboarding','active') then
    raise exception using errcode='23514', message='tenant_state_blocks_invitation_acceptance';
  end if;

  v_role_key:=lower(coalesce(nullif(v_invitation.role_key,''),'customer_service_agent'));
  select m.membership_role into v_membership_role
  from public.canonical_tenant_access_role_mapping m
  where m.role_key=v_role_key and m.is_assignable;
  if v_membership_role is null then
    raise exception using errcode='22023', message='canonical_tenant_role_not_assignable';
  end if;
  if nullif(lower(v_invitation.membership_role),'') is not null
     and lower(v_invitation.membership_role)<>v_membership_role then
    raise exception using errcode='23514', message='invitation_membership_role_role_key_mismatch';
  end if;

  select r.id into v_role_id
  from public.roles r
  where lower(coalesce(r.key,r.name))=v_role_key
  order by r.created_at asc,r.id asc
  limit 1;
  if v_role_id is null then
    raise exception using errcode='22023', message='canonical_tenant_role_definition_missing';
  end if;

  insert into public.company_memberships(
    company_id,user_id,membership_role,role_key,status,is_active,invited_email,
    invited_by,invited_at,accepted_at,disabled_at,removed_at,status_reason,metadata
  ) values(
    v_invitation.company_id,v_user_id,v_membership_role,v_role_key,'active',true,v_auth_email,
    v_invitation.invited_by,coalesce(v_invitation.created_at,now()),now(),null,null,null,
    jsonb_build_object('canonical_invitation_id',v_invitation_id,'canonical_access_command',v_idempotency_key)
  ) on conflict(company_id,user_id) do update set
    membership_role=excluded.membership_role,role_key=excluded.role_key,status='active',is_active=true,
    invited_email=excluded.invited_email,accepted_at=coalesce(public.company_memberships.accepted_at,now()),
    disabled_at=null,removed_at=null,status_reason=null,
    metadata=coalesce(public.company_memberships.metadata,'{}'::jsonb)||excluded.metadata,
    updated_at=now();

  update public.user_roles
  set status='disabled',is_active=false,updated_at=now()
  where company_id=v_invitation.company_id and user_id=v_user_id and coalesce(is_active,true);

  select ur.id into v_existing_user_role_id
  from public.user_roles ur
  where ur.company_id=v_invitation.company_id and ur.user_id=v_user_id and ur.role_id=v_role_id
  order by ur.created_at asc,ur.id asc
  limit 1
  for update;
  if v_existing_user_role_id is null then
    insert into public.user_roles(user_id,company_id,role,role_id,status,is_active,created_at,updated_at)
    values(v_user_id,v_invitation.company_id,v_role_key,v_role_id,'active',true,now(),now());
  else
    update public.user_roles
    set role=v_role_key,role_id=v_role_id,status='active',is_active=true,updated_at=now()
    where id=v_existing_user_role_id;
  end if;

  update public.company_invitations
  set status='accepted',accepted_at=now(),invited_user_id=v_user_id,
      membership_role=v_membership_role,role_key=v_role_key,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'access_source','canonical_verified_auth_invitation','accepted_by_verified_user',true
      ),updated_at=now()
  where id=v_invitation_id;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,idempotency_key,before_state,after_state
  ) values(
    v_invitation.company_id,'TENANT_INVITATION_ACCEPTED','tenant_user',v_user_id,v_actor_user_id,
    'Verified tenant invitation accepted',v_idempotency_key,
    jsonb_build_object('invitation_id',v_invitation_id,'status',v_invitation.status),
    jsonb_build_object('membership_role',v_membership_role,'role_key',v_role_key,'status','active')
  );
  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,idempotency_key,payload,created_by
  ) values(
    v_invitation.company_id,'TENANT_INVITATION_ACCEPTED','tenant_user',v_user_id,v_idempotency_key,
    jsonb_build_object('invitation_id',v_invitation_id,'membership_role',v_membership_role,'role_key',v_role_key),v_actor_user_id
  ) returning id into v_event_id;
  insert into public.canonical_event_outbox(company_id,domain_event_id,topic,idempotency_key,payload)
  values(
    v_invitation.company_id,v_event_id,'tenant.invitation.accepted',v_idempotency_key,
    jsonb_build_object('company_id',v_invitation.company_id,'user_id',v_user_id,'invitation_id',v_invitation_id)
  );

  v_result:=jsonb_build_object(
    'changed',true,'already_accepted',false,'company_id',v_invitation.company_id,
    'user_id',v_user_id,'invitation_id',v_invitation_id,
    'membership_role',v_membership_role,'role_key',v_role_key
  );
  insert into public.canonical_command_results(
    company_id,command_type,idempotency_key,request_hash,request_payload,result_payload,actor_user_id
  ) values(
    v_invitation.company_id,'tenant.invitation.accept',v_idempotency_key,v_hash,v_request,v_result,v_actor_user_id
  );
  return v_result;
end
$function$;

revoke all on function public.canonical_accept_tenant_invitation(jsonb)
  from public, anon, authenticated;
grant execute on function public.canonical_accept_tenant_invitation(jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Global platform role scope and atomic platform access commands.
-- ---------------------------------------------------------------------------
create or replace function public.canonical_actor_is_platform_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $function$
  select p_user_id is not null
    and exists (
      select 1
      from auth.users u
      join public.user_profiles up on up.id=u.id
      where u.id=p_user_id
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until <= now())
        and up.user_status='active'
    )
    and (
      exists (
        select 1
        from public.admin_users au
        where au.user_id=p_user_id
          and coalesce(au.is_active,true)
          and public.gridex_normalize_platform_role(au.role)
            in ('super_admin','platform_admin')
      )
      or exists (
        select 1
        from public.user_roles ur
        left join public.roles r on r.id=ur.role_id
        where ur.user_id=p_user_id
          and ur.company_id is null
          and coalesce(ur.is_active,true)
          and coalesce(ur.status,'active')='active'
          and public.gridex_normalize_platform_role(coalesce(ur.role,r.key,r.name))
            in ('super_admin','platform_admin')
      )
    )
$function$;
revoke all on function public.canonical_actor_is_platform_admin(uuid)
  from public, anon, authenticated;
grant execute on function public.canonical_actor_is_platform_admin(uuid)
  to service_role;

create table if not exists public.canonical_platform_access_command_results (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete cascade,
  command_type text not null,
  idempotency_key text not null,
  request_hash text not null,
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb not null default '{}'::jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint canonical_platform_access_command_results_key
    unique(target_user_id,command_type,idempotency_key)
);

create table if not exists public.canonical_platform_access_audit_events (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  idempotency_key text not null,
  reason text,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint canonical_platform_access_audit_events_key
    unique(target_user_id,event_type,idempotency_key)
);

alter table public.canonical_platform_access_command_results enable row level security;
alter table public.canonical_platform_access_command_results force row level security;
alter table public.canonical_platform_access_audit_events enable row level security;
alter table public.canonical_platform_access_audit_events force row level security;

revoke all on table
  public.canonical_platform_access_command_results,
  public.canonical_platform_access_audit_events
from public, anon, authenticated, service_role;
grant select,insert,update on table public.canonical_platform_access_command_results to service_role;
grant select,insert on table public.canonical_platform_access_audit_events to service_role;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'canonical_platform_access_command_results',
    'canonical_platform_access_audit_events'
  ] loop
    execute format('drop policy if exists %I on public.%I',v_table||'_service_role_all',v_table);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      v_table||'_service_role_all',v_table
    );
  end loop;
end $$;

create or replace function public.canonical_manage_platform_user_access(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id','')::uuid;
  v_target_user_id uuid := nullif(p_command->>'target_user_id','')::uuid;
  v_action text := lower(coalesce(p_command->>'action',''));
  v_role_id uuid := nullif(p_command->>'role_id','')::uuid;
  v_user_role_id uuid := nullif(p_command->>'user_role_id','')::uuid;
  v_permission_key text := nullif(btrim(p_command->>'permission_key'),'');
  v_effect text := lower(coalesce(nullif(btrim(p_command->>'effect'),''),'allow'));
  v_reason text := nullif(btrim(p_command->>'reason'),'');
  v_preserve_overrides boolean := coalesce((p_command->>'preserve_overrides')::boolean,false);
  v_idempotency_key text := nullif(btrim(p_command->>'idempotency_key'),'');
  v_request jsonb := p_command - 'actor_user_id';
  v_hash text;
  v_existing public.canonical_platform_access_command_results%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_missing_permissions text[];
  v_overlap text[];
  v_allow text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p_command->'allow_permissions','[]'::jsonb))),array[]::text[]);
  v_deny text[] := coalesce(array(select jsonb_array_elements_text(coalesce(p_command->'deny_permissions','[]'::jsonb))),array[]::text[]);
  v_existing_role_id uuid;
begin
  if v_actor_user_id is null or v_target_user_id is null or v_idempotency_key is null then
    raise exception using errcode='22023', message='actor_target_and_idempotency_required';
  end if;
  if not public.canonical_actor_is_platform_admin(v_actor_user_id) then
    raise exception using errcode='42501', message='platform_admin_required';
  end if;
  if not exists(select 1 from auth.users where id=v_target_user_id and deleted_at is null) then
    raise exception using errcode='P0002', message='target_auth_user_not_found';
  end if;
  if v_action not in (
    'set_primary_role','add_role','remove_role','replace_overrides',
    'clear_overrides','upsert_override','remove_override','disable_platform_access'
  ) then
    raise exception using errcode='22023', message='invalid_platform_access_action';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('platform-access:'||v_target_user_id::text,0));
  v_hash := public.canonical_json_sha256(v_request);

  select * into v_existing
  from public.canonical_platform_access_command_results
  where target_user_id=v_target_user_id
    and command_type='platform.user_access.'||v_action
    and idempotency_key=v_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception using errcode='23505', message='IDEMPOTENCY_KEY_REUSE_MISMATCH';
    end if;
    return v_existing.result_payload;
  end if;

  select jsonb_build_object(
    'roles',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',ur.id,'role_id',ur.role_id,'role',ur.role,
        'status',ur.status,'is_active',ur.is_active
      ) order by ur.created_at,ur.id)
      from public.user_roles ur
      where ur.user_id=v_target_user_id and ur.company_id is null
    ),'[]'::jsonb),
    'overrides',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',upo.id,'permission_key',upo.permission_key,'effect',upo.effect,
        'reason',upo.reason,'is_active',upo.is_active
      ) order by upo.permission_key,upo.id)
      from public.user_permission_overrides upo
      where upo.user_id=v_target_user_id and upo.company_id is null
    ),'[]'::jsonb)
  ) into v_before;

  if v_action in ('set_primary_role','add_role') then
    if v_role_id is null or not exists(select 1 from public.roles where id=v_role_id) then
      raise exception using errcode='22023', message='platform_role_not_found';
    end if;
  end if;

  if v_action='set_primary_role' then
    update public.user_roles
    set status='disabled',is_active=false,updated_at=now()
    where user_id=v_target_user_id and company_id is null and coalesce(is_active,true);

    select id into v_existing_role_id
    from public.user_roles
    where user_id=v_target_user_id and company_id is null and role_id=v_role_id
    order by created_at asc,id asc
    limit 1
    for update;

    if v_existing_role_id is null then
      insert into public.user_roles(user_id,company_id,role_id,status,is_active,created_at,updated_at)
      values(v_target_user_id,null,v_role_id,'active',true,now(),now());
    else
      update public.user_roles
      set status='active',is_active=true,updated_at=now()
      where id=v_existing_role_id;
    end if;

    if not v_preserve_overrides then
      delete from public.user_permission_overrides
      where user_id=v_target_user_id and company_id is null;
    end if;

  elsif v_action='add_role' then
    select id into v_existing_role_id
    from public.user_roles
    where user_id=v_target_user_id and company_id is null and role_id=v_role_id
    order by created_at asc,id asc
    limit 1
    for update;
    if v_existing_role_id is null then
      insert into public.user_roles(user_id,company_id,role_id,status,is_active,created_at,updated_at)
      values(v_target_user_id,null,v_role_id,'active',true,now(),now());
    else
      update public.user_roles set status='active',is_active=true,updated_at=now()
      where id=v_existing_role_id;
    end if;

  elsif v_action='remove_role' then
    if v_user_role_id is not null then
      update public.user_roles set status='disabled',is_active=false,updated_at=now()
      where id=v_user_role_id and user_id=v_target_user_id and company_id is null;
    elsif v_role_id is not null then
      update public.user_roles set status='disabled',is_active=false,updated_at=now()
      where user_id=v_target_user_id and company_id is null and role_id=v_role_id;
    else
      raise exception using errcode='22023', message='role_identifier_required';
    end if;

  elsif v_action='replace_overrides' then
    select array_agg(value) into v_overlap
    from (
      select unnest(v_allow) value
      intersect
      select unnest(v_deny) value
    ) q;
    if coalesce(array_length(v_overlap,1),0)>0 then
      raise exception using errcode='23514', message='permission_allow_deny_overlap';
    end if;

    select array_agg(requested.permission_key order by requested.permission_key)
      into v_missing_permissions
    from (
      select distinct unnest(v_allow||v_deny) permission_key
    ) requested
    left join public.permissions p on p.key=requested.permission_key
    where p.id is null;
    if coalesce(array_length(v_missing_permissions,1),0)>0 then
      raise exception using errcode='22023', message='permission_not_found';
    end if;

    delete from public.user_permission_overrides
    where user_id=v_target_user_id and company_id is null;

    insert into public.user_permission_overrides(
      company_id,user_id,permission_key,effect,reason,is_active,created_by,updated_by,created_at,updated_at
    )
    select null,v_target_user_id,permission_key,'allow',v_reason,true,v_actor_user_id,v_actor_user_id,now(),now()
    from unnest(v_allow) permission_key
    union all
    select null,v_target_user_id,permission_key,'deny',v_reason,true,v_actor_user_id,v_actor_user_id,now(),now()
    from unnest(v_deny) permission_key;

  elsif v_action='clear_overrides' then
    delete from public.user_permission_overrides
    where user_id=v_target_user_id and company_id is null;

  elsif v_action='upsert_override' then
    if v_permission_key is null or v_effect not in ('allow','deny') then
      raise exception using errcode='22023', message='permission_key_and_valid_effect_required';
    end if;
    if not exists(select 1 from public.permissions where key=v_permission_key) then
      raise exception using errcode='22023', message='permission_not_found';
    end if;
    delete from public.user_permission_overrides
    where user_id=v_target_user_id and company_id is null and permission_key=v_permission_key;
    insert into public.user_permission_overrides(
      company_id,user_id,permission_key,effect,reason,is_active,created_by,updated_by,created_at,updated_at
    ) values(
      null,v_target_user_id,v_permission_key,v_effect,v_reason,true,v_actor_user_id,v_actor_user_id,now(),now()
    );

  elsif v_action='remove_override' then
    if v_permission_key is null then
      raise exception using errcode='22023', message='permission_key_required';
    end if;
    delete from public.user_permission_overrides
    where user_id=v_target_user_id and company_id is null and permission_key=v_permission_key;

  elsif v_action='disable_platform_access' then
    update public.user_roles
    set status='disabled',is_active=false,updated_at=now()
    where user_id=v_target_user_id and company_id is null and coalesce(is_active,true);
    delete from public.user_permission_overrides
    where user_id=v_target_user_id and company_id is null;
  end if;

  select jsonb_build_object(
    'roles',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',ur.id,'role_id',ur.role_id,'role',ur.role,
        'status',ur.status,'is_active',ur.is_active
      ) order by ur.created_at,ur.id)
      from public.user_roles ur
      where ur.user_id=v_target_user_id and ur.company_id is null
    ),'[]'::jsonb),
    'overrides',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',upo.id,'permission_key',upo.permission_key,'effect',upo.effect,
        'reason',upo.reason,'is_active',upo.is_active
      ) order by upo.permission_key,upo.id)
      from public.user_permission_overrides upo
      where upo.user_id=v_target_user_id and upo.company_id is null
    ),'[]'::jsonb)
  ) into v_after;

  v_result := jsonb_build_object(
    'changed',v_before is distinct from v_after,
    'target_user_id',v_target_user_id,
    'action',v_action,
    'state',v_after
  );

  insert into public.canonical_platform_access_audit_events(
    target_user_id,event_type,actor_user_id,idempotency_key,reason,before_state,after_state
  ) values(
    v_target_user_id,'PLATFORM_USER_ACCESS_CHANGED',v_actor_user_id,v_idempotency_key,v_reason,v_before,v_after
  );

  insert into public.canonical_platform_access_command_results(
    target_user_id,command_type,idempotency_key,request_hash,request_payload,result_payload,actor_user_id
  ) values(
    v_target_user_id,'platform.user_access.'||v_action,v_idempotency_key,v_hash,v_request,v_result,v_actor_user_id
  );

  return v_result;
end
$function$;

revoke all on function public.canonical_manage_platform_user_access(jsonb)
  from public, anon, authenticated;
grant execute on function public.canonical_manage_platform_user_access(jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. External delivery uncertainty must never be retried automatically.
-- ---------------------------------------------------------------------------
alter table public.manual_email_outbox
  add column if not exists blocked_reason text,
  add column if not exists blocked_at timestamptz,
  add column if not exists company_status_snapshot text,
  add column if not exists operation_decision_snapshot jsonb;

alter table public.manual_email_outbox
  drop constraint if exists manual_email_outbox_status_check;
alter table public.manual_email_outbox
  add constraint manual_email_outbox_status_check
  check(status in (
    'queued','sending','sent','failed','delivery_uncertain','blocked_tenant_state'
  ));

create index if not exists manual_email_outbox_blocked_idx
  on public.manual_email_outbox(company_id,blocked_at,id)
  where status='blocked_tenant_state';

alter table public.ediel_outbox
  add column if not exists operation_decision_snapshot jsonb;

alter table public.webhook_deliveries
  add column if not exists delivery_uncertain_at timestamptz,
  add column if not exists public_delivery_id text,
  add column if not exists request_body_hash text,
  add column if not exists operation_decision_snapshot jsonb;

alter table public.webhook_deliveries
  drop constraint if exists webhook_deliveries_status_check;
alter table public.webhook_deliveries
  add constraint webhook_deliveries_status_check
  check(status in (
    'queued','processing','sent','failed','dead_letter','skipped',
    'blocked_tenant_state','delivery_uncertain'
  ));

update public.webhook_deliveries
set status='delivery_uncertain',
    delivery_uncertain_at=coalesce(delivery_uncertain_at,now()),
    failure_reason=coalesce(failure_reason,'delivery_uncertain_after_stale_processing_lock'),
    next_attempt_at=now(),
    locked_at=null,
    locked_by=null,
    updated_at=now()
where status='processing'
  and locked_at < now()-interval '15 minutes';

create index if not exists webhook_deliveries_uncertain_idx
  on public.webhook_deliveries(company_id,delivery_uncertain_at,id)
  where status='delivery_uncertain';

-- ---------------------------------------------------------------------------
-- 4. Active test configuration identity includes AGT/TGT/bilateral mode.
-- ---------------------------------------------------------------------------
alter table public.ediel_active_test_configurations
  add column if not exists environment_type public.ediel_environment_type;

update public.ediel_active_test_configurations
set environment_type='production'::public.ediel_environment_type,
    updated_at=now()
where environment='production' and environment_type is null;

alter table public.ediel_active_test_configurations
  drop constraint if exists ediel_active_test_configurations_active_environment_type_required;
alter table public.ediel_active_test_configurations
  add constraint ediel_active_test_configurations_active_environment_type_required
  check(status<>'active' or environment_type is not null) not valid;

-- There were no active rows in the verified baseline. Validation deliberately
-- fails if another environment has introduced an ambiguous active row.
alter table public.ediel_active_test_configurations
  validate constraint ediel_active_test_configurations_active_environment_type_required;

drop index if exists public.ediel_active_test_configurations_active_key;
create unique index ediel_active_test_configurations_active_key
  on public.ediel_active_test_configurations(
    company_id,environment,environment_type,test_suite,actor_role,message_family,setup_package
  ) where status='active';

-- Remove false Ediel-test readiness where no complete active configuration is
-- present. The capability remains disabled until canonical configuration exists.
update public.company_capabilities cc
set enabled=false,
    readiness_status='blocked',
    blockers=array['active_canonical_test_configuration_missing']::text[],
    updated_at=now()
where cc.capability_code='ediel_test'
  and not exists(
    select 1
    from public.ediel_active_test_configurations c
    where c.company_id=cc.company_id
      and c.status='active'
      and c.environment_type is not null
      and c.configuration_snapshot_id is not null
  );

-- Internal worker command for releasing a claimed Ediel outbox row into a
-- tenant-blocked state. Claim modules must not perform direct state updates.
create or replace function public.canonical_block_claimed_ediel_outbox_item(
  p_outbox_item_id uuid,
  p_worker_id text,
  p_reason text,
  p_company_status text default null,
  p_operation_decision jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_changed integer;
begin
  if p_outbox_item_id is null or nullif(btrim(p_worker_id),'') is null
     or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023', message='outbox_item_worker_and_reason_required';
  end if;

  update public.ediel_outbox
  set status='blocked_tenant_state',
      blocked_reason=p_reason,
      blocked_at=now(),
      company_status_snapshot=p_company_status,
      operation_decision_snapshot=coalesce(p_operation_decision,'{}'::jsonb),
      locked_at=null,
      locked_by=null,
      updated_at=now()
  where id=p_outbox_item_id
    and locked_by=p_worker_id
    and status='sending';
  get diagnostics v_changed = row_count;
  if v_changed <> 1 then
    raise exception using errcode='P0001', message='ediel_outbox_claim_block_lock_lost';
  end if;
  return 'blocked_tenant_state';
end
$function$;

revoke all on function public.canonical_block_claimed_ediel_outbox_item(uuid,text,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.canonical_block_claimed_ediel_outbox_item(uuid,text,text,text,jsonb)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. Canonical non-authoritative actor-test projection and pass guards.
-- ---------------------------------------------------------------------------
alter table public.ediel_test_runs
  drop constraint if exists ediel_test_runs_status_check;
alter table public.ediel_test_runs
  add constraint ediel_test_runs_status_check
  check(status in ('draft','running','completed','passed','failed','cancelled'));

create or replace function public.canonical_project_actor_test_result_state(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $function$
declare
  v_actor_user_id uuid := nullif(p_command->>'actor_user_id','')::uuid;
  v_company_id uuid := nullif(p_command->>'company_id','')::uuid;
  v_run_id uuid := nullif(p_command->>'test_run_id','')::uuid;
  v_test_case_code text := upper(nullif(btrim(p_command->>'test_case_code'),''));
  v_status text := lower(nullif(btrim(p_command->>'status'),''));
  v_idempotency_key text := nullif(btrim(p_command->>'idempotency_key'),'');
  v_request jsonb := p_command - 'actor_user_id';
  v_hash text;
  v_existing public.canonical_command_results%rowtype;
  v_result jsonb;
  v_event_id uuid;
begin
  if v_actor_user_id is null or v_company_id is null
     or v_test_case_code is null or v_idempotency_key is null then
    raise exception using errcode='22023', message='actor_company_case_and_idempotency_required';
  end if;
  if v_status not in ('running','failed','blocked') then
    raise exception using errcode='23514', message='authoritative_actor_test_status_requires_evidence_or_attestation';
  end if;
  if not public.gridex_actor_has_company_permission(
    v_actor_user_id,v_company_id,'ediel_testing.write'
  ) then
    raise exception using errcode='42501', message='ediel_testing_write_permission_denied';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('actor-test-projection:'||v_company_id::text||':'||v_test_case_code,0)
  );
  v_hash := public.canonical_json_sha256(v_request);

  select * into v_existing
  from public.canonical_command_results
  where company_id=v_company_id
    and command_type='ediel.test.projection.'||v_status
    and idempotency_key=v_idempotency_key;
  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception using errcode='23505', message='IDEMPOTENCY_KEY_REUSE_MISMATCH';
    end if;
    return v_existing.result_payload;
  end if;

  if v_run_id is not null and not exists(
    select 1 from public.ediel_test_runs r
    where r.id=v_run_id and r.company_id=v_company_id
  ) then
    raise exception using errcode='23503', message='tenant_scoped_test_run_not_found';
  end if;

  insert into public.actor_test_results(
    company_id,test_key,test_name,test_id,package_key,message_family,message_code,direction,
    status,latest_run_at,passed_at,failure_reason,portal_status,raw_payload,
    ediel_test_run_id,evidence,is_stale,stale_reason,created_by,updated_by,created_at,updated_at
  ) values(
    v_company_id,v_test_case_code,nullif(p_command->>'test_name',''),nullif(p_command->>'test_id',''),
    nullif(p_command->>'package_key',''),nullif(p_command->>'message_family',''),
    nullif(p_command->>'message_code',''),nullif(p_command->>'direction',''),
    v_status,now(),null,nullif(p_command->>'failure_reason',''),nullif(p_command->>'portal_status',''),
    nullif(p_command->>'raw_payload',''),v_run_id,coalesce(p_command->'evidence','{}'::jsonb),
    false,null,v_actor_user_id,v_actor_user_id,now(),now()
  ) on conflict(company_id,test_key) do update set
    test_name=coalesce(excluded.test_name,public.actor_test_results.test_name),
    test_id=coalesce(excluded.test_id,public.actor_test_results.test_id),
    package_key=coalesce(excluded.package_key,public.actor_test_results.package_key),
    message_family=coalesce(excluded.message_family,public.actor_test_results.message_family),
    message_code=coalesce(excluded.message_code,public.actor_test_results.message_code),
    direction=coalesce(excluded.direction,public.actor_test_results.direction),
    status=excluded.status,latest_run_at=excluded.latest_run_at,passed_at=null,
    failure_reason=excluded.failure_reason,portal_status=excluded.portal_status,
    raw_payload=excluded.raw_payload,
    ediel_test_run_id=coalesce(excluded.ediel_test_run_id,public.actor_test_results.ediel_test_run_id),
    evidence=excluded.evidence,is_stale=false,stale_reason=null,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  if v_run_id is not null then
    update public.ediel_test_runs
    set status=case when v_status='running' then 'running' else 'failed' end,
        failure_reason=nullif(p_command->>'failure_reason',''),
        completed_at=case when v_status='running' then null else now() end,
        updated_by=v_actor_user_id,updated_at=now()
    where id=v_run_id and company_id=v_company_id;
  end if;

  insert into public.canonical_audit_events(
    company_id,event_type,aggregate_type,aggregate_id,actor_user_id,reason,
    idempotency_key,after_state,metadata
  ) values(
    v_company_id,'EDIEL_TEST_PROJECTION_UPDATED','actor_test_result',
    coalesce(v_run_id,v_company_id),v_actor_user_id,
    coalesce(nullif(p_command->>'failure_reason',''),'Non-authoritative actor-test projection updated'),
    v_idempotency_key,jsonb_build_object(
      'test_case_code',v_test_case_code,'status',v_status,'test_run_id',v_run_id
    ),coalesce(p_command->'evidence','{}'::jsonb)
  );
  insert into public.canonical_domain_events(
    company_id,event_type,aggregate_type,aggregate_id,idempotency_key,payload,created_by
  ) values(
    v_company_id,'EDIEL_TEST_PROJECTION_UPDATED','actor_test_result',
    coalesce(v_run_id,v_company_id),v_idempotency_key,
    jsonb_build_object('test_case_code',v_test_case_code,'status',v_status,'test_run_id',v_run_id),
    v_actor_user_id
  ) returning id into v_event_id;
  insert into public.canonical_event_outbox(
    company_id,domain_event_id,topic,idempotency_key,payload
  ) values(
    v_company_id,v_event_id,'ediel.test.projection.updated',v_idempotency_key,
    jsonb_build_object('test_case_code',v_test_case_code,'status',v_status,'test_run_id',v_run_id)
  );

  v_result:=jsonb_build_object(
    'changed',true,'company_id',v_company_id,'test_case_code',v_test_case_code,
    'status',v_status,'test_run_id',v_run_id
  );
  insert into public.canonical_command_results(
    company_id,command_type,idempotency_key,request_hash,request_payload,result_payload,actor_user_id
  ) values(
    v_company_id,'ediel.test.projection.'||v_status,v_idempotency_key,v_hash,v_request,v_result,v_actor_user_id
  );
  return v_result;
end
$function$;

revoke all on function public.canonical_project_actor_test_result_state(jsonb)
  from public, anon, authenticated;
grant execute on function public.canonical_project_actor_test_result_state(jsonb)
  to service_role;

create or replace function public.canonical_guard_ediel_test_run_authoritative_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.status='passed' and old.status is distinct from 'passed' then
    if not exists(
      select 1
      from public.actor_test_attempts a
      where a.company_id=new.company_id
        and a.test_run_id=new.id
        and a.status='passed'
        and a.machine_verified
        and a.configuration_snapshot_id=new.configuration_snapshot_id
        and a.configuration_hash=new.configuration_hash
        and upper(a.test_case_code)=upper(new.test_case_code)
    ) then
      raise exception using errcode='23514', message='direct_test_run_pass_forbidden_without_canonical_attempt';
    end if;
  end if;
  return new;
end
$function$;

revoke all on function public.canonical_guard_ediel_test_run_authoritative_status()
  from public, anon, authenticated;

drop trigger if exists canonical_ediel_test_run_authoritative_status_guard
  on public.ediel_test_runs;
create trigger canonical_ediel_test_run_authoritative_status_guard
before update of status on public.ediel_test_runs
for each row execute function public.canonical_guard_ediel_test_run_authoritative_status();

create or replace function public.canonical_guard_actor_test_result_authoritative_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_authoritative_status_changed boolean;
begin
  if tg_op='INSERT' then
    v_authoritative_status_changed:=new.status in ('passed','manual_verified');
  else
    v_authoritative_status_changed:=new.status in ('passed','manual_verified')
      and old.status is distinct from new.status;
  end if;

  if v_authoritative_status_changed then
    if new.ediel_test_run_id is null or not exists(
      select 1
      from public.actor_test_attempts a
      where a.company_id=new.company_id
        and a.test_run_id=new.ediel_test_run_id
        and upper(a.test_case_code)=upper(new.test_key)
        and (
          (new.status='passed' and a.status='passed' and a.machine_verified)
          or (new.status='manual_verified' and a.status='manual_verified')
        )
        and a.configuration_snapshot_id=new.configuration_snapshot_id
        and a.configuration_hash=new.configuration_hash
    ) then
      raise exception using errcode='23514', message='authoritative_actor_test_result_requires_canonical_attempt';
    end if;
  end if;
  return new;
end
$function$;

revoke all on function public.canonical_guard_actor_test_result_authoritative_status()
  from public, anon, authenticated;

drop trigger if exists canonical_actor_test_result_authoritative_status_guard
  on public.actor_test_results;
create trigger canonical_actor_test_result_authoritative_status_guard
before insert or update of status on public.actor_test_results
for each row execute function public.canonical_guard_actor_test_result_authoritative_status();

revoke insert,update,delete,truncate on public.actor_test_results
  from anon, authenticated;
revoke update on public.ediel_test_runs from anon, authenticated;

-- Internal self-tests are technical simulations, not actor-certification evidence.
-- Existing direct 'passed' rows remain historical, but future writes must use
-- completed/failed for self-tests or the canonical evidence path for actor tests.

-- ---------------------------------------------------------------------------
-- 6. Transactional postconditions.
-- ---------------------------------------------------------------------------
do $verify$
begin
  if exists(
    select 1
    from pg_constraint c
    join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='user_roles'
      and c.conname='user_roles_user_id_role_id_key'
  ) then
    raise exception 'global_user_role_uniqueness_still_blocks_multitenant_assignments';
  end if;

  if exists(
    select 1
    from public.user_roles ur
    left join public.roles r on r.id=ur.role_id
    where ur.company_id is not null
      and public.gridex_normalize_platform_role(coalesce(ur.role,r.key,r.name))
        in ('super_admin','platform_admin')
      and coalesce(ur.is_active,true)
      and coalesce(ur.status,'active')='active'
  ) then
    raise exception 'active_tenant_bound_global_platform_role_exists';
  end if;

  if has_function_privilege('anon','public.canonical_manage_platform_user_access(jsonb)','EXECUTE')
     or has_function_privilege('authenticated','public.canonical_manage_platform_user_access(jsonb)','EXECUTE') then
    raise exception 'canonical_platform_access_rpc_exposed';
  end if;

  if exists(
    select 1 from public.ediel_active_test_configurations
    where status='active' and environment_type is null
  ) then
    raise exception 'active_test_configuration_environment_type_missing';
  end if;
end
$verify$;

comment on function public.canonical_manage_platform_user_access(jsonb)
is 'Atomic service-only platform-role and permission override command with actor validation, idempotency, and immutable audit.';
comment on table public.canonical_tenant_access_role_mapping
is 'Canonical mapping from tenant system role to the only allowed membership role.';
comment on column public.webhook_deliveries.delivery_uncertain_at
is 'Timestamp when an external webhook may have been accepted but local terminal persistence could not be proven. Such rows are never automatically retried.';

commit;
