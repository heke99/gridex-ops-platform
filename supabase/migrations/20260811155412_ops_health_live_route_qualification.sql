-- Qualify OPS health by actual production eligibility instead of preloaded candidate configuration.
-- Forward-only. Disabled/shadow Ediel profiles and imported reference masterdata remain visible as warnings,
-- while only live production-ready routes can make operational transport health blocking.

create or replace function public.gridex_ops_health_checks_v4()
returns table(check_key text, status text, issue_count bigint, details jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  count_value bigint;
begin
  -- Preserve all existing checks except the four configuration checks whose old
  -- implementation treated every enabled candidate profile/reference row as live.
  return query
  select h.check_key, h.status, h.issue_count, h.details
  from public.gridex_ops_health_checks_v3() h
  where h.check_key not in (
    'masterdata:grid_area_ops_owner_mapping_missing',
    'route:receiver_or_mailbox_missing',
    'route:required_receiver_subaddress_missing',
    'route:receiver_certificate_invalid_or_missing'
  );

  -- SVK reference coverage is important but an unmapped imported area is not a
  -- live customer-flow outage. Runtime intake still fails closed if that exact
  -- area is selected and no OPS owner mapping can be resolved.
  select count(*) into count_value
  from public.platform_grid_areas a
  join public.platform_grid_owners o on o.id = a.grid_owner_id
  where coalesce(a.is_active, false) = true
    and o.ops_grid_owner_id is null;
  return query select
    'masterdata:grid_area_ops_owner_mapping_missing',
    case when count_value = 0 then 'ok' else 'warning' end,
    count_value,
    jsonb_build_object(
      'classification', 'reference_masterdata_not_live_customer_state',
      'runtime_guard', 'grid_owner_mapping_missing',
      'action', 'reconcile_svk_owner_alias_to_verified_ops_owner'
    );

  -- A route can block production only after the readiness workflow has approved
  -- it for live use. Shadow/disabled profiles remain visible in candidate checks.
  select count(*) into count_value
  from public.ediel_route_profiles rp
  join public.communication_routes cr on cr.id = rp.communication_route_id
  where rp.environment = 'production'
    and coalesce(rp.is_enabled, false) = true
    and coalesce(cr.is_active, false) = true
    and coalesce(rp.is_production_ready, false) = true
    and coalesce(rp.production_mode, 'disabled') = 'live'
    and (nullif(btrim(coalesce(rp.receiver_ediel_id, '')), '') is null
      or nullif(btrim(coalesce(rp.smtp_to, cr.target_email, '')), '') is null);
  return query select
    'route:receiver_or_mailbox_missing',
    case when count_value = 0 then 'ok' else 'blocking' end,
    count_value,
    jsonb_build_object('scope', 'live_production_ready_only');

  select count(*) into count_value
  from public.ediel_route_profiles rp
  join public.communication_routes cr on cr.id = rp.communication_route_id
  where rp.environment = 'production'
    and coalesce(rp.is_enabled, false) = true
    and coalesce(cr.is_active, false) = true
    and not (coalesce(rp.is_production_ready, false) = true and coalesce(rp.production_mode, 'disabled') = 'live')
    and (nullif(btrim(coalesce(rp.receiver_ediel_id, '')), '') is null
      or nullif(btrim(coalesce(rp.smtp_to, cr.target_email, '')), '') is null);
  return query select
    'route:candidate_receiver_or_mailbox_missing',
    case when count_value = 0 then 'ok' else 'warning' end,
    count_value,
    jsonb_build_object('classification', 'non_live_route_candidate');

  select count(*) into count_value
  from public.ediel_route_profiles rp
  join public.communication_routes cr on cr.id = rp.communication_route_id
  where rp.environment = 'production'
    and coalesce(rp.is_enabled, false) = true
    and coalesce(cr.is_active, false) = true
    and coalesce(rp.is_production_ready, false) = true
    and coalesce(rp.production_mode, 'disabled') = 'live'
    and coalesce(rp.subaddress_required, false) = true
    and coalesce(nullif(rp.receiver_message_subaddress, ''), nullif(rp.receiver_subaddress, ''), nullif(rp.receiver_sub_address, '')) is null;
  return query select
    'route:required_receiver_subaddress_missing',
    case when count_value = 0 then 'ok' else 'blocking' end,
    count_value,
    jsonb_build_object('scope', 'live_production_ready_only');

  select count(*) into count_value
  from public.ediel_route_profiles rp
  join public.communication_routes cr on cr.id = rp.communication_route_id
  left join public.ediel_certificates c on c.id = coalesce(rp.receiver_certificate_id, rp.certificate_id)
  where rp.environment = 'production'
    and coalesce(rp.is_enabled, false) = true
    and coalesce(cr.is_active, false) = true
    and coalesce(rp.is_production_ready, false) = true
    and coalesce(rp.production_mode, 'disabled') = 'live'
    and (coalesce(rp.certificate_required, false) = true or coalesce(rp.encryption_mode, '') = 'smime')
    and (
      coalesce(rp.receiver_certificate_id, rp.certificate_id) is null
      or c.id is null
      or coalesce(c.status, '') not in ('valid', 'active', 'renewal_available')
      or (c.valid_from is not null and c.valid_from > now())
      or (c.valid_to is not null and c.valid_to <= now())
      or (c.environment is not null and c.environment <> rp.environment)
      or (c.owner_ediel_id is not null and c.owner_ediel_id <> rp.receiver_ediel_id)
      or nullif(btrim(coalesce(c.public_certificate_pem, '')), '') is null
    );
  return query select
    'route:receiver_certificate_invalid_or_missing',
    case when count_value = 0 then 'ok' else 'blocking' end,
    count_value,
    jsonb_build_object('scope', 'live_production_ready_only');

  select count(*) into count_value
  from public.ediel_route_profiles rp
  join public.communication_routes cr on cr.id = rp.communication_route_id
  left join public.ediel_certificates c on c.id = coalesce(rp.receiver_certificate_id, rp.certificate_id)
  where rp.environment = 'production'
    and coalesce(rp.is_enabled, false) = true
    and coalesce(cr.is_active, false) = true
    and not (coalesce(rp.is_production_ready, false) = true and coalesce(rp.production_mode, 'disabled') = 'live')
    and (coalesce(rp.certificate_required, false) = true or coalesce(rp.encryption_mode, '') = 'smime')
    and (
      coalesce(rp.receiver_certificate_id, rp.certificate_id) is null
      or c.id is null
      or coalesce(c.status, '') not in ('valid', 'active', 'renewal_available')
      or (c.valid_from is not null and c.valid_from > now())
      or (c.valid_to is not null and c.valid_to <= now())
      or (c.environment is not null and c.environment <> rp.environment)
      or (c.owner_ediel_id is not null and c.owner_ediel_id <> rp.receiver_ediel_id)
      or nullif(btrim(coalesce(c.public_certificate_pem, '')), '') is null
    );
  return query select
    'route:candidate_receiver_certificate_invalid_or_missing',
    case when count_value = 0 then 'ok' else 'warning' end,
    count_value,
    jsonb_build_object('classification', 'non_live_route_candidate');
end;
$$;

revoke all on function public.gridex_ops_health_checks_v4() from public, anon, authenticated;
grant execute on function public.gridex_ops_health_checks_v4() to service_role;
