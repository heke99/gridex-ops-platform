do $migration$
declare
  v_def text;
  v_start int;
  v_rel_end int;
  v_old_count int;
  v_new_count int;
  v_old_minus_new int;
  v_new_minus_old int;
  v_multi int;
  v_new_block text := $block$    with matched as materialized (
      select pgo.id as pgo_id, g.id as grid_owner_id
      from public.platform_grid_owners pgo
      join public.grid_owners g on pgo.id = g.platform_grid_owner_id

      union

      select pgo.id, g.id
      from public.platform_grid_owners pgo
      join public.grid_owners g
        on g.ediel_id is not null
       and pgo.ediel_id = g.ediel_id

      union

      select pgo.id, g.id
      from public.platform_grid_owners pgo
      join public.grid_owners g
        on lower(regexp_replace(coalesce(pgo.name,''), '\s+', ' ', 'g'))
         = lower(regexp_replace(coalesce(g.name,''), '\s+', ' ', 'g'))
    )
    update public.platform_grid_owners pgo
    set ops_grid_owner_id = g.id,
        updated_at = now(),
        metadata = coalesce(pgo.metadata, '{}'::jsonb) || jsonb_build_object('ops_grid_owner_linked_at', now())
    from matched m
    join public.grid_owners g on g.id = m.grid_owner_id
    where pgo.id = m.pgo_id;$block$;
begin
  with old_matches as (
    select pgo.id as pgo_id, g.id as grid_owner_id
    from public.platform_grid_owners pgo
    join public.grid_owners g
      on (pgo.id = g.platform_grid_owner_id)
      or (g.ediel_id is not null and pgo.ediel_id = g.ediel_id)
      or lower(regexp_replace(coalesce(pgo.name,''), '\s+', ' ', 'g'))
       = lower(regexp_replace(coalesce(g.name,''), '\s+', ' ', 'g'))
  ), new_matches as (
    select pgo.id as pgo_id, g.id as grid_owner_id
    from public.platform_grid_owners pgo
    join public.grid_owners g on pgo.id = g.platform_grid_owner_id
    union
    select pgo.id, g.id
    from public.platform_grid_owners pgo
    join public.grid_owners g on g.ediel_id is not null and pgo.ediel_id = g.ediel_id
    union
    select pgo.id, g.id
    from public.platform_grid_owners pgo
    join public.grid_owners g
      on lower(regexp_replace(coalesce(pgo.name,''), '\s+', ' ', 'g'))
       = lower(regexp_replace(coalesce(g.name,''), '\s+', ' ', 'g'))
  ), multi as (
    select pgo_id from old_matches group by pgo_id having count(*) > 1
  )
  select
    (select count(*) from old_matches),
    (select count(*) from new_matches),
    (select count(*) from (select * from old_matches except select * from new_matches) d),
    (select count(*) from (select * from new_matches except select * from old_matches) d),
    (select count(*) from multi)
  into v_old_count, v_new_count, v_old_minus_new, v_new_minus_old, v_multi;

  if v_old_count <> v_new_count or v_old_minus_new <> 0 or v_new_minus_old <> 0 or v_multi <> 0 then
    raise exception 'Regression guard failed: old %, new %, old-new %, new-old %, ambiguous %',
      v_old_count, v_new_count, v_old_minus_new, v_new_minus_old, v_multi;
  end if;

  select pg_get_functiondef('public.gridex_backfill_grid_owner_verification(text)'::regprocedure)
  into v_def;

  v_start := position('    update public.platform_grid_owners pgo' in v_def);
  if v_start = 0 then
    raise exception 'Target update block not found in gridex_backfill_grid_owner_verification(text)';
  end if;

  v_rel_end := position(E'\n  end if;' in substring(v_def from v_start));
  if v_rel_end = 0 then
    raise exception 'Could not locate end of target platform_grid_owners update block';
  end if;

  v_def := substring(v_def from 1 for v_start - 1)
           || v_new_block
           || substring(v_def from v_start + v_rel_end - 1);

  execute v_def;
end
$migration$;
