-- Gridex OPS masterdata reconciliation and role-aware health v5.
-- Forward-only additive migration. The application continues to use v4 until code deployment.

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
  -- Priority 1: a verified Ediel identifier proves both the platform owner and OPS owner identity.
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

  -- Priority 2: a verified organization number proves both sides.
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

  -- Priority 3: an already verified actor relationship can bridge directly to the OPS owner.
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

  -- Priority 4: exact normalized verified alias. Fuzzy matches are intentionally excluded.
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

  -- Priority 5: a pre-existing verified OPS -> platform relation may repair the reciprocal bridge.
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
applied as (
  update public.platform_grid_owners pgo
     set ops_grid_owner_id = c.candidate_ops_grid_owner_id,
         metadata = jsonb_set(
           coalesce(pgo.metadata, '{}'::jsonb),
           '{ops_reconciliation}',
           jsonb_build_object(
             'engine', 'gridex_reconcile_grid_owner_mappings_v1',
             'engine_version', 1,
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
  from classified c
  where p_apply
    and c.candidate_count = 1
    and c.candidate_ops_grid_owner_id is not null
    and pgo.id = c.platform_grid_owner_id
    and pgo.ops_grid_owner_id is null
  returning pgo.id
)
select
  c.platform_grid_owner_id,
  case
    when a.id is not null then 'mapped'
    when c.candidate_count = 1 and not p_apply then 'would_map'
    when c.candidate_count > 1 then 'ambiguous'
    else 'review_required'
  end as status,
  c.candidate_ops_grid_owner_id,
  c.match_method,
  c.candidate_count,
  jsonb_build_object(
    'engine_version', 1,
    'apply_requested', p_apply,
    'match_priority', c.match_priority,
    'deterministic', c.candidate_count = 1,
    'fuzzy_write_allowed', false
  ) as details
from classified c
left join applied a
  on a.id = c.platform_grid_owner_id
order by c.platform_grid_owner_id;
$function$;

revoke all on function public.gridex_reconcile_grid_owner_mappings_v1(boolean) from public;
revoke all on function public.gridex_reconcile_grid_owner_mappings_v1(boolean) from authenticated;
grant execute on function public.gridex_reconcile_grid_owner_mappings_v1(boolean) to service_role;


create or replace function public.gridex_ops_health_checks_v5()
returns table (
  check_key text,
  status text,
  issue_count bigint,
  details jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
with
base as (
  select h.check_key, h.status, h.issue_count, h.details
  from public.gridex_ops_health_checks_v4() h
  where h.check_key not in (
    'masterdata:grid_owner_prodat_readiness_missing',
    'masterdata:grid_area_ops_owner_mapping_missing',
    'route:candidate_receiver_or_mailbox_missing',
    'route:candidate_receiver_certificate_invalid_or_missing'
  )
),
prodat_action_required as (
  select v.*
  from public.gridex_verified_grid_owners_v v
  where coalesce(v.can_use_for_prodat, false) = false
    and coalesce(v.is_electricity_grid_owner_scope, false) = true
    and coalesce(v.excluded_from_electricity_scope, false) = false
),
prodat_out_of_scope as (
  select v.*
  from public.gridex_verified_grid_owners_v v
  where coalesce(v.can_use_for_prodat, false) = false
    and (
      coalesce(v.excluded_from_electricity_scope, false) = true
      or coalesce(v.is_electricity_grid_owner_scope, false) = false
    )
),
unmapped_areas as (
  select
    a.id,
    a.grid_area_code,
    a.grid_area_name,
    a.grid_owner_id,
    o.name as platform_grid_owner_name
  from public.platform_grid_areas a
  join public.platform_grid_owners o
    on o.id = a.grid_owner_id
  where coalesce(a.is_active, true)
    and (a.valid_to is null or a.valid_to >= current_date)
    and o.ops_grid_owner_id is null
),
candidate_profiles as (
  select
    rp.*,
    cr.target_email as communication_target_email,
    cr.is_active as communication_route_is_active,
    c.id as resolved_certificate_id,
    c.status as resolved_certificate_status,
    c.valid_from as resolved_certificate_valid_from,
    c.valid_to as resolved_certificate_valid_to,
    c.environment as resolved_certificate_environment,
    c.owner_ediel_id as resolved_certificate_owner_ediel_id,
    c.public_certificate_pem as resolved_certificate_pem
  from public.ediel_route_profiles rp
  join public.communication_routes cr
    on cr.id = rp.communication_route_id
  left join public.ediel_certificates c
    on c.id = coalesce(rp.receiver_certificate_id, rp.certificate_id)
  where rp.environment = 'production'
    and coalesce(rp.is_enabled, false) = true
    and coalesce(cr.is_active, false) = true
    and not (
      coalesce(rp.is_production_ready, false) = true
      and coalesce(rp.production_mode, 'disabled') = 'live'
    )
),
dynamic_candidate_templates as (
  select cp.*
  from candidate_profiles cp
  where cp.receiver_source = 'dynamic_grid_owner'
    and nullif(btrim(coalesce(cp.dynamic_receiver_strategy, '')), '') is not null
    and nullif(btrim(coalesce(cp.smtp_to, cp.communication_target_email, '')), '') is not null
),
invalid_dynamic_candidate_templates as (
  select cp.*
  from candidate_profiles cp
  where cp.receiver_source = 'dynamic_grid_owner'
    and (
      nullif(btrim(coalesce(cp.dynamic_receiver_strategy, '')), '') is null
      or nullif(btrim(coalesce(cp.smtp_to, cp.communication_target_email, '')), '') is null
    )
),
invalid_static_candidate_receivers as (
  select cp.*
  from candidate_profiles cp
  where coalesce(cp.production_mode, 'disabled') <> 'disabled'
    and coalesce(cp.receiver_source, 'static') <> 'dynamic_grid_owner'
    and (
      nullif(btrim(coalesce(cp.receiver_ediel_id, '')), '') is null
      or nullif(btrim(coalesce(cp.smtp_to, cp.communication_target_email, '')), '') is null
    )
),
invalid_candidate_certificates as (
  select cp.*
  from candidate_profiles cp
  where (
      coalesce(cp.certificate_required, false) = true
      or coalesce(cp.encryption_mode, '') = 'smime'
    )
    and (
      coalesce(cp.receiver_certificate_id, cp.certificate_id) is null
      or cp.resolved_certificate_id is null
      or coalesce(cp.resolved_certificate_status, '') not in ('valid', 'active', 'renewal_available')
      or (cp.resolved_certificate_valid_from is not null and cp.resolved_certificate_valid_from > now())
      or (cp.resolved_certificate_valid_to is not null and cp.resolved_certificate_valid_to <= now())
      or (cp.resolved_certificate_environment is not null and cp.resolved_certificate_environment <> cp.environment)
      or (
        cp.resolved_certificate_owner_ediel_id is not null
        and cp.resolved_certificate_owner_ediel_id <> cp.receiver_ediel_id
      )
      or nullif(btrim(coalesce(cp.resolved_certificate_pem, '')), '') is null
    )
),
non_live_certificate_inventory as (
  select ic.*
  from invalid_candidate_certificates ic
  where coalesce(ic.production_mode, 'disabled') = 'disabled'
     or ic.receiver_source = 'dynamic_grid_owner'
),
actionable_static_candidate_certificates as (
  select ic.*
  from invalid_candidate_certificates ic
  where coalesce(ic.production_mode, 'disabled') <> 'disabled'
    and coalesce(ic.receiver_source, 'static') <> 'dynamic_grid_owner'
)
select b.check_key, b.status, b.issue_count, b.details
from base b

union all

select
  'masterdata:grid_owner_prodat_action_required'::text,
  case when count(*) > 0 then 'warning' else 'ok' end::text,
  count(*)::bigint,
  jsonb_build_object(
    'health_class', 'actionable_warning',
    'scope', 'electricity_grid_owner_supplier_switch',
    'manual_review_count', count(*) filter (where coalesce(manual_review_required, false)),
    'certificate_blocker_count', count(*) filter (
      where coalesce(certificate_status, '') not in ('valid', 'active', 'renewal_available')
    ),
    'sample', coalesce((
      select jsonb_agg(to_jsonb(s))
      from (
        select
          name,
          ediel_id,
          supplier_switch_readiness_status,
          manual_review_required,
          manual_review_reason,
          role_aware_blocking_reasons
        from prodat_action_required
        order by name
        limit 20
      ) s
    ), '[]'::jsonb)
  )
from prodat_action_required

union all

select
  'masterdata:grid_owner_prodat_out_of_scope_inventory'::text,
  'ok'::text,
  count(*)::bigint,
  jsonb_build_object(
    'health_class', 'inventory_info',
    'scope', 'excluded_or_non_electricity_grid_owner',
    'sample', coalesce((
      select jsonb_agg(to_jsonb(s))
      from (
        select name, ediel_id, primary_role_group, supplier_switch_readiness_status
        from prodat_out_of_scope
        order by name
        limit 20
      ) s
    ), '[]'::jsonb)
  )
from prodat_out_of_scope

union all

select
  'masterdata:grid_area_ops_owner_mapping_review'::text,
  case when count(*) > 0 then 'warning' else 'ok' end::text,
  count(*)::bigint,
  jsonb_build_object(
    'health_class', 'masterdata_review',
    'distinct_platform_grid_owners', count(distinct grid_owner_id),
    'reconciliation_engine', 'gridex_reconcile_grid_owner_mappings_v1',
    'automatic_write_policy', 'deterministic_verified_identity_only',
    'sample', coalesce((
      select jsonb_agg(to_jsonb(s))
      from (
        select grid_area_code, grid_area_name, platform_grid_owner_name, grid_owner_id
        from unmapped_areas
        order by grid_area_code
        limit 20
      ) s
    ), '[]'::jsonb)
  )
from unmapped_areas

union all

select
  'route:dynamic_receiver_candidate_templates'::text,
  'ok'::text,
  count(*)::bigint,
  jsonb_build_object(
    'health_class', 'inventory_info',
    'receiver_semantics', 'resolved_at_operation_time',
    'sample', coalesce((
      select jsonb_agg(to_jsonb(s))
      from (
        select route_name, production_mode, receiver_source, dynamic_receiver_strategy, message_family
        from dynamic_candidate_templates
        order by route_name
        limit 20
      ) s
    ), '[]'::jsonb)
  )
from dynamic_candidate_templates

union all

select
  'route:dynamic_receiver_candidate_template_invalid'::text,
  case when count(*) > 0 then 'warning' else 'ok' end::text,
  count(*)::bigint,
  jsonb_build_object(
    'health_class', 'actionable_warning',
    'reason', 'dynamic receiver candidates require a resolver strategy and mailbox',
    'sample', coalesce((
      select jsonb_agg(to_jsonb(s))
      from (
        select route_name, production_mode, receiver_source, dynamic_receiver_strategy
        from invalid_dynamic_candidate_templates
        order by route_name
        limit 20
      ) s
    ), '[]'::jsonb)
  )
from invalid_dynamic_candidate_templates

union all

select
  'route:static_candidate_receiver_or_mailbox_missing'::text,
  case when count(*) > 0 then 'warning' else 'ok' end::text,
  count(*)::bigint,
  jsonb_build_object(
    'health_class', 'actionable_warning',
    'reason', 'non-disabled static candidates require a receiver and mailbox',
    'sample', coalesce((
      select jsonb_agg(to_jsonb(s))
      from (
        select route_name, production_mode, receiver_source, receiver_ediel_id
        from invalid_static_candidate_receivers
        order by route_name
        limit 20
      ) s
    ), '[]'::jsonb)
  )
from invalid_static_candidate_receivers

union all

select
  'route:non_live_certificate_candidate_inventory'::text,
  'ok'::text,
  count(*)::bigint,
  jsonb_build_object(
    'health_class', 'inventory_info',
    'disabled_count', count(*) filter (where coalesce(production_mode, 'disabled') = 'disabled'),
    'dynamic_receiver_count', count(*) filter (where receiver_source = 'dynamic_grid_owner'),
    'reason', 'disabled profiles and dynamic receiver templates defer or do not require a static production recipient certificate'
  )
from non_live_certificate_inventory

union all

select
  'route:static_candidate_receiver_certificate_invalid_or_missing'::text,
  case when count(*) > 0 then 'warning' else 'ok' end::text,
  count(*)::bigint,
  jsonb_build_object(
    'health_class', 'actionable_warning',
    'reason', 'non-disabled static candidate requires a usable recipient certificate',
    'sample', coalesce((
      select jsonb_agg(to_jsonb(s))
      from (
        select route_name, production_mode, receiver_source, receiver_ediel_id, resolved_certificate_status
        from actionable_static_candidate_certificates
        order by route_name
        limit 20
      ) s
    ), '[]'::jsonb)
  )
from actionable_static_candidate_certificates;
$function$;

revoke all on function public.gridex_ops_health_checks_v5() from public;
grant execute on function public.gridex_ops_health_checks_v5() to authenticated;
grant execute on function public.gridex_ops_health_checks_v5() to service_role;

comment on function public.gridex_reconcile_grid_owner_mappings_v1(boolean)
is 'Deterministic, idempotent Gridex platform-to-OPS grid-owner reconciliation. Fuzzy matches never write production mappings.';

comment on function public.gridex_ops_health_checks_v5()
is 'Role/scope-aware OPS health v5. Preserves live route blocking while separating actionable warnings, masterdata review, and inventory information.';
