-- Performance continuation — RLS policy consolidation and duplicate-index cleanup.
--
-- Purpose:
--   Supabase Advisor still reports "Multiple Permissive Policies" and duplicate
--   index warnings after the auth initplan/RPC performance batch.
--
-- Safety model:
--   - No data is deleted.
--   - Existing permissive policy semantics are preserved per effective DB role
--     and action by OR-combining old predicates into one canonical policy.
--   - Old permissive policies are removed only after replacement policies for
--     the same table have been created successfully.
--   - Restrictive policies are not touched.
--   - Duplicate indexes are dropped only when they are structurally identical
--     and are not backing a constraint.
--   - All operations are best-effort with lock_timeout and audit logging.

set statement_timeout = '180s';
set lock_timeout = '5s';

create table if not exists public.gridex_performance_hardening_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null,
  status text not null default 'completed',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists gridex_performance_hardening_events_key_created_idx
  on public.gridex_performance_hardening_events(event_key, created_at desc);

-- Keep a small before/after inventory surface for Supabase Advisor follow-up.
create or replace view public.gridex_multiple_permissive_policy_candidates_v as
with role_candidates as (
  select rolname::text as role_name
  from pg_roles
  where rolname in (
    'anon',
    'authenticated',
    'service_role',
    'authenticator',
    'dashboard_user',
    'supabase_privileged_role'
  )
  union
  select distinct unnest(roles)::text as role_name
  from pg_policies
  where schemaname = 'public'
), expanded as (
  select
    p.schemaname,
    p.tablename,
    a.action_name,
    r.role_name,
    p.policyname
  from pg_policies p
  join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as a(action_name)
    on p.cmd = 'ALL' or p.cmd = a.action_name
  join role_candidates r
    on 'public' = any(p.roles::text[])
    or r.role_name = any(p.roles::text[])
  where p.schemaname = 'public'
    and p.permissive = 'PERMISSIVE'
)
select
  schemaname,
  tablename,
  action_name,
  role_name,
  count(*) as policy_count,
  array_agg(policyname order by policyname) as policies
from expanded
group by schemaname, tablename, action_name, role_name
having count(*) > 1;

-- 1) Consolidate multiple permissive policies safely.
do $$
declare
  v_table record;
  v_action text;
  v_role text;
  v_using_expr text;
  v_check_expr text;
  v_policy_name text;
  v_policy_count integer;
  v_created integer;
  v_dropped integer;
  v_total_tables integer := 0;
  v_total_created integer := 0;
  v_total_dropped integer := 0;
  v_old_policy record;
