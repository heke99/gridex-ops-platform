-- Commit-time machine authority for dedicated staff clients. Registered staff
-- history is unchanged; this forward migration matches the HTTP staff boundary.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Lock order matches the existing vault -> client -> company command path.
-- A read already admitted by the HTTP guard may finish; mutable Auth and resource
-- commits must re-evaluate the exact current staff profile after lock waits.
create function public.staff_api_client_policy_allowed(p_client_id uuid,p_company_id uuid,p_scope text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare c jsonb; company jsonb; v_now timestamptz;
begin
  if p_scope not in ('staff_sessions.write','staff_support.write') then return false; end if;
  select to_jsonb(x) into c from public.integration_api_clients x where x.id=p_client_id and x.company_id=p_company_id for share;
  select to_jsonb(x) into company from public.companies x where x.id=p_company_id for share;
  v_now:=clock_timestamp();
  return coalesce(c is not null and company is not null
    and c->>'profile_key'='custom' and c->'metadata'->>'integration_kind'='staff_support_v1'
    and c->>'status'='active' and c->>'revoked_at' is null and c->>'deleted_at' is null
    and (c->>'expires_at' is null or (c->>'expires_at')::timestamptz>v_now)
    and (coalesce(c->'scopes','[]'::jsonb) ? p_scope or coalesce(c->'scopes','[]'::jsonb) ? '*')
    and company->>'status'='active' and coalesce((company->>'is_active')::boolean,true),false);
end $$;

-- Login/recovery bootstrap is a single INSERT transaction, so policy cannot
-- change between an HTTP check and minting its stored vault session.
create function public.staff_api_check_session_bootstrap()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
begin
  if not public.staff_api_client_policy_allowed(new.api_client_id,new.company_id,'staff_sessions.write') then
    raise exception using errcode='42501',message='Staff integration client is not authorized';
  end if;
  return new;
end $$;
create trigger staff_api_session_bootstrap_policy before insert on public.staff_api_sessions
for each row execute function public.staff_api_check_session_bootstrap();

create or replace function public.staff_api_acquire_session_operation(
  p_session_id uuid,p_client_id uuid,p_company_id uuid,p_operation_key text,p_command text,p_request_hash text,p_revision bigint default null,p_refresh_hash text default null
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare s public.staff_api_sessions; o public.staff_api_session_operations; lease uuid:=gen_random_uuid(); v_now timestamptz;
begin
  select * into s from public.staff_api_sessions where id=p_session_id for update;
  v_now:=clock_timestamp();
  if not found or s.api_client_id<>p_client_id or s.company_id<>p_company_id or s.expires_at<=v_now then return jsonb_build_object('state','invalid'); end if;
  if p_command not in ('validate','logout') and not public.staff_api_client_policy_allowed(p_client_id,p_company_id,'staff_sessions.write') then
    raise exception using errcode='42501',message='Staff integration client is not authorized';
  end if;
  v_now:=clock_timestamp();
  if s.expires_at<=v_now then return jsonb_build_object('state','invalid'); end if;
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

create or replace function public.staff_api_complete_session_operation(
  p_session_id uuid,p_lease_id uuid,p_encrypted_payload text,p_native_session_id uuid,p_stage text,p_native_aal text,p_refresh_hash text,p_encrypted_receipt text,p_advance_revision boolean
) returns bigint language plpgsql security definer set search_path=pg_catalog,public,auth,pg_temp as $$
declare s public.staff_api_sessions; o public.staff_api_session_operations; v bigint; v_now timestamptz; policy_allowed boolean;
begin
  select * into s from public.staff_api_sessions where id=p_session_id for update;
  v_now:=clock_timestamp();
  if not found or s.status<>'active' or s.lease_id is distinct from p_lease_id or s.lease_expires_at<=v_now or s.expires_at<=v_now then raise exception using errcode='42501',message='Session operation no longer authorized'; end if;
  select * into o from public.staff_api_session_operations where session_id=s.id and lease_id=p_lease_id and status='pending';
  if not found then raise exception using errcode='42501',message='Session operation no longer authorized'; end if;
  if o.command not in ('validate','logout') then
    policy_allowed:=public.staff_api_client_policy_allowed(s.api_client_id,s.company_id,'staff_sessions.write');
    v_now:=clock_timestamp();
    if not policy_allowed or s.lease_expires_at<=v_now or s.expires_at<=v_now then
      -- Do not RAISE after blocking: an exception would roll the durable block
      -- back while a consuming native Auth call may already have succeeded.
      update public.staff_api_sessions set status='blocked',lease_id=null,lease_expires_at=null,updated_at=v_now where id=s.id;
      update public.staff_api_session_operations set status='blocked' where session_id=s.id and status='pending';
      -- Revisions are strictly positive. Zero is a private failure sentinel;
      -- the service bridge rejects it and never emits a successful receipt.
      return 0;
    end if;
  end if;
  if p_stage not in ('authenticated','mfa_required','password_change_required') or p_native_aal not in ('aal1','aal2') then raise exception 'Invalid authentication stage'; end if;
  v:=s.revision+case when p_advance_revision then 1 else 0 end;
  update public.staff_api_sessions set encrypted_payload=p_encrypted_payload,native_session_id=p_native_session_id,stage=p_stage,native_aal=p_native_aal,
    previous_refresh_hash=case when p_refresh_hash is not null then refresh_hash else previous_refresh_hash end,
    refresh_hash=coalesce(p_refresh_hash,refresh_hash),revision=v,lease_id=null,lease_expires_at=null,updated_at=now() where id=s.id;
  update public.staff_api_session_operations set status='completed',encrypted_receipt=p_encrypted_receipt,completed_revision=v where session_id=s.id and lease_id=p_lease_id and status='pending';
  return v;
end $$;

create or replace function public.staff_api_assert_command_actor(p_session_id uuid,p_revision bigint,p_user_id uuid,p_native_session_id uuid,p_client_id uuid,p_company_id uuid,p_permission text)
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
  if c is null or c->>'profile_key' is distinct from 'custom' or c->'metadata'->>'integration_kind' is distinct from 'staff_support_v1'
    or c->>'status'<>'active' or c->>'revoked_at' is not null or c->>'deleted_at' is not null
    or (c->>'expires_at' is not null and (c->>'expires_at')::timestamptz<=clock_timestamp())
    or not (coalesce(c->'scopes','[]'::jsonb) ? 'staff_support.write' or coalesce(c->'scopes','[]'::jsonb) ? '*')
    or not exists(select 1 from public.companies x where x.id=p_company_id and x.status='active' and coalesce(x.is_active,true))
    or not public.staff_api_is_tenant_staff(p_user_id,p_company_id) then raise exception using errcode='42501',message='Staff command is not authorized'; end if;
  perms:=public.staff_api_current_permissions(p_user_id,p_company_id);
  if p_permission is null or not p_permission=any(perms) then raise exception using errcode='42501',message='Staff command is not authorized'; end if;
end $$;

revoke all on function public.staff_api_client_policy_allowed(uuid,uuid,text),public.staff_api_check_session_bootstrap(),public.staff_api_acquire_session_operation(uuid,uuid,uuid,text,text,text,bigint,text),public.staff_api_complete_session_operation(uuid,uuid,text,uuid,text,text,text,text,boolean),public.staff_api_assert_command_actor(uuid,bigint,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.staff_api_client_policy_allowed(uuid,uuid,text),public.staff_api_check_session_bootstrap(),public.staff_api_acquire_session_operation(uuid,uuid,uuid,text,text,text,bigint,text),public.staff_api_complete_session_operation(uuid,uuid,text,uuid,text,text,text,text,boolean),public.staff_api_assert_command_actor(uuid,bigint,uuid,uuid,uuid,uuid,text) to service_role;
commit;
