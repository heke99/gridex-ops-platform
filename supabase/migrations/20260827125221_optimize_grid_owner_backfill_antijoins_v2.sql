do $migration$
declare
  v_def text;
  v_start int;
  v_rel_end int;
  v_new_pgo text := $new1$      and not exists (
        select 1 from public.platform_grid_owners pgo
        where ai.ediel_id is not null
          and pgo.ediel_id = ai.ediel_id
      )
      and not exists (
        select 1 from public.platform_grid_owners pgo
        where lower(regexp_replace(coalesce(pgo.name,''), '\s+', ' ', 'g'))
            = lower(regexp_replace(coalesce(a.name,''), '\s+', ' ', 'g'))
      );$new1$;
  v_new_grid text := $new2$    and not exists (
      select 1 from public.grid_owners g
      where ai.ediel_id is not null
        and g.ediel_id = ai.ediel_id
    )
    and not exists (
      select 1 from public.grid_owners g
      where a.org_number is not null
        and g.org_number = a.org_number
    )
    and not exists (
      select 1 from public.grid_owners g
      where lower(regexp_replace(coalesce(g.name,''), '\s+', ' ', 'g'))
          = lower(regexp_replace(coalesce(a.name,''), '\s+', ' ', 'g'))
    );$new2$;
begin
  select pg_get_functiondef('public.gridex_backfill_grid_owner_verification(text)'::regprocedure) into v_def;

  -- Replace the later grid_owners anti-join first so earlier offsets remain valid.
  v_start := position('    and not exists ('||E'\n'||'      select 1 from public.grid_owners g' in v_def);
  if v_start = 0 then
    raise exception 'grid_owners anti-join start marker not found';
  end if;
  v_rel_end := position(E'\n  get diagnostics v_inserted_grid_owners' in substring(v_def from v_start));
  if v_rel_end = 0 then
    raise exception 'grid_owners anti-join end marker not found';
  end if;
  v_def := substring(v_def from 1 for v_start - 1)
           || v_new_grid
           || substring(v_def from v_start + v_rel_end - 1);

  -- Replace the earlier platform_grid_owners anti-join.
  v_start := position('      and not exists ('||E'\n'||'        select 1 from public.platform_grid_owners pgo' in v_def);
  if v_start = 0 then
    raise exception 'platform_grid_owners anti-join start marker not found';
  end if;
  v_rel_end := position(E'\n    get diagnostics v_inserted_platform_grid_owners' in substring(v_def from v_start));
  if v_rel_end = 0 then
    raise exception 'platform_grid_owners anti-join end marker not found';
  end if;
  v_def := substring(v_def from 1 for v_start - 1)
           || v_new_pgo
           || substring(v_def from v_start + v_rel_end - 1);

  execute v_def;
end
$migration$;