begin
  create temporary table if not exists _gridex_policy_roles (
    role_name text primary key
  ) on commit drop;

  truncate table _gridex_policy_roles;

  insert into _gridex_policy_roles(role_name)
  select rolname::text
  from pg_roles
  where rolname in (
    'anon',
    'authenticated',
    'service_role',
    'authenticator',
    'dashboard_user',
    'supabase_privileged_role'
  )
  on conflict do nothing;

  insert into _gridex_policy_roles(role_name)
  select distinct unnest(roles)::text
  from pg_policies
  where schemaname = 'public'
    and permissive = 'PERMISSIVE'
    and not ('public' = any(roles::text[]))
  on conflict do nothing;

  create temporary table if not exists _gridex_old_permissive_policies as
  select
    p.schemaname,
    p.tablename,
    p.policyname,
    p.cmd,
    p.roles::text[] as roles,
    p.qual,
    p.with_check
  from pg_policies p
  where false;

  truncate table _gridex_old_permissive_policies;

  insert into _gridex_old_permissive_policies
  select
    p.schemaname,
    p.tablename,
    p.policyname,
    p.cmd,
    p.roles::text[] as roles,
    p.qual,
    p.with_check
  from pg_policies p
  where p.schemaname = 'public'
    and p.permissive = 'PERMISSIVE';

  create temporary table if not exists _gridex_policy_targets (
    schemaname text not null,
    tablename text not null,
    primary key (schemaname, tablename)
  ) on commit drop;

  truncate table _gridex_policy_targets;

  insert into _gridex_policy_targets(schemaname, tablename)
  with expanded as (
    select
      p.schemaname,
      p.tablename,
      a.action_name,
      r.role_name,
      p.policyname
    from _gridex_old_permissive_policies p
    join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as a(action_name)
      on p.cmd = 'ALL' or p.cmd = a.action_name
    join _gridex_policy_roles r
      on 'public' = any(p.roles)
      or r.role_name = any(p.roles)
  )
  select distinct schemaname, tablename
  from expanded
  group by schemaname, tablename, action_name, role_name
  having count(*) > 1;

  for v_table in
    select schemaname, tablename
    from _gridex_policy_targets
    order by tablename
  loop
    begin
      v_created := 0;
      v_dropped := 0;

      for v_action in select unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
      loop
        for v_role in select role_name from _gridex_policy_roles order by role_name
        loop
          select count(*)
            into v_policy_count
          from _gridex_old_permissive_policies p
          where p.schemaname = v_table.schemaname
            and p.tablename = v_table.tablename
            and (p.cmd = 'ALL' or p.cmd = v_action)
            and ('public' = any(p.roles) or v_role = any(p.roles));

          if coalesce(v_policy_count, 0) = 0 then
            continue;
          end if;

          if v_action in ('SELECT', 'DELETE') then
            select string_agg('(' || coalesce(nullif(qual, ''), 'true') || ')', E'\n OR ' order by policyname)
              into v_using_expr
            from _gridex_old_permissive_policies p
            where p.schemaname = v_table.schemaname
              and p.tablename = v_table.tablename
              and (p.cmd = 'ALL' or p.cmd = v_action)
              and ('public' = any(p.roles) or v_role = any(p.roles));

            v_policy_name := 'gridex_mp_' || substr(md5(v_table.schemaname || '.' || v_table.tablename || ':' || v_action || ':' || v_role), 1, 20);

            execute format('drop policy if exists %I on %I.%I', v_policy_name, v_table.schemaname, v_table.tablename);

            execute format(
              'create policy %I on %I.%I as permissive for %s to %I using (%s)',
              v_policy_name,
              v_table.schemaname,
              v_table.tablename,
              v_action,
              v_role,
              coalesce(v_using_expr, 'true')
            );
          elsif v_action = 'INSERT' then
            select string_agg('(' || coalesce(nullif(with_check, ''), nullif(qual, ''), 'true') || ')', E'\n OR ' order by policyname)
              into v_check_expr
            from _gridex_old_permissive_policies p
            where p.schemaname = v_table.schemaname
              and p.tablename = v_table.tablename
              and (p.cmd = 'ALL' or p.cmd = v_action)
              and ('public' = any(p.roles) or v_role = any(p.roles));

            v_policy_name := 'gridex_mp_' || substr(md5(v_table.schemaname || '.' || v_table.tablename || ':' || v_action || ':' || v_role), 1, 20);

            execute format('drop policy if exists %I on %I.%I', v_policy_name, v_table.schemaname, v_table.tablename);

            execute format(
              'create policy %I on %I.%I as permissive for %s to %I with check (%s)',
              v_policy_name,
              v_table.schemaname,
              v_table.tablename,
              v_action,
              v_role,
              coalesce(v_check_expr, 'true')
            );
          elsif v_action = 'UPDATE' then
            select
              string_agg('(' || coalesce(nullif(qual, ''), 'true') || ')', E'\n OR ' order by policyname),
              string_agg('(' || coalesce(nullif(with_check, ''), nullif(qual, ''), 'true') || ')', E'\n OR ' order by policyname)
              into v_using_expr, v_check_expr
            from _gridex_old_permissive_policies p
            where p.schemaname = v_table.schemaname
              and p.tablename = v_table.tablename
              and (p.cmd = 'ALL' or p.cmd = v_action)
              and ('public' = any(p.roles) or v_role = any(p.roles));

            v_policy_name := 'gridex_mp_' || substr(md5(v_table.schemaname || '.' || v_table.tablename || ':' || v_action || ':' || v_role), 1, 20);

            execute format('drop policy if exists %I on %I.%I', v_policy_name, v_table.schemaname, v_table.tablename);

            execute format(
              'create policy %I on %I.%I as permissive for %s to %I using (%s) with check (%s)',
              v_policy_name,
              v_table.schemaname,
              v_table.tablename,
              v_action,
              v_role,
              coalesce(v_using_expr, 'true'),
              coalesce(v_check_expr, 'true')
            );
          end if;

          v_created := v_created + 1;
        end loop;
      end loop;

      for v_old_policy in
        select policyname
        from _gridex_old_permissive_policies
        where schemaname = v_table.schemaname
          and tablename = v_table.tablename
        order by policyname
      loop
        execute format(
          'drop policy if exists %I on %I.%I',
          v_old_policy.policyname,
          v_table.schemaname,
          v_table.tablename
        );
        v_dropped := v_dropped + 1;
      end loop;

      v_total_tables := v_total_tables + 1;
      v_total_created := v_total_created + v_created;
      v_total_dropped := v_total_dropped + v_dropped;

      insert into public.gridex_performance_hardening_events(event_key, status, details)
      values (
        'multiple_permissive_policy_consolidated',
        'completed',
        jsonb_build_object(
          'schema', v_table.schemaname,
          'table', v_table.tablename,
          'created_policies', v_created,
          'dropped_policies', v_dropped
        )
      );
    exception when others then
      insert into public.gridex_performance_hardening_events(event_key, status, details)
      values (
        'multiple_permissive_policy_consolidated',
        'skipped',
        jsonb_build_object(
          'schema', v_table.schemaname,
          'table', v_table.tablename,
          'error', sqlerrm
        )
      );
    end;
  end loop;

  insert into public.gridex_performance_hardening_events(event_key, status, details)
  values (
    'multiple_permissive_policy_consolidation_summary',
    'completed',
    jsonb_build_object(
      'tables_processed', v_total_tables,
      'created_policies', v_total_created,
      'dropped_policies', v_total_dropped
    )
  );
