-- Align the OPS health certificate status gate with the strict outbound certificate resolver.
-- `renewal_available` remains usable for S/MIME while the certificate is still within its
-- validity window. The send path already accepts that status; health must not report a
-- false blocking condition for the same certificate.
--
-- Forward-only and fail-closed: patch exactly the canonical predicate in the installed
-- v2 health function and abort if its shape has drifted.

begin;

set local search_path = public, pg_catalog;

do $migration$
declare
  v_definition text;
  v_patched text;
  v_old text := $old$coalesce(c.status,'') not in ('valid','active')$old$;
  v_new text := $new$coalesce(c.status,'') not in ('valid','active','renewal_available')$new$;
begin
  if to_regprocedure('public.gridex_ops_health_checks_v2()') is null then
    raise exception 'gridex_ops_health_checks_v2() is missing; cannot align certificate status gate';
  end if;

  select pg_get_functiondef('public.gridex_ops_health_checks_v2()'::regprocedure)
    into v_definition;

  if position(v_new in v_definition) > 0 then
    return;
  end if;

  if position(v_old in v_definition) = 0 then
    raise exception 'gridex_ops_health_checks_v2() certificate status predicate did not match expected canonical shape';
  end if;

  v_patched := replace(v_definition, v_old, v_new);

  if v_patched = v_definition or position(v_new in v_patched) = 0 then
    raise exception 'gridex_ops_health_checks_v2() certificate status alignment did not materialize';
  end if;

  execute v_patched;
end;
$migration$;

commit;
