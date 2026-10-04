-- Independent staff API: provider credentials remain encrypted in OPS.
begin;

create table public.staff_api_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  api_client_id uuid not null references public.integration_api_clients(id) on delete cascade,
  native_session_id uuid not null,
  encrypted_payload text not null,
  refresh_hash text not null unique check (length(refresh_hash)=64),
  previous_refresh_hash text,
  revision bigint not null default 1 check (revision>0),
  stage text not null check (stage in ('authenticated','mfa_required','password_change_required')),
  native_aal text not null check (native_aal in ('aal1','aal2')),
  status text not null default 'active' check (status in ('active','revoked','blocked')),
  expires_at timestamptz not null,
  lease_id uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index staff_api_sessions_previous_refresh on public.staff_api_sessions(previous_refresh_hash) where previous_refresh_hash is not null;
create index staff_api_sessions_user on public.staff_api_sessions(user_id,company_id,api_client_id);
create index staff_api_sessions_expiry on public.staff_api_sessions(expires_at,id);
create table public.staff_api_session_operations (
  session_id uuid not null references public.staff_api_sessions(id) on delete cascade,
  operation_key text not null check (length(operation_key) between 16 and 128),
  command text not null,
  request_hash text not null check (length(request_hash)=64),
  status text not null check (status in ('pending','completed','blocked')),
  lease_id uuid not null,
  encrypted_receipt text,
  completed_revision bigint,
  created_at timestamptz not null default now(),
  primary key(session_id,operation_key)
);
create index staff_api_session_validation_retention on public.staff_api_session_operations(created_at,session_id) where command='validate' and status='completed';
create table public.staff_api_auth_budgets (
  budget_key text primary key,
  window_start timestamptz not null,
  attempts integer not null check(attempts>0)
);
alter table public.staff_api_sessions enable row level security;
alter table public.staff_api_session_operations enable row level security;
alter table public.staff_api_auth_budgets enable row level security;
revoke all on public.staff_api_sessions,public.staff_api_session_operations,public.staff_api_auth_budgets from public,anon,authenticated;
grant select,insert,update,delete on public.staff_api_sessions,public.staff_api_session_operations,public.staff_api_auth_budgets to service_role;

-- Whole-row self UPDATE RLS cannot protect authentication-policy columns.
create function public.staff_api_protect_account_policy() returns trigger language plpgsql
set search_path=pg_catalog,public,auth,pg_temp as $$
declare k text;
begin
  -- Authorized SECURITY DEFINER account commands and service-role writes retain
  -- their existing authority; direct Data API self updates do not gain it.
  if auth.role()='authenticated' and current_user='authenticated' then
    foreach k in array array['must_change_password','password_changed_at','temporary_password_set_at','temporary_password_expires_at','temporary_password_set_by','temporary_password_company_id','temporary_password_company_name','user_status','disabled_at','disabled_by','disabled_reason'] loop
      if (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k) then
        raise exception using errcode='42501',message='Account authentication policy is server managed';
      end if;
    end loop;
  end if;
  return new;
end $$;

create function public.staff_api_cleanup(p_limit integer default 200)
returns void language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
begin
  if p_limit not between 1 and 500 then raise exception 'Invalid cleanup limit'; end if;
  delete from public.staff_api_sessions where id in(select id from public.staff_api_sessions where expires_at<=now() order by expires_at,id limit p_limit for update skip locked);
  delete from public.staff_api_session_operations where (session_id,operation_key) in(select session_id,operation_key from public.staff_api_session_operations where command='validate' and status='completed' and created_at<now()-interval '10 minutes' order by created_at limit p_limit for update skip locked);
  delete from public.staff_api_auth_budgets where budget_key in(select budget_key from public.staff_api_auth_budgets where window_start<now()-interval '1 hour' order by window_start limit p_limit for update skip locked);
end $$;
create trigger staff_api_protected_account_policy before update on public.user_profiles for each row execute function public.staff_api_protect_account_policy();
revoke all on function public.staff_api_protect_account_policy() from public,anon,authenticated;

