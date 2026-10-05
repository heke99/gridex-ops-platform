-- Preserve the electricity_suppliers masterdata permission gate after the broad
-- authenticated SELECT RLS performance consolidation.
--
-- The dashboard performance migration may replace redundant permissive tenant-read
-- branches with TRUE when a restrictive tenant lifecycle guard already determines
-- row visibility. electricity_suppliers is permission-sensitive masterdata and must
-- never inherit that generic permissive branch.

do $do$
declare
  has_permission_policy boolean;
begin
  if to_regclass('public.electricity_suppliers') is not null then
    drop policy if exists gridex_perf_authenticated_select_v1
      on public.electricity_suppliers;

    select exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'electricity_suppliers'
        and cmd = 'SELECT'
        and permissive = 'PERMISSIVE'
        and roles = array['authenticated']::name[]
        and coalesce(qual, '') ilike '%gridex_has_permission%masterdata.read%'
        and coalesce(qual, '') ilike '%gridex_has_permission%masterdata.write%'
    ) into has_permission_policy;

    if not has_permission_policy then
      create policy gridex_masterdata_authenticated_select_v1
        on public.electricity_suppliers
        as permissive
        for select
        to authenticated
        using (
          (select public.gridex_has_permission((select auth.uid()), 'masterdata.read'))
          or (select public.gridex_has_permission((select auth.uid()), 'masterdata.write'))
        );
    end if;
  end if;
end
$do$;

-- Fail the migration if an authenticated unconditional permissive SELECT policy is
-- present or if no masterdata permission gate remains.
do $do$
begin
  if to_regclass('public.electricity_suppliers') is not null then
    if exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'electricity_suppliers'
        and cmd = 'SELECT'
        and permissive = 'PERMISSIVE'
        and roles = array['authenticated']::name[]
        and regexp_replace(coalesce(qual, ''), '[()[:space:]]', '', 'g') = 'true'
    ) then
      raise exception 'electricity_suppliers authenticated SELECT contains an unconditional permissive policy';
    end if;

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'electricity_suppliers'
        and cmd = 'SELECT'
        and permissive = 'PERMISSIVE'
        and roles = array['authenticated']::name[]
        and coalesce(qual, '') ilike '%gridex_has_permission%masterdata.read%'
        and coalesce(qual, '') ilike '%gridex_has_permission%masterdata.write%'
    ) then
      raise exception 'electricity_suppliers authenticated SELECT masterdata permission gate is missing';
    end if;
  end if;
end
$do$;
