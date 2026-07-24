-- Controlled canonical-flow backfill.
-- This script only patches area context when a metering point already references the
-- exact verified tenant-bound resolution. Ambiguous records are queued for review.
-- It never merges customers, changes invoices, rewrites accepted prices or changes a
-- price area when an existing canonical value conflicts.
begin;

-- Safe patch: exact resolution foreign key, same tenant, automation-ready, no conflict,
-- and no contradictory existing grid/price-area value.
update public.metering_points mp
set grid_area_code=coalesce(mp.grid_area_code,r.grid_area_code),
    grid_owner_id=coalesce(mp.grid_owner_id,r.grid_owner_id),
    grid_owner_name=coalesce(mp.grid_owner_name,r.grid_owner_name),
    price_area=coalesce(mp.price_area,r.price_area),
    bidding_zone_code=coalesce(mp.bidding_zone_code,r.price_area),
    resolution_source=coalesce(mp.resolution_source,'canonical_resolution_backfill'),
    resolution_confidence=coalesce(mp.resolution_confidence,r.confidence),
    resolution_status=coalesce(mp.resolution_status,r.resolution_status),
    resolved_at=coalesce(mp.resolved_at,r.resolved_at,r.updated_at,r.created_at),
    geodata_version=coalesce(mp.geodata_version,r.geodata_version),
    updated_at=now()
from public.customer_site_resolution r
where mp.energy_resolution_id=r.id
  and mp.company_id=r.company_id
  and r.automation_allowed=true
  and r.conflict_code is null
  and r.resolution_status in ('grid_area_master_validated','facility_verified')
  and r.grid_area_code is not null
  and r.price_area in ('SE1','SE2','SE3','SE4')
  and (mp.grid_area_code is null or mp.grid_area_code=r.grid_area_code)
  and (coalesce(mp.price_area,mp.bidding_zone_code) is null or coalesce(mp.price_area,mp.bidding_zone_code)=r.price_area)
  and (
    mp.grid_area_code is null or mp.grid_owner_id is null or mp.grid_owner_name is null
    or mp.price_area is null or mp.bidding_zone_code is null or mp.resolution_status is null
    or mp.resolved_at is null or mp.geodata_version is null
  );

insert into public.canonical_energy_remediation_queue(
  company_id,remediation_type,entity_type,entity_id,fingerprint,reason_code,severity,payload
)
select null,'spot_day_reimport','spot_price_daily_summary',id,
       source||':'||price_area||':'||price_date::text,'market_price_incomplete','blocking',
       jsonb_build_object('source',source,'price_area',price_area,'price_date',price_date,'quality_issues',quality_issues)
from public.gridex_spot_incomplete_days_v
on conflict(remediation_type,fingerprint) do update
set payload=excluded.payload,updated_at=now()
where public.canonical_energy_remediation_queue.status in ('open','in_review');

insert into public.canonical_energy_remediation_queue(
  company_id,remediation_type,entity_type,entity_id,fingerprint,reason_code,severity,payload
)
select null,'locked_spot_evidence_review','spot_price_'||period_type||'_summary',id,
       period_type||':'||source||':'||price_area||':'||period_key,'locked_settlement_evidence_incomplete','critical',to_jsonb(v)
from public.gridex_locked_spot_periods_missing_evidence_v v
on conflict(remediation_type,fingerprint) do update
set payload=excluded.payload,updated_at=now()
where public.canonical_energy_remediation_queue.status in ('open','in_review');

insert into public.canonical_energy_remediation_queue(
  company_id,remediation_type,entity_type,entity_id,fingerprint,reason_code,severity,payload
)
select null,'spot_period_lock_review','spot_price_'||period_type||'_summary',id,
       period_type||':'||source||':'||price_area||':'||period_key,'settlement_period_not_locked','blocking',
       jsonb_build_object('period_type',period_type,'source',source,'price_area',price_area,'period_key',period_key,'status',status,'verified_at',verified_at)
from public.gridex_spot_complete_unlocked_periods_v
where period_type='month'
on conflict(remediation_type,fingerprint) do update
set payload=excluded.payload,updated_at=now()
where public.canonical_energy_remediation_queue.status in ('open','in_review');

insert into public.canonical_energy_remediation_queue(
  company_id,remediation_type,entity_type,entity_id,fingerprint,reason_code,severity,payload
)
select company_id,'metering_point_area_context','metering_point',id,id::text,
       'metering_point_area_context_incomplete','blocking',to_jsonb(v)
from public.gridex_metering_points_incomplete_area_context_v v
on conflict(remediation_type,fingerprint) do update
set payload=excluded.payload,updated_at=now()
where public.canonical_energy_remediation_queue.status in ('open','in_review');

insert into public.canonical_energy_remediation_queue(
  company_id,remediation_type,entity_type,entity_id,fingerprint,reason_code,severity,payload
)
select company_id,'quote_resolution_binding','website_contract_quote',id,id::text,
       'quote_without_canonical_resolution','blocking',to_jsonb(v)
from public.gridex_quotes_without_canonical_resolution_v v
on conflict(remediation_type,fingerprint) do update
set payload=excluded.payload,updated_at=now()
where public.canonical_energy_remediation_queue.status in ('open','in_review');

insert into public.canonical_energy_remediation_queue(
  company_id,remediation_type,entity_type,entity_id,fingerprint,reason_code,severity,payload
)
select company_id,'contract_price_snapshot','customer_contract',id,id::text,
       'contract_price_snapshot_missing','critical',to_jsonb(v)
from public.gridex_customer_contracts_missing_price_snapshot_v v
on conflict(remediation_type,fingerprint) do update
set payload=excluded.payload,updated_at=now()
where public.canonical_energy_remediation_queue.status in ('open','in_review');

insert into public.canonical_energy_remediation_queue(
  company_id,remediation_type,entity_type,entity_id,fingerprint,reason_code,severity,payload
)
select company_id,'customer_identity_duplicate_review','customer',null,
       company_id::text||':'||match_type||':'||match_key,'customer_identity_ambiguous','critical',to_jsonb(v)
from public.gridex_customer_identity_duplicate_candidates_v v
on conflict(remediation_type,fingerprint) do update
set payload=excluded.payload,updated_at=now()
where public.canonical_energy_remediation_queue.status in ('open','in_review');

insert into public.canonical_energy_remediation_queue(
  company_id,remediation_type,entity_type,entity_id,fingerprint,reason_code,severity,payload
)
select null,'geodata_refresh','energy_geodata_version',id,id::text,
       'geodata_version_stale','blocking',to_jsonb(v)
from public.gridex_old_geodata_versions_v v
on conflict(remediation_type,fingerprint) do update
set payload=excluded.payload,updated_at=now()
where public.canonical_energy_remediation_queue.status in ('open','in_review');

insert into public.canonical_energy_remediation_queue(
  company_id,remediation_type,entity_type,entity_id,fingerprint,reason_code,severity,payload
)
select company_id,'energy_resolution_review','customer_site_resolution',id,id::text,
       coalesce(conflict_code,'energy_area_needs_review'),'blocking',to_jsonb(v)
from public.gridex_energy_resolutions_needing_review_v v
on conflict(remediation_type,fingerprint) do update
set reason_code=excluded.reason_code,payload=excluded.payload,updated_at=now()
where public.canonical_energy_remediation_queue.status in ('open','in_review');

commit;
