-- Forward-only hardening of grid-owner verification backfill.
-- Prevent ambiguous verified-view fan-out and ambiguous platform↔OPS matches
-- from persisting nondeterministic links or readiness state.

CREATE OR REPLACE FUNCTION public.gridex_backfill_grid_owner_verification(p_source text DEFAULT 'manual'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_inserted_grid_owners int := 0;
  v_inserted_platform_grid_owners int := 0;
  v_updated_grid_owners int := 0;
  v_review_items int := 0;
begin
  if to_regclass('public.platform_grid_owners') is not null then
    insert into public.platform_grid_owners(name, org_number, ediel_id, communication_email, source, metadata, market_actor_id, updated_at)
    select distinct
      a.name,
      a.org_number,
      ai.ediel_id,
      nullif(coalesce(r.communication_address, ''), ''),
      'actor_registry_backfill',
      jsonb_build_object('backfill_source', p_source, 'platform_actor_id', a.id),
      a.id,
      now()
    from public.platform_market_actors a
    join public.platform_actor_roles ar on ar.actor_id = a.id and coalesce(ar.is_active, true) = true
    left join lateral (
      select max(identifier_value) filter (where lower(identifier_type) in ('edielid','ediel_id')) as ediel_id
      from public.platform_actor_identifiers i where i.actor_id = a.id
    ) ai on true
    left join lateral (
      select communication_address
      from public.platform_actor_routes r
      where r.actor_id = a.id and nullif(btrim(coalesce(r.communication_address,'')), '') is not null
      order by case when r.environment = 'production' then 0 else 1 end, updated_at desc nulls last
      limit 1
    ) r on true
    where lower(ar.actor_role) in ('grid_owner','network_owner','netowner','dso','distribution_system_operator','nätägare','elnatsforetag','elnätsföretag')
      and not exists (
        select 1 from public.platform_grid_owners pgo
        where ai.ediel_id is not null and pgo.ediel_id = ai.ediel_id
      )
      and not exists (
        select 1 from public.platform_grid_owners pgo
        where lower(regexp_replace(coalesce(pgo.name,''), '\s+', ' ', 'g'))
            = lower(regexp_replace(coalesce(a.name,''), '\s+', ' ', 'g'))
      );
    get diagnostics v_inserted_platform_grid_owners = row_count;
  end if;

  insert into public.grid_owners(name, owner_code, ediel_id, org_number, communication_email, email, contact_name, country, environment, lifecycle_status, platform_market_actor_id, platform_grid_owner_id, is_active, notes, verification_metadata, created_at, updated_at)
  select distinct
    a.name,
    coalesce(ai.ediel_id, regexp_replace(lower(a.name), '[^a-z0-9]+', '_', 'g')),
    ai.ediel_id,
    coalesce(ai.registry_org_number, a.org_number),
    route.communication_address,
    route.communication_address,
    null,
    'SE',
    coalesce(route.environment, 'production'),
    'active',
    a.id,
    pgo.id,
    true,
    'Importerad/synkad från platform actor registry.',
    jsonb_build_object('backfill_source', p_source, 'platform_actor_id', a.id, 'platform_grid_owner_id', pgo.id),
    now(),
    now()
  from public.platform_market_actors a
  join public.platform_actor_roles ar on ar.actor_id = a.id and coalesce(ar.is_active, true) = true
  left join lateral (
    select
      max(identifier_value) filter (where lower(identifier_type) in ('edielid','ediel_id')) as ediel_id,
      max(identifier_value) filter (where lower(identifier_type) in ('orgno','org_number','orgnr')) as registry_org_number
    from public.platform_actor_identifiers i where i.actor_id = a.id
  ) ai on true
  left join lateral (
    select environment, communication_address
    from public.platform_actor_routes r
    where r.actor_id = a.id
    order by case when r.environment = 'production' then 0 else 1 end, updated_at desc nulls last
    limit 1
  ) route on true
  left join public.platform_grid_owners pgo
    on pgo.market_actor_id = a.id
    or (ai.ediel_id is not null and pgo.ediel_id = ai.ediel_id)
    or lower(regexp_replace(coalesce(pgo.name,''), '\s+', ' ', 'g')) = lower(regexp_replace(coalesce(a.name,''), '\s+', ' ', 'g'))
  where lower(ar.actor_role) in ('grid_owner','network_owner','netowner','dso','distribution_system_operator','nätägare','elnatsforetag','elnätsföretag')
    and not exists (select 1 from public.grid_owners g where ai.ediel_id is not null and g.ediel_id = ai.ediel_id)
    and not exists (select 1 from public.grid_owners g where a.org_number is not null and g.org_number = a.org_number)
    and not exists (
      select 1 from public.grid_owners g
      where lower(regexp_replace(coalesce(g.name,''), '\s+', ' ', 'g'))
          = lower(regexp_replace(coalesce(a.name,''), '\s+', ' ', 'g'))
    );
  get diagnostics v_inserted_grid_owners = row_count;

  with unique_verified as (
    select v.*
    from public.gridex_verified_grid_owners_v v
    join (
      select grid_owner_id
      from public.gridex_verified_grid_owners_v
      group by grid_owner_id
      having count(*) = 1
    ) u on u.grid_owner_id = v.grid_owner_id
  )
  update public.grid_owners g
  set platform_market_actor_id = coalesce(g.platform_market_actor_id, uv.platform_market_actor_id),
      platform_grid_owner_id = coalesce(g.platform_grid_owner_id, uv.platform_grid_owner_id),
      ediel_id = coalesce(nullif(g.ediel_id, ''), uv.ediel_id),
      org_number = coalesce(nullif(g.org_number, ''), uv.org_number),
      updated_at = now()
  from unique_verified uv
  where uv.grid_owner_id = g.id
    and (
      g.platform_market_actor_id is distinct from coalesce(g.platform_market_actor_id, uv.platform_market_actor_id)
      or g.platform_grid_owner_id is distinct from coalesce(g.platform_grid_owner_id, uv.platform_grid_owner_id)
      or g.ediel_id is distinct from coalesce(nullif(g.ediel_id, ''), uv.ediel_id)
      or g.org_number is distinct from coalesce(nullif(g.org_number, ''), uv.org_number)
    );

  if to_regclass('public.platform_grid_owners') is not null then
    with matched as materialized (
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
    ),
    classified as (
      select
        m.pgo_id,
        count(distinct m.grid_owner_id)::integer as match_count,
        case when count(distinct m.grid_owner_id) = 1 then min(m.grid_owner_id::text)::uuid else null::uuid end as grid_owner_id
      from matched m
      group by m.pgo_id
    ),
    target_counts as (
      select c.grid_owner_id, count(*)::integer as target_count
      from classified c
      where c.match_count = 1 and c.grid_owner_id is not null
      group by c.grid_owner_id
    ),
    unique_matched as (
      select c.pgo_id, c.grid_owner_id
      from classified c
      join target_counts tc on tc.grid_owner_id = c.grid_owner_id
      where c.match_count = 1 and c.grid_owner_id is not null and tc.target_count = 1
    )
    update public.platform_grid_owners pgo
    set ops_grid_owner_id = g.id,
        updated_at = now(),
        metadata = coalesce(pgo.metadata, '{}'::jsonb) || jsonb_build_object('ops_grid_owner_linked_at', now())
    from unique_matched m
    join public.grid_owners g on g.id = m.grid_owner_id
    where pgo.id = m.pgo_id
      and (
        pgo.ops_grid_owner_id is distinct from g.id
        or not (coalesce(pgo.metadata, '{}'::jsonb) ? 'ops_grid_owner_linked_at')
      );
  end if;

  with unique_verified as (
    select v.*
    from public.gridex_verified_grid_owners_v v
    join (
      select grid_owner_id
      from public.gridex_verified_grid_owners_v
      group by grid_owner_id
      having count(*) = 1
    ) u on u.grid_owner_id = v.grid_owner_id
  )
  update public.grid_owners g
  set verification_status = uv.verification_status,
      verification_reasons = uv.verification_reasons,
      certificate_status = uv.certificate_status,
      certificate_environment = uv.certificate_environment,
      certificate_fingerprint_sha256 = uv.certificate_fingerprint_sha256,
      route_status = uv.route_status,
      route_count = uv.route_count,
      prodat_route_count = uv.prodat_route_count,
      utilts_route_count = uv.utilts_route_count,
      duplicate_group_key = uv.duplicate_key,
      duplicate_count = uv.duplicate_count,
      verified_for_customer_flow = uv.verified_for_customer_flow,
      actor_registry_status = uv.actor_registry_status,
      verified_at = case when uv.verified_for_customer_flow and g.verified_at is null then now() else g.verified_at end,
      verification_checked_at = now(),
      verification_metadata = coalesce(g.verification_metadata, '{}'::jsonb) || jsonb_build_object(
        'last_backfill_source', p_source,
        'last_backfill_at', now(),
        'next_action', uv.next_action,
        'platform_market_actor_id', uv.platform_market_actor_id,
        'actor_roles', uv.actor_roles
      ),
      updated_at = now()
  from unique_verified uv
  where uv.grid_owner_id = g.id;
  get diagnostics v_updated_grid_owners = row_count;

  with unique_verified as (
    select v.*
    from public.gridex_verified_grid_owners_v v
    join (
      select grid_owner_id
      from public.gridex_verified_grid_owners_v
      group by grid_owner_id
      having count(*) = 1
    ) u on u.grid_owner_id = v.grid_owner_id
  )
  insert into public.grid_owner_verification_reviews(grid_owner_id, platform_market_actor_id, issue_type, severity, status, message, metadata)
  select uv.grid_owner_id, uv.platform_market_actor_id, uv.verification_status,
         case when uv.verification_status in ('unresolved_duplicate','needs_ediel_id','needs_route','needs_subaddress','needs_certificate') then 'blocking' else 'warning' end,
         'open', uv.next_action,
         jsonb_build_object('verification_reasons', uv.verification_reasons, 'certificate_status', uv.certificate_status, 'route_count', uv.route_count, 'duplicate_count', uv.duplicate_count, 'backfill_source', p_source)
  from unique_verified uv
  where uv.verification_status <> 'verified'
    and not exists (
      select 1 from public.grid_owner_verification_reviews r
      where r.grid_owner_id = uv.grid_owner_id and r.issue_type = uv.verification_status and r.status = 'open'
    );
  get diagnostics v_review_items = row_count;

  return jsonb_build_object(
    'ok', true,
    'inserted_platform_grid_owners', v_inserted_platform_grid_owners,
    'inserted_grid_owners', v_inserted_grid_owners,
    'updated_grid_owners', v_updated_grid_owners,
    'created_review_items', v_review_items
  );
end;
$function$;

revoke execute on function public.gridex_backfill_grid_owner_verification(text) from public;
revoke execute on function public.gridex_backfill_grid_owner_verification(text) from anon;
revoke execute on function public.gridex_backfill_grid_owner_verification(text) from authenticated;
grant execute on function public.gridex_backfill_grid_owner_verification(text) to service_role;
