-- Migration ledger/manifest readiness must fail closed.

alter table public.canonical_migration_manifest
  add column if not exists verified_at timestamptz,
  add column if not exists verification_source text,
  add column if not exists release_identifier text,
  add column if not exists schema_fingerprint text;

create or replace view public.canonical_migration_readiness_v
with (security_invoker = true) as
with manifest as (
  select count(*)::bigint as manifest_file_count,
         count(distinct version)::bigint as manifest_version_count,
         count(*) filter (where verified_at is not null)::bigint as verified_file_count,
         count(*) filter (
           where checksum is null or checksum !~ '^[a-f0-9]{64}$'
         )::bigint as invalid_checksum_count,
         max(verified_at) as last_verified_at
  from public.canonical_migration_manifest
), ledger as (
  select count(*)::bigint as ledger_version_count,
         max(version) as latest_ledger_version
  from supabase_migrations.schema_migrations
), missing as (
  select count(distinct manifest_row.version)::bigint as missing_in_ledger
  from public.canonical_migration_manifest manifest_row
  where not exists (
    select 1
    from supabase_migrations.schema_migrations ledger_row
    where ledger_row.version::text = manifest_row.version
  )
)
select
  manifest.manifest_file_count,
  manifest.manifest_version_count,
  manifest.verified_file_count,
  manifest.invalid_checksum_count,
  manifest.last_verified_at,
  ledger.ledger_version_count,
  ledger.latest_ledger_version,
  missing.missing_in_ledger,
  (
    manifest.manifest_file_count > 0
    and manifest.verified_file_count = manifest.manifest_file_count
    and manifest.invalid_checksum_count = 0
    and missing.missing_in_ledger = 0
    and manifest.manifest_version_count = ledger.ledger_version_count
    and manifest.last_verified_at >= now() - interval '24 hours'
  ) as is_ready,
  array_remove(array[
    case when manifest.manifest_file_count = 0 then 'CANONICAL_MIGRATION_MANIFEST_EMPTY' end,
    case when manifest.verified_file_count <> manifest.manifest_file_count then 'MIGRATIONS_NOT_FULLY_VERIFIED' end,
    case when manifest.invalid_checksum_count > 0 then 'MIGRATION_CHECKSUM_INVALID' end,
    case when missing.missing_in_ledger > 0 then 'MIGRATION_LEDGER_MISSING_VERSION' end,
    case when manifest.manifest_version_count <> ledger.ledger_version_count then 'MIGRATION_LEDGER_COUNT_MISMATCH' end,
    case when manifest.last_verified_at is null or manifest.last_verified_at < now() - interval '24 hours' then 'MIGRATION_VERIFICATION_STALE' end
  ], null)::text[] as blockers
from manifest cross join ledger cross join missing;

revoke all on public.canonical_migration_readiness_v from public, anon, authenticated;
grant select on public.canonical_migration_readiness_v to service_role;

create or replace function public.gridex_refresh_platform_schema_state_v2(
  p_release_identifier text,
  p_schema_fingerprint text
)
returns public.platform_schema_state
language plpgsql
security definer
set search_path = pg_catalog, public, supabase_migrations
as $$
declare
  v_readiness public.canonical_migration_readiness_v%rowtype;
  v_result public.platform_schema_state%rowtype;
  v_release_identifier text;
  v_schema_fingerprint text;
  v_fingerprint_verified boolean;
  v_blockers text[];
begin
  v_release_identifier := nullif(trim(coalesce(p_release_identifier, '')), '');
  v_schema_fingerprint := nullif(trim(coalesce(p_schema_fingerprint, '')), '');
  if v_release_identifier is null or v_schema_fingerprint is null then
    raise exception using errcode = '22023', message = 'RELEASE_AND_SCHEMA_FINGERPRINT_REQUIRED';
  end if;

  select * into v_readiness from public.canonical_migration_readiness_v;

  select exists (
    select 1
    from public.canonical_migration_manifest manifest_row
    where manifest_row.release_identifier = v_release_identifier
      and manifest_row.schema_fingerprint = v_schema_fingerprint
      and manifest_row.verified_at is not null
  ) into v_fingerprint_verified;

  v_blockers := coalesce(v_readiness.blockers, '{}'::text[]);
  if not v_fingerprint_verified then
    v_blockers := array_append(v_blockers, 'SCHEMA_FINGERPRINT_MISMATCH');
  end if;

  insert into public.platform_schema_state(
    id, current_version, is_ready, blocking_issues, verified_at, updated_at
  ) values (
    true,
    v_release_identifier,
    v_readiness.is_ready and v_fingerprint_verified,
    to_jsonb(v_blockers),
    now(),
    now()
  )
  on conflict (id) do update
    set current_version = excluded.current_version,
        is_ready = excluded.is_ready,
        blocking_issues = excluded.blocking_issues,
        verified_at = excluded.verified_at,
        updated_at = excluded.updated_at
  returning * into v_result;

  return v_result;
end;
$$;

revoke execute on function public.gridex_refresh_platform_schema_state_v2(text,text)
  from public, anon, authenticated;
grant execute on function public.gridex_refresh_platform_schema_state_v2(text,text)
  to service_role;

-- Fail closed immediately because the current canonical manifest may be empty
-- or stale. A verified deployment process must repopulate the manifest and call
-- gridex_refresh_platform_schema_state_v2 after schema fingerprint comparison.
update public.platform_schema_state
set is_ready = false,
    blocking_issues = (
      select to_jsonb(blockers) from public.canonical_migration_readiness_v
    ),
    updated_at = now()
where id = true
  and not (select is_ready from public.canonical_migration_readiness_v);
