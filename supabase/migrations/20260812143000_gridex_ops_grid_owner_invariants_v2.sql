-- Gridex OPS grid-owner integrity convergence v2.
-- Forward-only remediation for already-live v5 reconciliation/performance migrations.
-- Guarantees one platform grid owner per non-null OPS grid owner and removes
-- display-name fallback from canonical duplicate classification.

do $do$
begin
  if exists (
    select 1
    from public.platform_grid_owners
    where ops_grid_owner_id is not null
    group by ops_grid_owner_id
    having count(*) > 1
  ) then
    raise exception 'duplicate platform_grid_owners.ops_grid_owner_id rows must be reconciled before enforcing uniqueness';
  end if;
end
$do$;

create unique index if not exists platform_grid_owners_ops_grid_owner_id_uidx
  on public.platform_grid_owners (ops_grid_owner_id)
  where ops_grid_owner_id is not null;

create or replace function public.gridex_reconcile_grid_owner_mappings_v1(
  p_apply boolean default false
)
returns table (
  platform_grid_owner_id uuid,
  status text,
  candidate_ops_grid_owner_id uuid,
  match_method text,
  candidate_count integer,
  details jsonb
)
language sql
volatile
security definer
set search_path = pg_catalog, public
as $function$
with
unmapped as (
  select
    pgo.id,
    pgo.name,
    pgo.org_number,
    pgo.ediel_id,
    pgo.market_actor_id,
    pgo.metadata
  from public.platform_grid_owners pgo
  where pgo.ops_grid_owner_id is null
    and coalesce(pgo.is_active, true)
),
verified_actors as (
  select a.id
  from public.platform_market_actors a
  where a.match_status = 'verified'
),
verified_identifiers as (
  select
    i.actor_id,
    i.identifier_type,
    i.identifier_value
  from public.platform_actor_identifiers i
  where i.is_verified = true
    and (i.valid_from is null or i.valid_from <= current_date)
    and (i.valid_to is null or i.valid_to >= current_date)
),
candidates as (
  select
    u.id as platform_grid_owner_id,
    g.id as ops_grid_owner_id,
    1 as priority,
    'verified_ediel_id'::text as match_method
  from unmapped u
  join verified_actors va
    on va.id = u.market_actor_id
  join verified_identifiers i
    on i.actor_id = u.market_actor_id
   and i.identifier_type = 'ediel_id'
  join public.grid_owners g
    on nullif(lower(btrim(g.ediel_id)), '') = nullif(lower(btrim(i.identifier_value)), '')
   and coalesce(g.is_active, true)
  where nullif(lower(btrim(u.ediel_id)), '') = nullif(lower(btrim(i.identifier_value)), '')

  union all

  select
    u.id,
    g.id,
    2,
    'verified_organization_number'::text
  from unmapped u
  join verified_actors va
    on va.id = u.market_actor_id
  join verified_identifiers i
    on i.actor_id = u.market_actor_id
   and i.identifier_type = 'organization_number'
  join public.grid_owners g
    on nullif(regexp_replace(coalesce(g.org_number, g.organization_number, ''), '[^0-9]', '', 'g'), '')
       = nullif(regexp_replace(coalesce(i.identifier_value, ''), '[^0-9]', '', 'g'), '')
   and coalesce(g.is_active, true)
  where nullif(regexp_replace(coalesce(u.org_number, ''), '[^0-9]', '', 'g'), '')
        = nullif(regexp_replace(coalesce(i.identifier_value, ''), '[^0-9]', '', 'g'), '')

  union all

  select
    u.id,
    g.id,
    3,
    'verified_actor_identity'::text
  from unmapped u
  join verified_actors va
    on va.id = u.market_actor_id
  join public.grid_owners g
    on g.platform_market_actor_id = u.market_actor_id
   and coalesce(g.is_active, true)

  union all

  select
    u.id,
    g.id,
    4,
    'verified_exact_alias'::text
  from unmapped u
  join public.platform_actor_aliases aa
    on aa.actor_id = u.market_actor_id
   and aa.is_verified = true
  join public.grid_owners g
    on g.platform_market_actor_id = aa.actor_id
   and coalesce(g.is_active, true)
  where nullif(regexp_replace(lower(coalesce(aa.normalized_alias, aa.alias, '')), '[^a-z0-9åäö]+', '', 'g'), '')
        = nullif(regexp_replace(lower(coalesce(u.name, '')), '[^a-z0-9åäö]+', '', 'g'), '')

  union all

  select
    u.id,
    g.id,
    5,
    'verified_existing_relation'::text
  from unmapped u
  join public.grid_owners g
    on g.platform_grid_owner_id = u.id
   and g.verification_status = 'verified'
   and coalesce(g.manual_review_required, false) = false
   and coalesce(g.is_active, true)
),
best_priority as (
  select
    c.platform_grid_owner_id,
    min(c.priority) as priority
  from candidates c
  group by c.platform_grid_owner_id
),
best_candidates as (
  select
    c.platform_grid_owner_id,
    c.ops_grid_owner_id,
    c.priority,
    c.match_method
  from candidates c
  join best_priority b
    on b.platform_grid_owner_id = c.platform_grid_owner_id
   and b.priority = c.priority
),
classified as (
  select
    u.id as platform_grid_owner_id,
    count(distinct b.ops_grid_owner_id)::integer as candidate_count,
    case
      when count(distinct b.ops_grid_owner_id) = 1
        then min(b.ops_grid_owner_id::text)::uuid
      else null::uuid
    end as candidate_ops_grid_owner_id,
    min(b.match_method) as match_method,
    min(b.priority) as match_priority
  from unmapped u
  left join best_candidates b
    on b.platform_grid_owner_id = u.id
  group by u.id
),
target_counts as (
  select
    c.candidate_ops_grid_owner_id,
    count(*)::integer as target_count
  from classified c
  where c.candidate_count = 1
    and c.candidate_ops_grid_owner_id is not null
  group by c.candidate_ops_grid_owner_id
),
guarded as (
  select
    c.*,
    coalesce(tc.target_count, 0)::integer as target_count,
    exists (
      select 1
      from public.platform_grid_owners occupied
      where occupied.ops_grid_owner_id = c.candidate_ops_grid_owner_id
        and occupied.id <> c.platform_grid_owner_id
    ) as target_already_mapped
  from classified c
  left join target_counts tc
    on tc.candidate_ops_grid_owner_id = c.candidate_ops_grid_owner_id
),
applied as (
  update public.platform_grid_owners pgo
     set ops_grid_owner_id = c.candidate_ops_grid_owner_id,
         metadata = jsonb_set(
           coalesce(pgo.metadata, '{}'::jsonb),
           '{ops_reconciliation}',
           jsonb_build_object(
             'engine', 'gridex_reconcile_grid_owner_mappings_v1',
             'engine_version', 2,
             'match_method', c.match_method,
             'match_priority', c.match_priority,
             'confidence', 'deterministic',
             'verified', true,
             'ops_grid_owner_id', c.candidate_ops_grid_owner_id,
             'reconciled_at', now()
           ),
           true
         ),
         updated_at = now()
  from guarded c
  where p_apply
    and c.candidate_count = 1
    and c.candidate_ops_grid_owner_id is not null
    and c.target_count = 1
    and not c.target_already_mapped
    and pgo.id = c.platform_grid_owner_id
    and pgo.ops_grid_owner_id is null
  returning pgo.id
)
select
  c.platform_grid_owner_id,
  case
    when a.id is not null then 'mapped'
    when c.candidate_count > 1
      or c.target_count > 1
      or c.target_already_mapped then 'ambiguous'
    when c.candidate_count = 1 and not p_apply then 'would_map'
    else 'review_required'
  end as status,
  c.candidate_ops_grid_owner_id,
  c.match_method,
  c.candidate_count,
  jsonb_build_object(
    'engine_version', 2,
    'apply_requested', p_apply,
    'match_priority', c.match_priority,
    'deterministic', c.candidate_count = 1 and c.target_count = 1 and not c.target_already_mapped,
    'target_candidate_count', c.target_count,
    'target_already_mapped', c.target_already_mapped,
    'fuzzy_write_allowed', false
  ) as details
