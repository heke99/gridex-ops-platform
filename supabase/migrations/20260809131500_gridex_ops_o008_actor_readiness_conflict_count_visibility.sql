-- GRIDEX-OPS-O-008 — keep actor readiness conflict counts accurate after BL-002.
--
-- actor_readiness_status is SECURITY INVOKER and must remain readable by authenticated
-- company flows, but its historical conflicts CTE reads actor_registry_conflicts directly.
-- BL-002 correctly hides those conflict rows from non-platform-admin JWTs, which means the
-- view can otherwise under-count blockers and report false readiness.
--
-- Fix: expose only aggregate blocker counts through a SECURITY DEFINER helper in a
-- non-exposed schema, patch the view to use that helper, and remove direct authenticated/
-- anonymous access to service-only readiness dashboard summaries. Historical migrations
-- remain immutable.

begin;

set local search_path = public, pg_catalog;

do $$
begin
  if to_regclass('public.actor_readiness_status') is null then
    raise exception 'actor_readiness_status_missing';
  end if;
  if to_regclass('public.actor_registry_conflicts') is null then
    raise exception 'actor_registry_conflicts_missing';
  end if;
end;
$$;

create schema if not exists gridex_internal;
revoke all on schema gridex_internal from public, anon;
grant usage on schema gridex_internal to authenticated, service_role;

create or replace function gridex_internal.actor_open_blocking_conflict_counts()
returns table (
  actor_id uuid,
  open_blocking_conflicts integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.actor_id,
    count(*)::integer as open_blocking_conflicts
  from public.actor_registry_conflicts c
  where c.status = 'open'
    and c.severity = 'blocking'
    and c.actor_id is not null
  group by c.actor_id;
$$;

comment on function gridex_internal.actor_open_blocking_conflict_counts() is
  'GRIDEX-OPS-O-008: internal aggregate-only open blocking conflict counts for readiness views.';

revoke all on function gridex_internal.actor_open_blocking_conflict_counts() from public, anon;
grant execute on function gridex_internal.actor_open_blocking_conflict_counts() to authenticated, service_role;

do $migration$
declare
  v_definition text;
  v_patched text;
  v_pattern text;
  v_match_count integer;
  v_replacement text := $repl$conflicts AS (
         SELECT actor_id,
            open_blocking_conflicts
           FROM gridex_internal.actor_open_blocking_conflict_counts()
        )$repl$;
  v_patterns text[] := array[
    $p1$(?is)conflicts\s+as\s*\(\s*select\s+(?:actor_registry_conflicts\.)?actor_id\s*,\s*\(count\(\*\)\)::integer\s+as\s+open_blocking_conflicts\s+from\s+(?:public\.)?actor_registry_conflicts\s+where\s*(?:(?:actor_registry_conflicts\.)?status\s*=\s*'open'(?:::text)?\s+and\s+(?:actor_registry_conflicts\.)?severity\s*=\s*'blocking'(?:::text)?\s+and\s+(?:actor_registry_conflicts\.)?actor_id\s+is\s+not\s+null)\s+group\s+by\s+(?:actor_registry_conflicts\.)?actor_id\s*\)$p1$,
    $p2$(?is)conflicts\s+as\s*\(\s*select\s+(?:actor_registry_conflicts\.)?actor_id\s*,\s*count\(\*\)::integer\s+as\s+open_blocking_conflicts\s+from\s+(?:public\.)?actor_registry_conflicts\s+where[\s\S]+?group\s+by\s+(?:actor_registry_conflicts\.)?actor_id\s*\)$p2$
  ];
begin
  select pg_get_viewdef('public.actor_readiness_status'::regclass, true)
    into v_definition;

  if v_definition ~* 'gridex_internal\.actor_open_blocking_conflict_counts\s*\(' then
    return;
  end if;

  v_patched := null;
  foreach v_pattern in array v_patterns loop
    select count(*)
      into v_match_count
    from regexp_matches(v_definition, v_pattern, 'g');

    if v_match_count = 1 then
      v_patched := regexp_replace(v_definition, v_pattern, v_replacement);
      exit;
    end if;
  end loop;

  if v_patched is null
     or v_patched = v_definition
     or v_patched !~* 'gridex_internal\.actor_open_blocking_conflict_counts\s*\('
     or v_patched ~* 'from\s+(?:public\.)?actor_registry_conflicts' then
    raise exception 'actor_readiness_status conflict-count helper patch did not materialize cleanly';
  end if;

  execute 'create or replace view public.actor_readiness_status with (security_invoker = true) as ' || v_patched;
end;
$migration$;

comment on view public.actor_readiness_status is
  'Role-aware actor readiness. Blocking conflict counts use an aggregate-only internal helper so BL-002 row isolation cannot cause false readiness.';

-- actor_readiness_status is required by authenticated company/customer flows through
-- gridex_verified_grid_owners_v. Keep SELECT only; remove inherited/default write-like
-- privileges. Anonymous users have no direct readiness-view use case.
revoke all privileges on public.actor_readiness_status from anon, authenticated;
grant select on public.actor_readiness_status to authenticated, service_role;

-- These dashboard summaries are read by server-side service-role code. They must not be
-- exposed directly to anon/authenticated Data API callers.
revoke all privileges on
  public.actor_readiness_by_role_v,
  public.grid_owner_supplier_switch_readiness_v,
  public.electricity_supplier_readiness_v,
  public.system_supplier_readiness_v,
  public.non_electricity_actor_readiness_v
from anon, authenticated;

grant select on
  public.actor_readiness_by_role_v,
  public.grid_owner_supplier_switch_readiness_v,
  public.electricity_supplier_readiness_v,
  public.system_supplier_readiness_v,
  public.non_electricity_actor_readiness_v
to service_role;

-- Fail closed on accidental public privileged-RPC exposure and on stale view shape.
do $$
declare
  v_definition text;
begin
  if to_regprocedure('public.gridex_actor_open_blocking_conflict_counts()') is not null then
    raise exception 'public_conflict_count_helper_must_not_exist';
  end if;

  if has_schema_privilege('anon', 'gridex_internal', 'USAGE') then
    raise exception 'anon_must_not_have_gridex_internal_usage';
  end if;

  select pg_get_viewdef('public.actor_readiness_status'::regclass, true)
    into v_definition;

  if v_definition !~* 'gridex_internal\.actor_open_blocking_conflict_counts\s*\('
     or v_definition ~* 'from\s+(?:public\.)?actor_registry_conflicts' then
    raise exception 'actor_readiness_status_still_uses_direct_conflict_rows';
  end if;
end;
$$;

commit;
