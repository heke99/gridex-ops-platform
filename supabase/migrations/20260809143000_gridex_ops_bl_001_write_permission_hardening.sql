-- GRIDEX-OPS-BL-001 — remove raw tenant-membership OR bypass from write policies.
--
-- Live reconciliation on 2026-08-09 confirmed the original seven-table family still
-- exists. External mutation must require the canonical active-company/write-role helper;
-- raw company membership is not sufficient authorization.
--
-- Forward-only. Historical migrations remain immutable.

begin;
set local search_path = public, pg_catalog;

do $$
declare
  v_table text;
begin
  if to_regprocedure('public.gridex_can_write_company(uuid)') is null then
    raise exception 'gridex_can_write_company_missing';
  end if;
  if to_regprocedure('public.gridex_can_read_company(uuid)') is null then
    raise exception 'gridex_can_read_company_missing';
  end if;
  if to_regprocedure('public.gridex_user_is_platform_admin()') is null then
    raise exception 'gridex_user_is_platform_admin_missing';
  end if;

  foreach v_table in array array[
    'batch4c_security_checks',
    'customer_duplicate_resolution_events',
    'customer_lifecycle_decisions',
    'customer_merge_events',
    'customer_readiness_snapshots',
    'document_ai_extractions',
    'power_of_attorney_scopes'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'bl001_required_table_missing:%', v_table;
    end if;
  end loop;
end;
$$;

-- RLS remains the object-authorization boundary. Anonymous/public callers have no DML
-- or direct-read need on these operational tables; authenticated/service-role grants are
-- explicit and policies decide row scope.
revoke select, insert, update, delete on table
  public.batch4c_security_checks,
  public.customer_duplicate_resolution_events,
  public.customer_lifecycle_decisions,
  public.customer_merge_events,
  public.customer_readiness_snapshots,
  public.document_ai_extractions,
  public.power_of_attorney_scopes
from public, anon;

grant select, insert, update, delete on table
  public.batch4c_security_checks,
  public.customer_duplicate_resolution_events,
  public.customer_lifecycle_decisions,
  public.customer_merge_events,
  public.customer_readiness_snapshots,
  public.document_ai_extractions,
  public.power_of_attorney_scopes
to authenticated, service_role;

-- Drop every externally reachable ALL/INSERT/UPDATE/DELETE policy in this finding family
-- whose predicate contains a raw company_memberships branch. This handles both the five
-- legacy PUBLIC ALL policies and policy-compacted gridex_mp_* variants.
do $$
declare
  v_table text;
  v_policy record;
begin
  foreach v_table in array array[
    'batch4c_security_checks',
    'customer_duplicate_resolution_events',
    'customer_lifecycle_decisions',
    'customer_merge_events',
    'customer_readiness_snapshots',
    'document_ai_extractions',
    'power_of_attorney_scopes'
  ] loop
    for v_policy in
      select p.polname
      from pg_policy p
      where p.polrelid = to_regclass('public.' || v_table)
        and p.polcmd in ('*', 'a', 'w', 'd')
        and (
          coalesce(pg_get_expr(p.polqual, p.polrelid, true), '') ilike '%company_memberships%'
          or coalesce(pg_get_expr(p.polwithcheck, p.polrelid, true), '') ilike '%company_memberships%'
        )
        and exists (
          select 1
          from unnest(p.polroles) as role_oid(oid)
          left join pg_roles r on r.oid = role_oid.oid
          where role_oid.oid = 0
             or r.rolname in ('anon', 'authenticated', 'authenticator')
        )
    loop
      execute format('drop policy if exists %I on public.%I', v_policy.polname, v_table);
    end loop;
  end loop;
end;
$$;

-- The five legacy ALL policies also carried SELECT. Replace that read capability with the
-- canonical active-company read boundary; company_id IS NULL is platform-global and is
-- visible only to platform admins.
do $$
declare
  v_table text;
  v_name text;
  v_read text := '(select public.gridex_user_is_platform_admin()) OR (company_id IS NOT NULL AND public.gridex_can_read_company(company_id))';
begin
  foreach v_table in array array[
    'batch4c_security_checks',
    'customer_duplicate_resolution_events',
    'customer_merge_events',
    'customer_readiness_snapshots',
    'document_ai_extractions'
  ] loop
    v_name := v_table || '_bl001_read';
    execute format('drop policy if exists %I on public.%I', v_name, v_table);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', v_name, v_table, v_read);
  end loop;
end;
$$;

-- Canonical write policies for all seven tables. UPDATE requires write capability both
-- for the existing row and the resulting row, preventing company_id moves across tenants.
do $$
declare
  v_table text;
  v_insert text;
  v_update text;
  v_delete text;
  v_write text := '(select public.gridex_user_is_platform_admin()) OR (company_id IS NOT NULL AND public.gridex_can_write_company(company_id))';
begin
  foreach v_table in array array[
    'batch4c_security_checks',
    'customer_duplicate_resolution_events',
    'customer_lifecycle_decisions',
    'customer_merge_events',
    'customer_readiness_snapshots',
    'document_ai_extractions',
    'power_of_attorney_scopes'
  ] loop
    v_insert := v_table || '_bl001_insert';
    v_update := v_table || '_bl001_update';
    v_delete := v_table || '_bl001_delete';

    execute format('drop policy if exists %I on public.%I', v_insert, v_table);
    execute format('drop policy if exists %I on public.%I', v_update, v_table);
    execute format('drop policy if exists %I on public.%I', v_delete, v_table);

    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', v_insert, v_table, v_write);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', v_update, v_table, v_write, v_write);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', v_delete, v_table, v_write);
  end loop;