from guarded c
left join applied a
  on a.id = c.platform_grid_owner_id
order by c.platform_grid_owner_id;
$function$;

revoke all on function public.gridex_reconcile_grid_owner_mappings_v1(boolean) from public;
revoke all on function public.gridex_reconcile_grid_owner_mappings_v1(boolean) from authenticated;
grant execute on function public.gridex_reconcile_grid_owner_mappings_v1(boolean) to service_role;

create or replace view public.gridex_grid_owner_duplicate_v
with (security_invoker = true)
as
with base as (
  select
    g.id,
    g.name,
    g.ediel_id,
    g.org_number,
    case
      when nullif(btrim(coalesce(g.ediel_id, '')), '') is not null
        then 'ediel:' || lower(btrim(g.ediel_id))
      when nullif(regexp_replace(coalesce(g.org_number, ''), '[^0-9]', '', 'g'), '') is not null
        then 'org:' || regexp_replace(g.org_number, '[^0-9]', '', 'g')
      else null
    end as duplicate_key
  from public.grid_owners g
),
grouped as (
  select
    base.duplicate_key,
    count(*)::integer as duplicate_count,
    array_agg(base.id order by base.name) as duplicate_ids
  from base
  where base.duplicate_key is not null
  group by base.duplicate_key
)
select
  b.id as grid_owner_id,
  b.name,
  b.ediel_id,
  b.org_number,
  b.duplicate_key,
  coalesce(g.duplicate_count, 1) as duplicate_count,
  coalesce(g.duplicate_ids, array[b.id]) as duplicate_ids
from base b
left join grouped g on g.duplicate_key = b.duplicate_key;

comment on view public.gridex_grid_owner_duplicate_v is
  'Canonical grid-owner duplicate projection. Only verified canonical identity surfaces (Ediel ID or normalized organization number) produce duplicate keys; display names never authorize duplicate classification.';
