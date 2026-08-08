-- GRIDEX-AUD-008: avoid the measured N×actor fallback scan for already-linked grid owners.
--
-- The canonical view historically allowed fallback matching by EDIEL id, org number or name even
-- when grid_owners.platform_market_actor_id was already populated. In the audited dataset 182/183
-- grid owners already have a direct actor link. The old OR join therefore scanned/materialized the
-- actor registry for every grid owner and could also produce duplicate matches for directly-linked
-- rows. The fallback is only semantically necessary when the direct actor link is absent.
--
-- This migration intentionally patches only that single JOIN signature. It fails closed if the
-- canonical view shape has drifted, rather than guessing or silently rewriting a different view.

set local search_path = public, pg_catalog;

do $migration$
declare
  v_definition text;
  v_patched text;
  v_join_pattern text := '(?s)LEFT JOIN platform_market_actors a ON .*?\n             LEFT JOIN actor_ids ai';
  v_join_replacement text := $join$
LEFT JOIN public.platform_market_actors a ON
               a.id = g.platform_market_actor_id
               OR (
                 g.platform_market_actor_id IS NULL
                 AND (
                   (
                     NULLIF(btrim(g.ediel_id), ''::text) IS NOT NULL
                     AND EXISTS (
                       SELECT 1
                       FROM public.platform_actor_identifiers i
                       WHERE i.actor_id = a.id
                         AND lower(i.identifier_type) = ANY (ARRAY['edielid'::text, 'ediel_id'::text])
                         AND i.identifier_value = g.ediel_id
                     )
                   )
                   OR (
                     NULLIF(btrim(g.org_number), ''::text) IS NOT NULL
                     AND regexp_replace(COALESCE(a.org_number, ''::text), '[^0-9]'::text, ''::text, 'g'::text)
                       = regexp_replace(g.org_number, '[^0-9]'::text, ''::text, 'g'::text)
                   )
                   OR lower(regexp_replace(COALESCE(a.name, ''::text), '[[:space:]]+'::text, ' '::text, 'g'::text))
                     = lower(regexp_replace(COALESCE(g.name, ''::text), '[[:space:]]+'::text, ' '::text, 'g'::text))
                 )
               )
             LEFT JOIN actor_ids ai$join$;
begin
  if to_regclass('public.gridex_verified_grid_owners_v') is null then
    raise exception 'gridex_verified_grid_owners_v is missing; cannot apply AUD-008 join optimization';
  end if;

  select pg_get_viewdef('public.gridex_verified_grid_owners_v'::regclass, true)
    into v_definition;

  if v_definition like '%g.platform_market_actor_id IS NULL%' then
    return;
  end if;

  v_patched := regexp_replace(v_definition, v_join_pattern, v_join_replacement);

  if v_patched = v_definition then
    raise exception 'gridex_verified_grid_owners_v canonical actor join signature was not found';
  end if;

  if v_patched not like '%g.platform_market_actor_id IS NULL%' then
    raise exception 'gridex_verified_grid_owners_v actor join optimization did not materialize';
  end if;

  execute 'create or replace view public.gridex_verified_grid_owners_v with (security_invoker = true) as ' || v_patched;
end;
$migration$;

comment on view public.gridex_verified_grid_owners_v is
  'Canonical grid-owner verification view. Direct platform_market_actor_id is authoritative; EDIEL/org/name fallback matching runs only when the direct actor link is absent, preventing duplicate fallback matches and the measured full actor-registry OR scan.';
