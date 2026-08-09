-- GRIDEX-OPS-O-008 — keep actor readiness conflict counts accurate under security_invoker.
--
-- After GRIDEX-OPS-BL-002, actor_registry_conflicts SELECT is limited to platform admins
-- and service_role. actor_readiness_status remains security_invoker, so ordinary and
-- company-admin JWTs silently under-count open blocking conflicts and can observe false
-- readiness through dependent views such as gridex_verified_grid_owners_v.
--
-- Fix: expose only aggregated conflict counts through a SECURITY DEFINER helper in the
-- non-PostgREST gridex_private schema and patch the conflicts CTE in actor_readiness_status
-- to use that helper. Conflict row details stay admin/service-role only. Historical
-- migrations are not rewritten.

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

create schema if not exists gridex_private;
revoke all on schema gridex_private from public, anon;
grant usage on schema gridex_private to authenticated, service_role;

create or replace function gridex_private.gridex_actor_open_blocking_conflict_counts()
returns table (
  actor_id uuid,
  open_blocking_conflicts integer
)
language sql
stable
security definer
set search_path = pg_catalog, gridex_private, pg_temp
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

comment on function gridex_private.gridex_actor_open_blocking_conflict_counts() is
  'GRIDEX-OPS-O-008: non-API aggregate of open blocking conflict counts for readiness views. Returns no conflict row payloads.';

revoke all on function gridex_private.gridex_actor_open_blocking_conflict_counts()
from public, anon, authenticated, service_role;
grant execute on function gridex_private.gridex_actor_open_blocking_conflict_counts()
to authenticated, service_role;

do $migration$
declare
  v_definition text;
  v_patched text;
  v_pattern text;
  v_match_count integer;
  v_replacement text := $repl$conflicts AS (
         SELECT actor_id,
            open_blocking_conflicts
           FROM gridex_private.gridex_actor_open_blocking_conflict_counts()
        )$repl$;
  v_patterns text[] := array[
    -- production pg_get_viewdef shape with qualified actor_registry_conflicts columns
    $p0$(?is)conflicts\s+as\s*\(\s*select\s+(?:(?:public\.)?actor_registry_conflicts\.)?actor_id\s*,\s*\(?count\(\*\)\)?::integer\s+as\s+open_blocking_conflicts\s+from\s+(?:public\.)?actor_registry_conflicts\s+where\s+(?:(?:public\.)?actor_registry_conflicts\.)?status\s*=\s*'open'(?:::text)?\s+and\s+(?:(?:public\.)?actor_registry_conflicts\.)?severity\s*=\s*'blocking'(?:::text)?\s+and\s+(?:(?:public\.)?actor_registry_conflicts\.)?actor_id\s+is\s+not\s+null\s+group\s+by\s+(?:(?:public\.)?actor_registry_conflicts\.)?actor_id\s*\)$p0$,
    -- pg_get_viewdef(pretty) common shape
    $p1$(?is)conflicts\s+as\s*\(\s*select\s+actor_id\s*,\s*\(count\(\*\)\)::integer\s+as\s+open_blocking_conflicts\s+from\s+(?:public\.)?actor_registry_conflicts\s+where\s*\(\(status\s*=\s*'open'::text\)\s+and\s+\(severity\s*=\s*'blocking'::text\)\s+and\s+\(actor_id\s+is\s+not\s+null\)\)\s+group\s+by\s+actor_id\s*\)$p1$,
    -- source-shaped migration text
    $p2$(?is)conflicts\s+as\s*\(\s*select\s+actor_id\s*,\s*count\(\*\)::integer\s+as\s+open_blocking_conflicts\s+from\s+(?:public\.)?actor_registry_conflicts\s+where\s+status\s*=\s*'open'\s+and\s+severity\s*=\s*'blocking'\s+and\s+actor_id\s+is\s+not\s+null\s+group\s+by\s+actor_id\s*\)$p2$,
    -- tolerant fallback: any conflicts CTE that still scans actor_registry_conflicts
    $p3$(?is)conflicts\s+as\s*\(\s*select\s+(?:(?:public\.)?actor_registry_conflicts\.)?actor_id\s*,\s*\(?count\(\*\)\)?::integer\s+as\s+open_blocking_conflicts\s+from\s+(?:public\.)?actor_registry_conflicts\s+where[\s\S]+?group\s+by\s+(?:(?:public\.)?actor_registry_conflicts\.)?actor_id\s*\)$p3$
  ];
begin
  select pg_get_viewdef('public.actor_readiness_status'::regclass, true)
    into v_definition;

  if v_definition ~* 'gridex_private\.gridex_actor_open_blocking_conflict_counts\s*\(' then
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
     or v_patched !~* 'gridex_private\.gridex_actor_open_blocking_conflict_counts\s*\('
     or v_patched ~* 'from\s+(?:public\.)?actor_registry_conflicts' then
    raise exception 'actor_readiness_status conflict-count helper patch did not materialize cleanly';
  end if;

  execute 'create or replace view public.actor_readiness_status with (security_invoker = true) as ' || v_patched;
end;
$migration$;

comment on view public.actor_readiness_status is
  'Role-aware actor readiness. Open blocking conflict counts come from gridex_private.gridex_actor_open_blocking_conflict_counts() so security_invoker callers cannot under-count conflicts after BL-002 RLS hardening.';

-- Dashboard/role views that application code already reads via service_role. Revoke
-- authenticated SELECT so PostgREST cannot serve under-privileged direct reads of those
-- summaries. actor_readiness_status and gridex_verified_grid_owners_v remain granted to
-- authenticated because company-scoped admin pages read the verified grid-owner view under RLS.
revoke select on
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

commit;