create function public.staff_api_is_tenant_staff(p_user_id uuid,p_company_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public,auth,pg_temp as $$
  select exists(select 1 from public.company_memberships m where m.user_id=p_user_id and m.company_id=p_company_id and m.status='active' and coalesce(m.is_active,true))
    and exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
      where ur.user_id=p_user_id and ur.company_id=p_company_id and coalesce(ur.is_active,true) and coalesce(ur.status,'active')='active'
        and coalesce(r.is_active,true) and lower(coalesce(r.key,r.name,'')) not in ('','customer','kund')
        and ((to_jsonb(ur)->>'expires_at') is null or (to_jsonb(ur)->>'expires_at')::timestamptz>clock_timestamp()));
$$;

-- Preserve the native positive-grant/company semantics; a disabled definition
-- is unavailable to this new API even when a historic grant still refers to it.
create function public.staff_api_current_permissions(p_user_id uuid,p_company_id uuid)
returns text[] language sql stable security definer set search_path=pg_catalog,public,auth,pg_temp as $$
  select coalesce(array_agg(distinct coalesce(p.key,p.name) order by coalesce(p.key,p.name)), '{}'::text[])
  from public.permissions p where coalesce(p.is_active,true)
    and coalesce(p.key,p.name)=any(public.gridex_get_user_permissions_in_company(p_user_id,p_company_id))
    and (
      exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id join public.role_permissions rp on rp.role_id=r.id
        where ur.user_id=p_user_id and rp.permission_id=p.id and coalesce(r.is_active,true) and coalesce(ur.is_active,true) and coalesce(ur.status,'active')='active' and coalesce(rp.effect,'allow')='allow'
          and ((to_jsonb(ur)->>'expires_at') is null or (to_jsonb(ur)->>'expires_at')::timestamptz>clock_timestamp())
          and ((ur.company_id is null and public.gridex_normalize_platform_role(coalesce(r.key,r.name)) in ('super_admin','platform_admin'))
            or (ur.company_id=p_company_id and exists(select 1 from public.company_memberships m where m.user_id=p_user_id and m.company_id=p_company_id and m.status='active' and coalesce(m.is_active,true)))))
      or exists(select 1 from public.user_permissions up where up.user_id=p_user_id and up.permission_id=p.id and coalesce(up.status,'active')='active' and coalesce(up.is_active,true) and coalesce(up.effect,'allow')='allow'
        and (up.company_id is null or (up.company_id=p_company_id and exists(select 1 from public.company_memberships m where m.user_id=p_user_id and m.company_id=p_company_id and m.status='active' and coalesce(m.is_active,true)))))
      or (coalesce(p.key,p.name)='admin.access' and exists(select 1 from public.admin_users a where a.user_id=p_user_id and coalesce(a.is_active,true) and public.gridex_normalize_platform_role(a.role) in ('super_admin','platform_admin')))
    );
$$;

create function public.staff_api_is_platform_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public,auth,pg_temp as $$
  select public.canonical_actor_is_platform_admin(p_user_id) and (
    exists(select 1 from public.admin_users a where a.user_id=p_user_id and coalesce(a.is_active,true) and public.gridex_normalize_platform_role(a.role) in ('super_admin','platform_admin'))
    or exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id
      where ur.user_id=p_user_id and ur.company_id is null and coalesce(ur.is_active,true) and coalesce(ur.status,'active')='active' and coalesce(r.is_active,true)
        and public.gridex_normalize_platform_role(coalesce(r.key,r.name)) in ('super_admin','platform_admin')
        and ((to_jsonb(ur)->>'expires_at') is null or (to_jsonb(ur)->>'expires_at')::timestamptz>clock_timestamp()))
  );
$$;