end $$;

-- Refresh the candidate view after consolidation.
create or replace view public.gridex_multiple_permissive_policy_candidates_v as
with role_candidates as (
  select rolname::text as role_name
  from pg_roles
  where rolname in (
    'anon',
    'authenticated',
    'service_role',
    'authenticator',
    'dashboard_user',
    'supabase_privileged_role'
  )
  union
  select distinct unnest(roles)::text as role_name
  from pg_policies
  where schemaname = 'public'
), expanded as (
  select
    p.schemaname,
    p.tablename,
    a.action_name,
    r.role_name,
    p.policyname
  from pg_policies p
  join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as a(action_name)
    on p.cmd = 'ALL' or p.cmd = a.action_name
  join role_candidates r
    on 'public' = any(p.roles::text[])
    or r.role_name = any(p.roles::text[])
  where p.schemaname = 'public'
    and p.permissive = 'PERMISSIVE'
)
select
  schemaname,
  tablename,
  action_name,
  role_name,
  count(*) as policy_count,
  array_agg(policyname order by policyname) as policies
from expanded
group by schemaname, tablename, action_name, role_name
having count(*) > 1;

-- 2) Drop structurally duplicate indexes when safe.
do $$
declare
  v_group record;
  v_drop record;
  v_keep_oid oid;
  v_dropped integer := 0;
  v_skipped integer := 0;
