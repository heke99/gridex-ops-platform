-- Install only over the qualified predecessor from
-- 20260811080000_remaining_masterpoint_convergence.sql. The digest covers the
-- actual prosrc body bytes, excluding the SQL declaration/header/delimiters.
-- Unknown deployed definitions require separate producer qualification.
-- This single DO statement makes validation, replacement and complete catalog
-- metadata comparison atomic. No columns, owners or grants are added/changed.
-- The existing qualified release owner serializes DDL delivery. Ordinary
-- function owners need only catalog SELECT, not system-catalog UPDATE rights;
-- this migration does not claim protection against arbitrary concurrent DDL.
DO $migration$
declare
  target_function oid;
  before_function pg_catalog.pg_proc%rowtype;
  before_metadata jsonb;
  after_metadata jsonb;
  after_source_hash text;
begin
  target_function := pg_catalog.to_regprocedure('public.anonymize_user_account(uuid)');
  if target_function is null then
    raise exception using errcode = '42883', message = 'account_closure_existing_signature_required';
  end if;

  select p.* into strict before_function
  from pg_catalog.pg_proc p
  where p.oid = target_function;
  before_metadata := pg_catalog.to_jsonb(before_function) - 'prosrc';

  if before_function.pronargs <> 1
     or before_function.proargtypes[0] <> 'pg_catalog.uuid'::pg_catalog.regtype::oid
     or before_function.proargnames is distinct from array['target_user_id']::text[]
     or before_function.proallargtypes is not null
     or before_function.proargmodes is not null
     or before_function.proargdefaults is not null
     or before_function.provariadic <> 0
     or before_function.prorettype <> 'pg_catalog.void'::pg_catalog.regtype::oid
     or before_function.proretset
     or before_function.prokind <> 'f'
     or before_function.prolang <> (select oid from pg_catalog.pg_language where lanname = 'plpgsql')
     or not before_function.prosecdef
     or before_function.proisstrict
     or before_function.proleakproof
     or before_function.provolatile <> 'v'
     or before_function.proparallel <> 'u'
     or before_function.proconfig is distinct from array['search_path=public, auth, pg_catalog, pg_temp']::text[] then
    raise exception using errcode = '55000', message = 'account_closure_existing_contract_mismatch';
  end if;
  if pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(before_function.prosrc,'UTF8')),'hex') <> '40ec063475b6a977585e58382358238b2ecf50c470c190d43a3c948f8cce4d97' then
    raise exception using errcode = '55000', message = 'account_closure_existing_source_unqualified';
  end if;

  execute $replacement$
CREATE OR REPLACE FUNCTION public.anonymize_user_account(target_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'pg_catalog', 'pg_temp'
    AS $_$
declare
  profile_assignments text := 'email = null, full_name = null, user_status = ''disabled'', updated_at = now()';
begin
  if auth.uid() is distinct from target_user_id then
    raise exception using
      errcode = '42501',
      message = 'Can only anonymize your own account';
  end if;

  if exists (
    select 1
    from public.company_memberships membership
    join public.companies company on company.id = membership.company_id
    where membership.user_id = target_user_id
      and coalesce(membership.status, 'active') = 'active'
      and coalesce(
        nullif(lower(membership.membership_role), ''),
        nullif(lower(membership.role), ''),
        nullif(lower(membership.role_key), '')
      ) = 'owner'
      and company.archived_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Active companies must be transferred or archived first';
  end if;

  if to_regclass('public.user_preferences') is not null then
    execute 'delete from public.user_preferences where user_id = $1'
      using target_user_id;
  end if;
  if to_regclass('public.user_permission_overrides') is not null then
    execute 'delete from public.user_permission_overrides where user_id = $1'
      using target_user_id;
  end if;
  if to_regclass('public.user_roles') is not null then
    execute 'delete from public.user_roles where user_id = $1'
      using target_user_id;
  end if;
  if to_regclass('public.company_memberships') is not null then
    execute 'delete from public.company_memberships where user_id = $1'
      using target_user_id;
  end if;
  if to_regclass('public.agency_members') is not null then
    execute 'delete from public.agency_members where user_id = $1'
      using target_user_id;
  end if;
  if to_regclass('public.team_members') is not null then
    execute 'delete from public.team_members where user_id = $1'
      using target_user_id;
  end if;
  if to_regclass('public.bankid_enrichment') is not null then
    execute 'delete from public.bankid_enrichment where user_id = $1'
      using target_user_id;
  end if;
  if to_regclass('public.extension_data') is not null then
    execute
      'delete from public.extension_data where user_id = $1 and key = ''bankid_enrichment'''
      using target_user_id;
  end if;

  if to_regclass('public.company_invitations') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'company_invitations'
         and column_name = 'invited_user_id'
     ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'company_invitations'
        and column_name = 'invited_user_id'
        and is_nullable = 'YES'
    ) then
      execute 'update public.company_invitations set invited_user_id = null where invited_user_id = $1'
        using target_user_id;
    else
      execute 'delete from public.company_invitations where invited_user_id = $1'
        using target_user_id;
    end if;
  end if;

  -- Revoke existing authenticated sessions without deleting the auth identity.
  -- The identity itself remains so the product can retain its established
  -- account-closure semantics while authorization state is removed atomically.
  if to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1'
      using target_user_id;
  end if;
  if to_regclass('auth.refresh_tokens') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'auth'
         and table_name = 'refresh_tokens'
         and column_name = 'user_id'
     ) then
    execute 'delete from auth.refresh_tokens where user_id::text = $1::text'
      using target_user_id;
  end if;

  -- Keep one update and all mandatory assignments. Only these two known
  -- legacy columns are optional; required-column/type/constraint failures must
  -- still roll back every preceding authorization/session cleanup operation.
  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = pg_catalog.to_regclass('public.user_profiles')
      and attname = 'phone' and attnum > 0 and not attisdropped
  ) then
    profile_assignments := profile_assignments || ', phone = null';
  end if;
  if exists (
    select 1 from pg_catalog.pg_attribute
    where attrelid = pg_catalog.to_regclass('public.user_profiles')
      and attname = 'active_company_id' and attnum > 0 and not attisdropped
  ) then
    profile_assignments := profile_assignments || ', active_company_id = null';
  end if;

  -- All SQL fragments above are constants; the target identity stays bound.
  execute 'update public.user_profiles set ' || profile_assignments || ' where id = $1'
    using target_user_id;
end
$_$;
$replacement$;

  select pg_catalog.to_jsonb(p) - 'prosrc',
         pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')
    into after_metadata, after_source_hash
  from pg_catalog.pg_proc p where p.oid = target_function;
  if after_metadata is distinct from before_metadata
     or after_source_hash is distinct from '410d33fda02e355323850769d063d7de3190c4aca7c82b33d64a4dc4be3e28e2' then
    raise exception using errcode = '55000', message = 'account_closure_install_metadata_changed';
  end if;
end
$migration$;