create function public.staff_api_actor_is_eligible_assignee(p_user_id uuid,p_company_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public,auth,pg_temp as $$
  select public.staff_api_is_tenant_staff(p_user_id,p_company_id)
    and not public.staff_api_is_platform_admin(p_user_id)
    and 'cases.write'=any(public.staff_api_current_permissions(p_user_id,p_company_id))
    and exists(select 1 from auth.users u where u.id=p_user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and u.email_confirmed_at is not null)
    and exists(select 1 from public.user_profiles p where p.id=p_user_id and p.user_status='active' and to_jsonb(p)->>'disabled_at' is null and to_jsonb(p)->>'must_change_password'='false')
    and exists(select 1 from public.companies c where c.id=p_company_id and c.status='active' and coalesce(c.is_active,true));
$$;

create function public.staff_api_recovery_identity(p_email text,p_company_id uuid)
returns uuid language sql stable security definer set search_path=pg_catalog,public,auth,pg_temp as $$
  select u.id from auth.users u join public.user_profiles p on p.id=u.id
  where lower(btrim(u.email))=lower(btrim(p_email)) and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and u.email_confirmed_at is not null
    and p.user_status='active' and to_jsonb(p)->>'disabled_at' is null
    and exists(select 1 from public.companies c where c.id=p_company_id and c.status='active' and coalesce(c.is_active,true))
    and (public.staff_api_is_platform_admin(u.id) or (public.staff_api_is_tenant_staff(u.id,p_company_id) and cardinality(public.staff_api_current_permissions(u.id,p_company_id))>0))
  order by u.id limit 1;
$$;

-- IDs are supplied only after fresh provider verification by OPS's server.
create function public.staff_api_native_account_state(p_user_id uuid,p_native_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare u jsonb; p jsonb; s jsonb; factors jsonb;
begin
  select to_jsonb(x) into u from auth.users x where x.id=p_user_id;
  select to_jsonb(x) into p from public.user_profiles x where x.id=p_user_id;
  select to_jsonb(x) into s from auth.sessions x where x.id=p_native_session_id and x.user_id=p_user_id;
  if u is null or p is null or s is null or not(p ? 'must_change_password') then return jsonb_build_object('eligible',false,'reason','staff_session_invalid'); end if;
  if u->>'deleted_at' is not null or (u->>'banned_until' is not null and (u->>'banned_until')::timestamptz>clock_timestamp())
    or u->>'email_confirmed_at' is null or (p->>'user_status') is distinct from 'active' or p->>'disabled_at' is not null
    or (s->>'not_after' is not null and (s->>'not_after')::timestamptz<=clock_timestamp()) then
    return jsonb_build_object('eligible',false,'reason','staff_account_ineligible');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'method',f.factor_type,'friendly_name',f.friendly_name)), '[]'::jsonb)
    into factors from auth.mfa_factors f where f.user_id=p_user_id and f.status='verified';
  return jsonb_build_object('eligible',true,'password_change_required',coalesce((p->>'must_change_password')::boolean,false),'aal',coalesce(s->>'aal','aal1'),'factors',factors);
end $$;

create function public.staff_api_consume_auth_budget(p_budget_key text,p_limit integer,p_window_seconds integer)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare v integer;
begin
  if length(p_budget_key)<>64 or p_limit not between 1 and 1000 or p_window_seconds not between 30 and 3600 then raise exception 'Invalid auth budget'; end if;
  perform public.staff_api_cleanup(50);
  insert into public.staff_api_auth_budgets(budget_key,window_start,attempts) values(p_budget_key,now(),1)
  on conflict(budget_key) do update set
    attempts=case when staff_api_auth_budgets.window_start<=now()-make_interval(secs=>p_window_seconds) then 1 else staff_api_auth_budgets.attempts+1 end,
    window_start=case when staff_api_auth_budgets.window_start<=now()-make_interval(secs=>p_window_seconds) then now() else staff_api_auth_budgets.window_start end
  returning attempts into v;
  return v<=p_limit;
end $$;

