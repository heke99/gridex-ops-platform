-- Batch O6.3 diagnostics — safe blank subaddress + auto-send readiness

-- 1) Summary of safe blank subaddress candidates and confirmation state.
select
  message_family,
  environment,
  count(*) as total_blank_route_rows,
  count(*) filter (where can_auto_confirm) as safe_to_confirm,
  count(*) filter (where current_subaddress_status = 'not_required_confirmed') as already_confirmed,
  count(*) filter (where not can_auto_confirm) as skipped_or_conflict
from public.gridex_o6_3_safe_blank_subaddress_candidates_v
group by message_family, environment
order by message_family, environment;

-- 2) Actors that should become green once certificate requirements are met.
select
  c.actor_name,
  c.ediel_id,
  c.message_family,
  c.communication_addresses,
  c.party_ids,
  c.interchange_party_ids,
  c.current_subaddress_status,
  c.can_auto_confirm,
  c.skip_reasons,
  ars.has_safe_subaddress,
  ars.has_valid_prodat_certificate,
  ars.can_use_for_prodat,
  ars.can_start_supplier_switch,
  ars.blocking_reasons
from public.gridex_o6_3_safe_blank_subaddress_candidates_v c
left join public.actor_readiness_status ars
  on ars.platform_market_actor_id = c.actor_id
where c.message_family = 'PRODAT'
order by
  c.can_auto_confirm desc,
  ars.can_use_for_prodat desc,
  c.actor_name
limit 200;

-- 3) Routes now ready for auto-send, but only after all guards pass.
select
  actor_name,
  ediel_id,
  message_family,
  environment,
  subaddress,
  communication_address,
  route_verified,
  auto_send_allowed,
  requires_certificate,
  certificate_status,
  certificate_valid_to,
  readiness_status,
  blocking_reasons,
  warnings
from public.platform_actor_send_readiness_v
where upper(coalesce(message_family, '')) in ('PRODAT','UTILTS')
order by
  case readiness_status when 'ready_for_auto_send' then 0 else 1 end,
  actor_name
limit 200;

-- 4) Specific verification for Affärsverken 24200.
select
  ars.actor_name,
  ars.ediel_id,
  ars.has_prodat_route,
  ars.has_safe_subaddress,
  ars.has_valid_prodat_certificate,
  ars.can_use_for_prodat,
  ars.can_start_supplier_switch,
  ars.blocking_reasons
from public.actor_readiness_status ars
where ars.ediel_id = '24200';

select
  actor_name,
  ediel_id,
  message_family,
  environment,
  subaddress,
  communication_address,
  route_verified,
  auto_send_allowed,
  certificate_status,
  readiness_status,
  blocking_reasons
from public.platform_actor_send_readiness_v
where ediel_id = '24200'
order by message_family;