end;
$$;

-- Fail closed: no externally reachable write/ALL policy in the seven-table family may
-- retain a raw company_memberships predicate, and each table must have all three canonical
-- authenticated write policies.
do $$
declare
  v_table text;
  v_bad integer;
  v_canonical integer;
begin
  foreach v_table in array array[
    'batch4c_security_checks',
    'customer_duplicate_resolution_events',
    'customer_lifecycle_decisions',
    'customer_merge_events',
    'customer_readiness_snapshots',
    'document_ai_extractions',
    'power_of_attorney_scopes'
  ] loop
    select count(*)::integer
      into v_bad
    from pg_policy p
    where p.polrelid = to_regclass('public.' || v_table)
      and p.polcmd in ('*', 'a', 'w', 'd')
      and exists (
        select 1
        from unnest(p.polroles) as role_oid(oid)
        left join pg_roles r on r.oid = role_oid.oid
        where role_oid.oid = 0
           or r.rolname in ('anon', 'authenticated', 'authenticator')
      )
      and (
        coalesce(pg_get_expr(p.polqual, p.polrelid, true), '') ilike '%company_memberships%'
        or coalesce(pg_get_expr(p.polwithcheck, p.polrelid, true), '') ilike '%company_memberships%'
      );

    if v_bad <> 0 then
      raise exception 'bl001_raw_membership_write_policy_residual:%:%', v_table, v_bad;
    end if;

    select count(*)::integer
      into v_canonical
    from pg_policy p
    where p.polrelid = to_regclass('public.' || v_table)
      and p.polname in (
        v_table || '_bl001_insert',
        v_table || '_bl001_update',
        v_table || '_bl001_delete'
      )
      and exists (
        select 1
        from unnest(p.polroles) as role_oid(oid)
        join pg_roles r on r.oid = role_oid.oid
        where r.rolname = 'authenticated'
      )
      and (
        coalesce(pg_get_expr(p.polqual, p.polrelid, true), '') ilike '%gridex_can_write_company%'
        or coalesce(pg_get_expr(p.polwithcheck, p.polrelid, true), '') ilike '%gridex_can_write_company%'
      );

    if v_canonical <> 3 then
      raise exception 'bl001_canonical_write_policy_count:%:%', v_table, v_canonical;
    end if;
  end loop;
end;
$$;

commit;