-- A lease is acquired before a possibly consuming provider call. Expiry is
-- uncertainty, never permission to reuse the old credentials.
create function public.staff_api_acquire_session_operation(
  p_session_id uuid,p_client_id uuid,p_company_id uuid,p_operation_key text,p_command text,p_request_hash text,p_revision bigint default null,p_refresh_hash text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare s public.staff_api_sessions; o public.staff_api_session_operations; lease uuid:=gen_random_uuid(); v_now timestamptz;
begin
  select * into s from public.staff_api_sessions where id=p_session_id for update;
  v_now:=clock_timestamp();
  if not found or s.api_client_id<>p_client_id or s.company_id<>p_company_id or s.expires_at<=v_now then return jsonb_build_object('state','invalid'); end if;
  select * into o from public.staff_api_session_operations where session_id=s.id and operation_key=p_operation_key;
  if found then
    if o.command<>p_command or o.request_hash<>p_request_hash then return jsonb_build_object('state','conflict'); end if;
    if o.status='completed' and (o.command='logout' or (s.status='active' and o.completed_revision=s.revision)) then
      return jsonb_build_object('state','replay','session',to_jsonb(s),'receipt',o.encrypted_receipt);
    end if;
    if o.status<>'pending' then return jsonb_build_object('state','conflict'); end if;
  end if;
  if s.status<>'active' then return jsonb_build_object('state','invalid'); end if;
  if s.lease_id is not null then
    if s.lease_expires_at>v_now then return jsonb_build_object('state','busy'); end if;
    update public.staff_api_sessions set status='blocked',updated_at=now() where id=s.id;
    update public.staff_api_session_operations set status='blocked' where session_id=s.id and status='pending';
    return jsonb_build_object('state','uncertain');
  end if;
  if (p_revision is not null and p_revision<>s.revision) or (p_refresh_hash is not null and p_refresh_hash<>s.refresh_hash) then return jsonb_build_object('state','invalid'); end if;
  if p_command not in ('validate','refresh','logout','mfa_challenge','mfa_verify','password') or length(p_request_hash)<>64 or p_operation_key !~ '^[A-Za-z0-9._:-]{16,128}$' then raise exception 'Invalid session operation'; end if;
  insert into public.staff_api_session_operations(session_id,operation_key,command,request_hash,status,lease_id) values(s.id,p_operation_key,p_command,p_request_hash,'pending',lease);
  update public.staff_api_sessions set lease_id=lease,lease_expires_at=clock_timestamp()+interval '45 seconds',updated_at=clock_timestamp() where id=s.id returning * into s;
  return jsonb_build_object('state','acquired','session',to_jsonb(s),'lease_id',lease);
end $$;

create function public.staff_api_complete_session_operation(
  p_session_id uuid,p_lease_id uuid,p_encrypted_payload text,p_native_session_id uuid,p_stage text,p_native_aal text,p_refresh_hash text,p_encrypted_receipt text,p_advance_revision boolean
) returns bigint language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare s public.staff_api_sessions; v bigint; v_now timestamptz;
begin
  select * into s from public.staff_api_sessions where id=p_session_id for update;
  v_now:=clock_timestamp();
  if not found or s.status<>'active' or s.lease_id is distinct from p_lease_id or s.lease_expires_at<=v_now or s.expires_at<=v_now then raise exception using errcode='42501',message='Session operation no longer authorized'; end if;
  if p_stage not in ('authenticated','mfa_required','password_change_required') or p_native_aal not in ('aal1','aal2') then raise exception 'Invalid authentication stage'; end if;
  v:=s.revision+case when p_advance_revision then 1 else 0 end;
  update public.staff_api_sessions set encrypted_payload=p_encrypted_payload,native_session_id=p_native_session_id,stage=p_stage,native_aal=p_native_aal,
    previous_refresh_hash=case when p_refresh_hash is not null then refresh_hash else previous_refresh_hash end,
    refresh_hash=coalesce(p_refresh_hash,refresh_hash),revision=v,lease_id=null,lease_expires_at=null,updated_at=now() where id=s.id;
  update public.staff_api_session_operations set status='completed',encrypted_receipt=p_encrypted_receipt,completed_revision=v where session_id=s.id and lease_id=p_lease_id and status='pending';
  return v;
end $$;

create function public.staff_api_revoke_session(p_session_id uuid,p_client_id uuid,p_company_id uuid,p_status text default 'revoked')
returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
begin
  if p_status not in ('revoked','blocked') then raise exception 'Invalid session revocation'; end if;
  update public.staff_api_sessions set status=p_status,lease_id=null,lease_expires_at=null,updated_at=now() where id=p_session_id and api_client_id=p_client_id and company_id=p_company_id and (p_status='revoked' or status='active');
  return found;
end $$;

create function public.staff_api_logout_session(p_session_id uuid,p_client_id uuid,p_company_id uuid,p_operation_key text,p_request_hash text,p_receipt text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare s public.staff_api_sessions; o public.staff_api_session_operations;
begin
  select * into s from public.staff_api_sessions where id=p_session_id for update;
  if not found or s.api_client_id<>p_client_id or s.company_id<>p_company_id then return jsonb_build_object('state','invalid'); end if;
  select * into o from public.staff_api_session_operations where session_id=s.id and operation_key=p_operation_key;
  if found and (o.command<>'logout' or o.request_hash<>p_request_hash) then return jsonb_build_object('state','conflict'); end if;
  update public.staff_api_sessions set status='revoked',lease_id=null,lease_expires_at=null,updated_at=now() where id=s.id;
  update public.staff_api_session_operations set status='blocked' where session_id=s.id and status='pending';
  insert into public.staff_api_session_operations(session_id,operation_key,command,request_hash,status,lease_id,encrypted_receipt,completed_revision)
    values(s.id,p_operation_key,'logout',p_request_hash,'completed',gen_random_uuid(),p_receipt,s.revision)
    on conflict(session_id,operation_key) do nothing;
  return jsonb_build_object('state','revoked','session',to_jsonb(s));
end $$;

-- Called inside resource transactions before reservation/replay and mutation.
create function public.staff_api_assert_command_actor(p_session_id uuid,p_revision bigint,p_user_id uuid,p_native_session_id uuid,p_client_id uuid,p_company_id uuid,p_permission text)
returns void language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare s public.staff_api_sessions; a jsonb; c jsonb; perms text[]; v_now timestamptz;
begin
  select * into s from public.staff_api_sessions where id=p_session_id for share;
  if not found or s.status<>'active' or s.stage<>'authenticated' or s.revision<>p_revision or s.user_id<>p_user_id or s.native_session_id<>p_native_session_id or s.api_client_id<>p_client_id or s.company_id<>p_company_id then raise exception using errcode='42501',message='Staff command is not authorized'; end if;
  if s.lease_id is not null then raise exception using errcode='55P03',message='staff_session_busy'; end if;
  -- Hold the contributing authorization rows through audit/mutation commit.
  -- Decisions are evaluated after lock waits, never from the Web guard snapshot.
  perform 1 from auth.users x where x.id=p_user_id for share;
  perform 1 from public.user_profiles x where x.id=p_user_id for share;
  perform 1 from auth.sessions x where x.id=p_native_session_id and x.user_id=p_user_id for share;
  perform 1 from public.integration_api_clients x where x.id=p_client_id and x.company_id=p_company_id for share;
  perform 1 from public.companies x where x.id=p_company_id for share;
  perform 1 from public.company_memberships x where x.user_id=p_user_id and x.company_id=p_company_id for share;
  perform 1 from public.user_roles x where x.user_id=p_user_id and (x.company_id=p_company_id or x.company_id is null) for share;
  perform 1 from public.roles x where x.id in(select ur.role_id from public.user_roles ur where ur.user_id=p_user_id and (ur.company_id=p_company_id or ur.company_id is null)) for share;
  perform 1 from public.role_permissions x where x.role_id in(select ur.role_id from public.user_roles ur where ur.user_id=p_user_id and (ur.company_id=p_company_id or ur.company_id is null)) for share;
  perform 1 from public.user_permissions x where x.user_id=p_user_id and (x.company_id=p_company_id or x.company_id is null) for share;
  perform 1 from public.permissions x where coalesce(x.key,x.name)=p_permission for share;
  perform 1 from public.admin_users x where x.user_id=p_user_id for share;
  perform 1 from auth.mfa_factors x where x.user_id=p_user_id for share;
  v_now:=clock_timestamp();
  if s.expires_at<=v_now then raise exception using errcode='42501',message='Staff command is not authorized'; end if;
  a:=public.staff_api_native_account_state(p_user_id,p_native_session_id);
  if a->>'eligible'<>'true' or a->>'password_change_required'='true'
    or exists(select 1 from jsonb_array_elements(a->'factors') f where f->>'method'<>'totp')
    or (jsonb_array_length(a->'factors')>0 and (s.native_aal<>'aal2' or a->>'aal'<>'aal2'))
    or public.staff_api_is_platform_admin(p_user_id) then raise exception using errcode='42501',message='Staff command is not authorized'; end if;
  select to_jsonb(x) into c from public.integration_api_clients x where x.id=p_client_id and x.company_id=p_company_id for share;
  if c is null or c->>'status'<>'active' or c->>'revoked_at' is not null or c->>'deleted_at' is not null
    or (c->>'expires_at' is not null and (c->>'expires_at')::timestamptz<=clock_timestamp())
    or not (coalesce(c->'scopes','[]'::jsonb) ? 'staff_support.write' or coalesce(c->'scopes','[]'::jsonb) ? '*')
    or not exists(select 1 from public.companies x where x.id=p_company_id and x.status='active' and coalesce(x.is_active,true))
    or not public.staff_api_is_tenant_staff(p_user_id,p_company_id) then raise exception using errcode='42501',message='Staff command is not authorized'; end if;
  perms:=public.staff_api_current_permissions(p_user_id,p_company_id);
  if p_permission is null or not p_permission=any(perms) then raise exception using errcode='42501',message='Staff command is not authorized'; end if;
end $$;

revoke all on function public.staff_api_recovery_identity(text,uuid),public.staff_api_is_platform_admin(uuid),public.staff_api_current_permissions(uuid,uuid),public.staff_api_cleanup(integer),public.staff_api_actor_is_eligible_assignee(uuid,uuid),public.staff_api_logout_session(uuid,uuid,uuid,text,text,text),public.staff_api_is_tenant_staff(uuid,uuid),public.staff_api_native_account_state(uuid,uuid),public.staff_api_consume_auth_budget(text,integer,integer),public.staff_api_acquire_session_operation(uuid,uuid,uuid,text,text,text,bigint,text),public.staff_api_complete_session_operation(uuid,uuid,text,uuid,text,text,text,text,boolean),public.staff_api_revoke_session(uuid,uuid,uuid,text),public.staff_api_assert_command_actor(uuid,bigint,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.staff_api_recovery_identity(text,uuid),public.staff_api_is_platform_admin(uuid),public.staff_api_current_permissions(uuid,uuid),public.staff_api_cleanup(integer),public.staff_api_actor_is_eligible_assignee(uuid,uuid),public.staff_api_logout_session(uuid,uuid,uuid,text,text,text),public.staff_api_is_tenant_staff(uuid,uuid),public.staff_api_native_account_state(uuid,uuid),public.staff_api_consume_auth_budget(text,integer,integer),public.staff_api_acquire_session_operation(uuid,uuid,uuid,text,text,text,bigint,text),public.staff_api_complete_session_operation(uuid,uuid,text,uuid,text,text,text,text,boolean),public.staff_api_revoke_session(uuid,uuid,uuid,text),public.staff_api_assert_command_actor(uuid,bigint,uuid,uuid,uuid,uuid,text) to service_role;
commit;
