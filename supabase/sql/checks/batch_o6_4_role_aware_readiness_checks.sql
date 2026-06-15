-- Batch O6.4 — Role-aware readiness checks
-- Run after migration 20260615190000_batch_o6_4_role_aware_readiness_grid_owner_cleanup.sql.

-- 1) Supplier switch scope must only include electricity grid owners.
select
  count(*) filter (where is_electricity_grid_owner_scope) as electricity_grid_owner_scope_count,
  count(*) filter (where can_start_supplier_switch) as supplier_switch_ready_count,
  count(*) filter (where electricity_scope_status = 'excluded_from_electricity_scope') as excluded_from_electricity_scope_count,
  count(*) filter (where is_gas_actor and can_start_supplier_switch) as gas_actor_wrongly_ready_count,
  count(*) filter (where is_dummy_or_test_actor and can_start_supplier_switch) as test_actor_wrongly_ready_count,
  count(*) filter (where is_system_supplier_only and can_start_supplier_switch) as system_supplier_wrongly_ready_count
from public.actor_readiness_status;

-- 2) Role-based dashboard numbers.
select *
from public.actor_readiness_by_role_v
order by role_group;

-- 3) Grid-owner supplier-switch blockers only within electricity scope.
select
  count(*) filter (where is_electricity_grid_owner_scope) as electricity_grid_owners,
  count(*) filter (where can_start_supplier_switch) as ready,
  count(*) filter (where missing_or_invalid_certificate) as missing_or_invalid_certificate,
  count(*) filter (where missing_prodat_route) as missing_prodat_route,
  count(*) filter (where unsafe_or_missing_subaddress) as unsafe_or_missing_subaddress,
  count(*) filter (where missing_contact_path) as missing_contact_path,
  count(*) filter (where missing_ediel_id) as missing_ediel_id,
  count(*) filter (where manual_review_required) as manual_review_required,
  count(*) filter (where electricity_scope_status = 'excluded_from_electricity_scope') as excluded_from_electricity_scope
from public.grid_owner_supplier_switch_readiness_v;

-- 4) O6.4A certificate refresh must not target gas/test/system/other roles.
select
  count(*) as certificate_refresh_candidate_count,
  count(*) filter (where g.is_electricity_grid_owner_scope is not true) as unsafe_non_electricity_candidate_count,
  count(*) filter (where g.electricity_scope_status = 'excluded_from_electricity_scope') as excluded_candidate_count
from public.ediel_blocked_grid_owner_certificate_refresh_candidates_v c
left join public.grid_owner_supplier_switch_readiness_v g
  on g.platform_market_actor_id = c.platform_market_actor_id;

-- 5) Missing PRODAT route should be review, not fake readiness.
select actor_name, ediel_id, supplier_switch_readiness_status, manual_review_reason, blocking_reasons
from public.grid_owner_supplier_switch_readiness_v
where missing_prodat_route = true
order by actor_name
limit 50;
