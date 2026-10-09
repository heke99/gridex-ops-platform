-- OPS API review F30 (2026-10-07): Auth-level revocation ends tenant access.
--
-- gridex_is_current_session_allowed() checked only the profile status, so a
-- user banned or soft-deleted in Auth alone kept own-tenant RLS reads with a
-- still-valid access JWT. The guard now also requires the Auth user to exist,
-- not be soft-deleted and not be banned. Signature, owner and ACL unchanged;
-- gridex_user_company_ids() reuses this decision.

create or replace function public.gridex_is_current_session_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'auth', 'pg_catalog', 'pg_temp'
as $_$
declare
  v_user_id uuid := auth.uid();
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
