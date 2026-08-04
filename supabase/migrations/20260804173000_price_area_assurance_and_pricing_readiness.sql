begin;

-- Price display/quote readiness is intentionally separated from network-owner,
-- facility and EDIFACT readiness. The assurance columns persist the exact
-- evidence used to accept or reject SE1-SE4 for a tenant-bound resolution.
alter table public.customer_site_resolution
  add column if not exists price_area_assurance_status text,
  add column if not exists price_area_assurance_source text,
  add column if not exists price_area_assurance_confidence numeric(5,4),
  add column if not exists price_area_assurance_source_version text,
  add column if not exists price_area_candidate_count integer,
  add column if not exists price_area_unique_count integer,
  add column if not exists price_area_evidence jsonb;

-- Only lifecycle states which already represented verified canonical network
-- context are safe to backfill. Historical postal suggestions are deliberately
-- left unresolved and must pass the new candidate-consensus resolver again.
update public.customer_site_resolution
set
  price_area_assurance_status = case
    when price_area is not null and resolution_status in (
      'grid_area_master_validated',
      'facility_data_requested',
      'facility_data_received',
      'facility_verified'
    ) then 'verified'
    else 'unresolved'
  end,
  price_area_assurance_source = case
    when price_area is not null and resolution_status = 'facility_verified' then 'facility_data'
    when price_area is not null and resolution_status in (
      'grid_area_master_validated',
      'facility_data_requested',
      'facility_data_received'
    ) then 'grid_area_master'
    else null
  end,
  price_area_assurance_confidence = case
    when price_area is not null and resolution_status in (
      'grid_area_master_validated',
      'facility_data_requested',
      'facility_data_received',
      'facility_verified'
    ) then greatest(coalesce(confidence, 0), 0.7500)
    else 0
  end,
  price_area_assurance_source_version = coalesce(resolver_version, 'legacy'),
  price_area_candidate_count = case when price_area is null then 0 else 1 end,
  price_area_unique_count = case when price_area is null then 0 else 1 end,
  price_area_evidence = coalesce(price_area_evidence, '{}'::jsonb) || jsonb_build_object(
    'migration_backfill', true,
    'resolution_status', resolution_status,
    'backfilled_at', '2026-08-04T15:30:00.000Z'
  )
where
  price_area_assurance_status is null
  or price_area_assurance_confidence is null
  or price_area_candidate_count is null
  or price_area_unique_count is null
  or price_area_evidence is null;

alter table public.customer_site_resolution
  alter column price_area_assurance_status set default 'unresolved',
  alter column price_area_assurance_status set not null,
  alter column price_area_assurance_confidence set default 0,
  alter column price_area_assurance_confidence set not null,
  alter column price_area_candidate_count set default 0,
  alter column price_area_candidate_count set not null,
  alter column price_area_unique_count set default 0,
  alter column price_area_unique_count set not null,
  alter column price_area_evidence set default '{}'::jsonb,
  alter column price_area_evidence set not null;

alter table public.customer_site_resolution
  drop constraint if exists customer_site_resolution_price_area_assurance_status_check,
  add constraint customer_site_resolution_price_area_assurance_status_check
    check (price_area_assurance_status in ('verified', 'estimated', 'ambiguous', 'unresolved')),
  drop constraint if exists customer_site_resolution_price_area_assurance_source_check,
  add constraint customer_site_resolution_price_area_assurance_source_check
    check (
      price_area_assurance_source is null
      or price_area_assurance_source in (
        'facility_data',
        'grid_area_master',
        'address_polygon',
        'postal_city_consensus',
        'postal_consensus'
      )
    ),
  drop constraint if exists customer_site_resolution_price_area_assurance_confidence_check,
  add constraint customer_site_resolution_price_area_assurance_confidence_check
    check (
      price_area_assurance_confidence >= 0
      and price_area_assurance_confidence <= 1
    ),
  drop constraint if exists customer_site_resolution_price_area_candidate_count_check,
  add constraint customer_site_resolution_price_area_candidate_count_check
    check (price_area_candidate_count >= 0),
  drop constraint if exists customer_site_resolution_price_area_unique_count_check,
  add constraint customer_site_resolution_price_area_unique_count_check
    check (
      price_area_unique_count >= 0
      and price_area_unique_count <= price_area_candidate_count
    ),
  drop constraint if exists customer_site_resolution_price_area_assurance_consistency_check,
  add constraint customer_site_resolution_price_area_assurance_consistency_check
    check (
      price_area_assurance_status not in ('verified', 'estimated')
      or (
        price_area is not null
        and price_area_unique_count = 1
        and price_area_candidate_count >= 1
        and price_area_assurance_source is not null
      )
    );

create index if not exists customer_site_resolution_price_assurance_idx
  on public.customer_site_resolution (
    company_id,
    price_area_assurance_status,
    price_area,
    expires_at
  );

comment on column public.customer_site_resolution.price_area_assurance_status is
  'Independent evidence state for using price_area in pricing/quote. Does not imply facility, grid-owner, PRODAT or EDIFACT readiness.';
comment on column public.customer_site_resolution.price_area_evidence is
  'Canonical evidence snapshot for SE1-SE4 resolution, including postal candidate consensus or verified master/facility provenance.';

commit;
