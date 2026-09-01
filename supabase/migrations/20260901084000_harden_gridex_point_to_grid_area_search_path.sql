-- Forward-only Supabase advisor repair for the canonical SWEREF99 point-to-grid-area helper.
-- The function qualifies extension/public objects explicitly, so an empty search_path is safest.
-- Fail closed if the expected function is missing instead of silently masking migration drift.

set lock_timeout = '5s';
set statement_timeout = '30s';

do $$
begin
  if to_regprocedure('public.gridex_point_to_grid_area(numeric,numeric)') is null then
    raise exception using
      errcode = 'P0002',
      message = 'gridex_point_to_grid_area_missing_before_search_path_hardening';
  end if;

  execute $ddl$
    alter function public.gridex_point_to_grid_area(numeric, numeric)
      set search_path = ''
  $ddl$;
end
$$;
