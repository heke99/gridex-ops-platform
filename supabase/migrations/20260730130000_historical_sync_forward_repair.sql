-- Forward-only repair for changes that were incorrectly made in
-- 20260728170000_live_schema_code_canonical_sync.sql after its release.
--
-- The historical migration is restored byte-for-byte to its registered
-- checksum. This migration preserves the intended final runtime definitions
-- without changing immutable migration history.

begin;

set local lock_timeout = '15s';
set local statement_timeout = '5min';
select pg_advisory_xact_lock(
  hashtextextended('gridex:historical-sync-forward-repair:20260730130000', 0)
);

create or replace function public.gridex__forward_replace_function_text(
  p_signature text,
  p_old text,
  p_new text
) returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_oid regprocedure;
  v_definition text;
begin
  v_oid := to_regprocedure(p_signature);
  if v_oid is null then
    raise exception using
      errcode = '55000',
      message = 'gridex_forward_repair_function_missing:' || p_signature;
  end if;

  v_definition := pg_get_functiondef(v_oid);
  if strpos(v_definition, p_old) > 0 then
    execute replace(v_definition, p_old, p_new);
  elsif strpos(v_definition, p_new) = 0 then
    raise exception using
      errcode = '55000',
      message = 'gridex_forward_repair_unexpected_function_definition:' ||
        p_signature,
      detail = p_old;
  end if;
end
$$;

revoke all on function public.gridex__forward_replace_function_text(
  text,
  text,
  text
) from public, anon, authenticated, service_role;

-- Contract date columns are inclusive. Canonical timestamp windows use the
-- exclusive start of the day after valid_to.
select public.gridex__forward_replace_function_text(
  'public.gridex_sync_internal_offer_to_canonical(uuid)',
  'o.valid_from::timestamptz,o.valid_to::timestamptz',
  $$o.valid_from::timestamptz,
    case when o.valid_to is null then null else (o.valid_to + 1)::timestamptz end$$
);

-- Install the complete session guard atomically. The historical text-repair
-- sequence compiled an intermediate body after removing v_disabled_at but
-- before removing its references.
create or replace function public.gridex_is_current_session_allowed()
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_catalog, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_status text;
  v_disabled_at timestamptz;
begin
  if v_user_id is null then
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
$$;

drop function public.gridex__forward_replace_function_text(text, text, text);

comment on function public.gridex_is_current_session_allowed() is
  'Tenant session guard with schema-aware disabled_at handling and no invalid intermediate function definition.';

commit;
