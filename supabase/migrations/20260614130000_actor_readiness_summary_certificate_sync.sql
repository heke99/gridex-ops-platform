-- Batch: Actor readiness summary UI + certificate sync hardening
-- Purpose:
-- 1) Make platform_actor_certificates support one certificate fingerprint for multiple actors/routes.
-- 2) Add one-row-per-actor summary view for the admin UI.
-- 3) Keep route detail view as source of truth for exact blockers.

-- The old fingerprint-only unique index was too strict for shared operator certificates
-- such as Edilink/Compello/Tieto/Volue, where the same public certificate can be used
-- as transport certificate for more than one Ediel actor. Readiness must be per actor,
-- not per global fingerprint.
drop index if exists public.platform_actor_certificates_fingerprint_uidx;

create unique index if not exists platform_actor_certificates_actor_fingerprint_uidx
  on public.platform_actor_certificates(actor_id, environment, purpose, fingerprint_sha256)
  where fingerprint_sha256 is not null;

create index if not exists platform_actor_certificates_fingerprint_lookup_idx
  on public.platform_actor_certificates(fingerprint_sha256)
  where fingerprint_sha256 is not null;

drop view if exists public.platform_actor_send_readiness_summary_v;

create view public.platform_actor_send_readiness_summary_v
with (security_invoker = true)
as
select
  base.actor_id,
  base.actor_name,
  base.legal_name,
  base.org_number,
  base.actor_status,
  base.match_status,
  base.visible_to_tenants,
  base.actor_roles,
  base.ediel_id,
  base.ediel_id_verified,
  count(*) filter (where upper(coalesce(base.message_family, '')) in ('PRODAT','UTILTS') and upper(coalesce(base.subaddress, '')) <> 'GAS') as electricity_route_count,
  count(*) filter (where upper(coalesce(base.message_family, '')) = 'PRODAT' and upper(coalesce(base.subaddress, '')) <> 'GAS') as prodat_route_count,
  count(*) filter (where upper(coalesce(base.message_family, '')) = 'UTILTS' and upper(coalesce(base.subaddress, '')) <> 'GAS') as utilts_route_count,
  count(*) filter (where upper(coalesce(base.message_family, '')) in ('PRODAT','UTILTS') and upper(coalesce(base.subaddress, '')) <> 'GAS' and base.auto_send_allowed = true) as auto_send_enabled_route_count,
  count(*) filter (where upper(coalesce(base.message_family, '')) in ('PRODAT','UTILTS') and upper(coalesce(base.subaddress, '')) <> 'GAS' and base.readiness_status = 'ready_for_auto_send') as ready_route_count,
  count(*) filter (where upper(coalesce(base.message_family, '')) in ('PRODAT','UTILTS') and upper(coalesce(base.subaddress, '')) <> 'GAS' and base.requires_certificate = true and coalesce(base.certificate_status, 'missing') <> 'valid') as missing_required_certificate_route_count,
  count(*) filter (
    where upper(coalesce(base.message_family, '')) in ('PRODAT','UTILTS')
      and upper(coalesce(base.subaddress, '')) <> 'GAS'
      and exists (
        select 1
        from unnest(base.blocking_reasons) br
        where br in ('party_id_mismatch','interchange_party_id_mismatch','wrong_environment','missing_transport_channel','tenant_routing_not_verified','route_not_active','route_not_verified')
      )
  ) as hard_blocked_route_count,
  array_remove(array_agg(distinct base.readiness_status), null) as readiness_statuses,
  array_remove(array_agg(distinct base.certificate_status), null) as certificate_statuses,
  array(
    select distinct reason
    from (
      select unnest(detail.blocking_reasons) as reason
      from public.platform_actor_send_readiness_v detail
      where detail.actor_id = base.actor_id
        and upper(coalesce(detail.message_family, '')) in ('PRODAT','UTILTS')
        and upper(coalesce(detail.subaddress, '')) <> 'GAS'
    ) reasons
    where reason is not null
    order by reason
  ) as blocking_reasons,
  max(base.last_checked_at) as last_checked_at,
  min(base.next_check_at) as next_check_at,
  case
    when count(*) filter (where upper(coalesce(base.message_family, '')) in ('PRODAT','UTILTS') and upper(coalesce(base.subaddress, '')) <> 'GAS') = 0 then 'no_electricity_routes'
    when count(*) filter (
      where upper(coalesce(base.message_family, '')) in ('PRODAT','UTILTS')
        and upper(coalesce(base.subaddress, '')) <> 'GAS'
        and exists (
          select 1
          from unnest(base.blocking_reasons) br
          where br in ('party_id_mismatch','interchange_party_id_mismatch','wrong_environment','missing_transport_channel','tenant_routing_not_verified','route_not_active','route_not_verified')
        )
    ) > 0 then 'blocked'
    when count(*) filter (where upper(coalesce(base.message_family, '')) in ('PRODAT','UTILTS') and upper(coalesce(base.subaddress, '')) <> 'GAS' and base.readiness_status = 'ready_for_auto_send') = count(*) filter (where upper(coalesce(base.message_family, '')) in ('PRODAT','UTILTS') and upper(coalesce(base.subaddress, '')) <> 'GAS') then 'ready'
    when count(*) filter (where upper(coalesce(base.message_family, '')) in ('PRODAT','UTILTS') and upper(coalesce(base.subaddress, '')) <> 'GAS' and base.readiness_status = 'ready_for_auto_send') > 0 then 'partial'
    when count(*) filter (where upper(coalesce(base.message_family, '')) in ('PRODAT','UTILTS') and upper(coalesce(base.subaddress, '')) <> 'GAS' and base.requires_certificate = true and coalesce(base.certificate_status, 'missing') <> 'valid') > 0 then 'missing_required_certificate'
    else 'needs_review'
  end as actor_readiness_status,
  case
    when count(*) filter (where upper(coalesce(base.message_family, '')) in ('PRODAT','UTILTS') and upper(coalesce(base.subaddress, '')) <> 'GAS' and base.requires_certificate = true and coalesce(base.certificate_status, 'missing') <> 'valid') > 0 then 'missing_required_certificate'
    when count(*) filter (where upper(coalesce(base.message_family, '')) in ('PRODAT','UTILTS') and upper(coalesce(base.subaddress, '')) <> 'GAS' and base.route_verified is not true) > 0 then 'route_not_verified'
    else null
  end as primary_blocker
from public.platform_actor_send_readiness_v base
group by
  base.actor_id,
  base.actor_name,
  base.legal_name,
  base.org_number,
  base.actor_status,
  base.match_status,
  base.visible_to_tenants,
  base.actor_roles,
  base.ediel_id,
  base.ediel_id_verified;

comment on view public.platform_actor_send_readiness_summary_v is
  'One row per actor for admin UI. Detail rows remain in platform_actor_send_readiness_v. Certificate blockers are counted only where requires_certificate=true.';

revoke all on public.platform_actor_send_readiness_summary_v from anon;
grant select on public.platform_actor_send_readiness_summary_v to authenticated;
