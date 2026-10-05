do $$
declare
  vdef text;
  before_count bigint;
  after_count bigint;
  before_hash text;
  after_hash text;
  marker text := '), mapped AS (';
  cte_sql text;
  mapped_pos integer;
  from_pos integer;
  actor_ids_pos integer;
  from_marker text := 'FROM grid_owners g';
  actor_ids_marker text := 'LEFT JOIN actor_ids ai';
begin
  select count(*),
         md5(string_agg(row_to_json(v)::text, E'\n' order by v.grid_owner_id::text))
    into before_count, before_hash
  from public.gridex_verified_grid_owners_v v;

  select pg_get_viewdef('public.gridex_verified_grid_owners_v'::regclass, true)
    into vdef;

  if vdef is null then
    raise exception 'gridex_verified_grid_owners_v definition not found';
  end if;

  if (length(vdef) - length(replace(vdef, marker, ''))) / length(marker) <> 1 then
    raise exception 'Expected exactly one mapped CTE marker';
  end if;

  cte_sql := $ctes$), grid_owner_match_keys AS (
         SELECT gk.id AS grid_owner_id,
            gk.platform_market_actor_id,
            gk.ediel_id,
            NULLIF(btrim(gk.ediel_id), ''::text) AS ediel_id_nonblank,
            regexp_replace(gk.org_number, '[^0-9]'::text, ''::text, 'g'::text) AS org_number_norm,
            NULLIF(btrim(gk.org_number), ''::text) IS NOT NULL AS has_org_number,
            lower(regexp_replace(COALESCE(gk.name, ''::text), '[[:space:]]+'::text, ' '::text, 'g'::text)) AS name_norm
           FROM grid_owners gk
        ), actor_match_keys AS (
         SELECT ak.id AS actor_id,
            regexp_replace(COALESCE(ak.org_number, ''::text), '[^0-9]'::text, ''::text, 'g'::text) AS org_number_norm,
            lower(regexp_replace(COALESCE(ak.name, ''::text), '[[:space:]]+'::text, ' '::text, 'g'::text)) AS name_norm
           FROM platform_market_actors ak
        ), ediel_actor_keys AS (
         SELECT DISTINCT ei.actor_id,
            ei.identifier_value AS ediel_id
           FROM platform_actor_identifiers ei
          WHERE lower(ei.identifier_type) = ANY (ARRAY['edielid'::text, 'ediel_id'::text])
        ), actor_match_candidates AS (
         SELECT k.grid_owner_id,
            k.platform_market_actor_id AS actor_id
           FROM grid_owner_match_keys k
          WHERE k.platform_market_actor_id IS NOT NULL
        UNION
         SELECT k.grid_owner_id,
            e.actor_id
           FROM grid_owner_match_keys k
             JOIN ediel_actor_keys e ON e.ediel_id = k.ediel_id
          WHERE k.platform_market_actor_id IS NULL AND k.ediel_id_nonblank IS NOT NULL
        UNION
         SELECT k.grid_owner_id,
            a.actor_id
           FROM grid_owner_match_keys k
             JOIN actor_match_keys a ON a.org_number_norm = k.org_number_norm
          WHERE k.platform_market_actor_id IS NULL AND k.has_org_number
        UNION
         SELECT k.grid_owner_id,
            a.actor_id
           FROM grid_owner_match_keys k
             JOIN actor_match_keys a ON a.name_norm = k.name_norm
          WHERE k.platform_market_actor_id IS NULL
        ), mapped AS ($ctes$;

  vdef := replace(vdef, marker, cte_sql);

  mapped_pos := strpos(vdef, '), mapped AS (');
  if mapped_pos = 0 then
    raise exception 'mapped CTE not found after rewrite';
  end if;

  from_pos := strpos(substr(vdef, mapped_pos), from_marker);
  if from_pos = 0 then
    raise exception 'mapped grid_owners FROM marker not found';
  end if;
  from_pos := mapped_pos + from_pos - 1;

  actor_ids_pos := strpos(substr(vdef, from_pos), actor_ids_marker);
  if actor_ids_pos = 0 then
    raise exception 'actor_ids join marker not found';
  end if;
  actor_ids_pos := from_pos + actor_ids_pos - 1;

  vdef := substr(vdef, 1, from_pos - 1)
       || 'FROM grid_owners g
             LEFT JOIN actor_match_candidates am ON am.grid_owner_id = g.id
             LEFT JOIN platform_market_actors a ON a.id = am.actor_id
             '
       || substr(vdef, actor_ids_pos);

  execute 'CREATE OR REPLACE VIEW public.gridex_verified_grid_owners_v WITH (security_invoker=true) AS ' || vdef;

  select count(*),
         md5(string_agg(row_to_json(v)::text, E'\n' order by v.grid_owner_id::text))
    into after_count, after_hash
  from public.gridex_verified_grid_owners_v v;

  if after_count is distinct from before_count or after_hash is distinct from before_hash then
    raise exception 'Regression detected: before count/hash %/%, after %/%', before_count, before_hash, after_count, after_hash;
  end if;
end
$$;