begin
  for v_group in
    with index_catalog as (
      select
        ns.nspname as schema_name,
        tbl.relname as table_name,
        idx.relname as index_name,
        i.indexrelid,
        i.indrelid,
        i.indisunique,
        i.indisprimary,
        i.indisexclusion,
        i.indimmediate,
        i.indisvalid,
        i.indnkeyatts,
        i.indnatts,
        am.amname as access_method,
        i.indkey::text as indkey,
        coalesce(pg_get_expr(i.indexprs, i.indrelid), '') as indexprs,
        coalesce(pg_get_expr(i.indpred, i.indrelid), '') as indpred,
        i.indcollation::text as indcollation,
        i.indclass::text as indclass,
        i.indoption::text as indoption,
        exists (select 1 from pg_constraint c where c.conindid = i.indexrelid) as backs_constraint
      from pg_index i
      join pg_class idx on idx.oid = i.indexrelid
      join pg_class tbl on tbl.oid = i.indrelid
      join pg_namespace ns on ns.oid = tbl.relnamespace
      join pg_am am on am.oid = idx.relam
      where ns.nspname = 'public'
        and not i.indisprimary
        and i.indisvalid
    ), duplicate_groups as (
      select
        schema_name,
        table_name,
        indisunique,
        indisprimary,
        indisexclusion,
        indimmediate,
        indnkeyatts,
        indnatts,
        access_method,
        indkey,
        indexprs,
        indpred,
        indcollation,
        indclass,
        indoption,
        array_agg(indexrelid order by backs_constraint desc, length(index_name), index_name) as index_oids,
        array_agg(index_name order by backs_constraint desc, length(index_name), index_name) as index_names,
        count(*) as index_count
      from index_catalog
      group by
        schema_name,
        table_name,
        indisunique,
        indisprimary,
        indisexclusion,
        indimmediate,
        indnkeyatts,
        indnatts,
        access_method,
        indkey,
        indexprs,
        indpred,
        indcollation,
        indclass,
        indoption
      having count(*) > 1
    )
    select * from duplicate_groups
  loop
    v_keep_oid := v_group.index_oids[1];

    for v_drop in
      select
        idx.oid as index_oid,
        n.nspname as schema_name,
        idx.relname as index_name,
        exists (select 1 from pg_constraint c where c.conindid = idx.oid) as backs_constraint
      from unnest(v_group.index_oids) as oid_list(index_oid)
      join pg_class idx on idx.oid = oid_list.index_oid
      join pg_namespace n on n.oid = idx.relnamespace
      where idx.oid <> v_keep_oid
    loop
      begin
        if v_drop.backs_constraint then
          v_skipped := v_skipped + 1;
          insert into public.gridex_performance_hardening_events(event_key, status, details)
          values (
            'duplicate_index_cleanup',
            'skipped',
            jsonb_build_object(
              'index', v_drop.index_name,
              'reason', 'backs_constraint',
              'kept_index_oid', v_keep_oid::text
            )
          );
          continue;
        end if;

        execute format('drop index if exists %I.%I', v_drop.schema_name, v_drop.index_name);
        v_dropped := v_dropped + 1;

        insert into public.gridex_performance_hardening_events(event_key, status, details)
        values (
          'duplicate_index_cleanup',
          'completed',
          jsonb_build_object(
            'dropped_index', v_drop.index_name,
            'kept_index_oid', v_keep_oid::text,
            'table', v_group.schema_name || '.' || v_group.table_name
          )
        );
      exception when others then
        v_skipped := v_skipped + 1;
        insert into public.gridex_performance_hardening_events(event_key, status, details)
        values (
          'duplicate_index_cleanup',
          'skipped',
          jsonb_build_object(
            'index', v_drop.index_name,
            'error', sqlerrm
          )
        );
      end;
    end loop;
  end loop;

  insert into public.gridex_performance_hardening_events(event_key, status, details)
  values (
    'duplicate_index_cleanup_summary',
    'completed',
    jsonb_build_object(
      'dropped_indexes', v_dropped,
      'skipped_indexes', v_skipped
    )
  );
end $$;

create or replace view public.gridex_duplicate_index_candidates_v as
with index_catalog as (
  select
    ns.nspname as schema_name,
    tbl.relname as table_name,
    idx.relname as index_name,
    i.indexrelid,
    i.indisunique,
    i.indisprimary,
    i.indisexclusion,
    i.indimmediate,
    i.indisvalid,
    i.indnkeyatts,
    i.indnatts,
    am.amname as access_method,
    i.indkey::text as indkey,
    coalesce(pg_get_expr(i.indexprs, i.indrelid), '') as indexprs,
    coalesce(pg_get_expr(i.indpred, i.indrelid), '') as indpred,
    i.indcollation::text as indcollation,
    i.indclass::text as indclass,
    i.indoption::text as indoption,
    exists (select 1 from pg_constraint c where c.conindid = i.indexrelid) as backs_constraint
  from pg_index i
  join pg_class idx on idx.oid = i.indexrelid
  join pg_class tbl on tbl.oid = i.indrelid
  join pg_namespace ns on ns.oid = tbl.relnamespace
  join pg_am am on am.oid = idx.relam
  where ns.nspname = 'public'
    and not i.indisprimary
    and i.indisvalid
), duplicate_groups as (
  select
    schema_name,
    table_name,
    indisunique,
    indisprimary,
    indisexclusion,
    indimmediate,
    indnkeyatts,
    indnatts,
    access_method,
    indkey,
    indexprs,
    indpred,
    indcollation,
    indclass,
    indoption,
    array_agg(index_name order by backs_constraint desc, length(index_name), index_name) as index_names,
    count(*) as index_count
  from index_catalog
  group by
    schema_name,
    table_name,
    indisunique,
    indisprimary,
    indisexclusion,
    indimmediate,
    indnkeyatts,
    indnatts,
    access_method,
    indkey,
    indexprs,
    indpred,
    indcollation,
    indclass,
    indoption
  having count(*) > 1
)
select * from duplicate_groups;

insert into public.gridex_performance_hardening_events(event_key, status, details)
values (
  'performance_policy_consolidation_and_index_cleanup',
  'completed',
  jsonb_build_object(
    'migration', '20260612143000_performance_policy_consolidation_and_index_cleanup',
    'multiple_policy_candidates_remaining_view', 'gridex_multiple_permissive_policy_candidates_v',
    'duplicate_index_candidates_remaining_view', 'gridex_duplicate_index_candidates_v'
  )
);
