-- Keep server-side session expiry effective even when the access token is still valid.
-- Check the exact current guard and Auth schema before replacing the function body.

do $migration_guard$
declare
  current_guard pg_catalog.pg_proc%rowtype;
  sessions_table regclass := to_regclass('auth.sessions');
  jwt_function regprocedure := to_regprocedure('auth.jwt()');
  authenticated_role regrole := to_regrole('authenticated');
  service_role regrole := to_regrole('service_role');
  anon_role regrole := to_regrole('anon');
begin
  select * into current_guard
  from pg_catalog.pg_proc
  where oid = to_regprocedure('public.gridex_is_current_session_allowed()');

  if not found
    or md5(current_guard.prosrc) not in (
      '6707ca220b4289d0cbfff1ef2cc5af65',
      'd2e8ccc390908e051749102508be220c'
    )
    or pg_get_userbyid(current_guard.proowner) <> 'postgres'
    or current_guard.prorettype <> 'boolean'::regtype
    or current_guard.proretset
    or current_guard.provolatile <> 's'
    or not current_guard.prosecdef
    or current_guard.proconfig is distinct from array['search_path=public, auth, pg_catalog, pg_temp']
  then
    raise exception 'The deployed session guard differs from the reviewed source and settings';
  end if;

  if authenticated_role is null or service_role is null or anon_role is null
    or not has_function_privilege(authenticated_role, current_guard.oid, 'EXECUTE')
    or not has_function_privilege(service_role, current_guard.oid, 'EXECUTE')
    or has_function_privilege(anon_role, current_guard.oid, 'EXECUTE')
    or exists (
      select 1
      from pg_catalog.aclexplode(current_guard.proacl) grant_entry
      where grant_entry.grantee not in (current_guard.proowner, authenticated_role, service_role)
        or (grant_entry.is_grantable and grant_entry.grantee <> current_guard.proowner)
    )
  then
    raise exception 'The deployed session guard grants differ from the reviewed grants';
  end if;

  if sessions_table is null or jwt_function is null
    or not has_schema_privilege(current_guard.proowner, 'auth', 'USAGE')
    or not has_table_privilege(current_guard.proowner, sessions_table, 'SELECT')
    or not has_function_privilege(current_guard.proowner, jwt_function, 'EXECUTE')
    or (
      select count(*)
      from pg_catalog.pg_attribute
      where attrelid = sessions_table and attnum > 0 and not attisdropped
        and (
          (attname in ('id', 'user_id') and atttypid = 'uuid'::regtype)
          or (attname = 'not_after' and atttypid = 'timestamptz'::regtype)
        )
    ) <> 3
  then
    raise exception 'The Auth session schema or guard ownership is not ready';
  end if;
end
$migration_guard$;

create or replace function public.gridex_is_current_session_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'pg_catalog', 'pg_temp'
as $_$
declare
  v_user_id uuid := auth.uid();
  v_claims jsonb := auth.jwt();
  v_session_id text := v_claims ->> 'session_id';
  v_status text;
  v_disabled_at timestamptz;
begin
  if v_user_id is null then
    return false;
  end if;
  if not exists (
    select 1
      from auth.users u
     where u.id = v_user_id
       and u.deleted_at is null
       and (u.banned_until is null or u.banned_until <= now())
  ) then
    return false;
  end if;
  -- Older supported tokens without this claim retain the existing checks.
  -- A present claim must identify the authenticated user's active session.
  if v_claims ? 'session_id' then
    if v_session_id is null
      or v_session_id !~ '^[0-9A-Fa-f]{8}(-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}$'
      or v_claims ->> 'sub' is distinct from v_user_id::text then
      return false;
    end if;
    if not exists (
      select 1
        from auth.sessions session
       where session.id = v_session_id::uuid
         and session.user_id = v_user_id
         and (session.not_after is null or session.not_after > now())
    ) then
      return false;
    end if;
  end if;
  if to_regclass('public.user_profiles') is null then
    return true;
  end if;
  if exists(
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_profiles'
      and column_name = 'disabled_at'
  ) then
    execute
      'select profile.user_status,profile.disabled_at
       from public.user_profiles profile where profile.id=$1'
    into v_status, v_disabled_at
    using v_user_id;
  else
    select profile.user_status
    into v_status
    from public.user_profiles profile
    where profile.id = v_user_id;
  end if;
  if coalesce(v_status, 'active') in (
    'disabled',
    'locked_security',
    'removed_from_company',
    'invitation_revoked'
  ) then
    return false;
  end if;
  return v_disabled_at is null;
end
$_$;
