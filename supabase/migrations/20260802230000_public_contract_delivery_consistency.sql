-- Canonical public-contract delivery/readiness source.
-- Forward-only: does not alter any previously applied migration.

create or replace view public.canonical_public_contract_delivery_readiness_v
with (security_invoker = true) as
with evaluated as (
  select
    diagnostics.*,
    case
      when diagnostics.channel = 'api'
        then diagnostics.publication_version_id is not null
      else diagnostics.public_offer_id is not null
        and public_offer.contract_publication_version_id = diagnostics.publication_version_id
    end as forward_publication_link_valid,
    case
      when diagnostics.channel = 'api'
        then diagnostics.publication_version_id is not null
      else diagnostics.public_offer_id is not null
        and publication_version.legacy_public_contract_offer_id = diagnostics.public_offer_id
    end as reverse_legacy_link_valid,
    (
      diagnostics.assignment_id is not null
      and assignment.company_id = diagnostics.company_id
      and source_offer.company_id = diagnostics.company_id
    ) as company_chain_valid,
    (
      diagnostics.assignment_id is not null
      and assignment.contract_product_version_id = source_offer.contract_product_version_id
    ) as tenant_assignment_valid,
    (
      diagnostics.channel_id is not null
      and contract_channel.channel = diagnostics.channel
      and publication.channel = diagnostics.channel
      and publication_version.channel = diagnostics.channel
    ) as channel_graph_valid,
    (
      diagnostics.publication_version_id is not null
      and publication_version.contract_product_version_id = source_offer.contract_product_version_id
    ) as product_version_valid,
    (
      diagnostics.publication_version_id is not null
      and diagnostics.snapshot_source_contract_offer_id = diagnostics.source_contract_offer_id::text
    ) as source_offer_consistent,
    (
      diagnostics.publication_version_id is not null
      and diagnostics.content_sha256 = encode(
        extensions.digest(diagnostics.publication_snapshot::text, 'sha256'),
        'hex'
      )
    ) as snapshot_hash_valid,
    (
      diagnostics.publication_version_id is not null
      and coalesce(
        nullif(lower(diagnostics.publication_snapshot->>'energy_direction'), ''),
        nullif(lower(publication_version.energy_direction), ''),
        'consumption'
      ) = coalesce(nullif(lower(source_offer.energy_direction), ''), 'consumption')
      and coalesce(
        nullif(lower(publication_version.energy_direction), ''),
        'consumption'
      ) = coalesce(nullif(lower(product_version.energy_direction), ''), 'consumption')
    ) as energy_direction_valid,
    (
      diagnostics.publication_version_id is not null
      and coalesce(
        nullif(lower(diagnostics.publication_snapshot->>'contract_type'), ''),
        nullif(lower(product_version.contract_type), '')
      ) = lower(source_offer.contract_type)
    ) as contract_type_valid,
    not exists (
      select 1
      from public.contract_offers successor
      where successor.supersedes_offer_id = diagnostics.source_contract_offer_id
        and successor.lifecycle_status = 'published'
        and successor.is_active
    ) as successor_chain_valid
  from public.canonical_public_contract_diagnostics_v diagnostics
  left join public.contract_offers source_offer
    on source_offer.id = diagnostics.source_contract_offer_id
  left join public.contract_product_versions product_version
    on product_version.id = source_offer.contract_product_version_id
  left join public.tenant_contract_assignments assignment
    on assignment.id = diagnostics.assignment_id
  left join public.tenant_contract_channels contract_channel
    on contract_channel.id = diagnostics.channel_id
  left join public.contract_publications publication
    on publication.id = diagnostics.publication_id
  left join public.contract_publication_versions publication_version
    on publication_version.id = diagnostics.publication_version_id
  left join public.public_contract_offers public_offer
    on public_offer.id = diagnostics.public_offer_id
), classified as (
  select
    evaluated.*,
    (
      evaluated.forward_publication_link_valid
      and evaluated.reverse_legacy_link_valid
      and evaluated.company_chain_valid
      and evaluated.tenant_assignment_valid
      and evaluated.channel_graph_valid
      and evaluated.product_version_valid
      and evaluated.source_offer_consistent
      and evaluated.snapshot_hash_valid
      and evaluated.energy_direction_valid
      and evaluated.contract_type_valid
      and evaluated.successor_chain_valid
    ) as structural_graph_consistent,
    (
      evaluated.publication_version_id is not null
      and evaluated.publication_id is not null
      and evaluated.assignment_id is not null
      and evaluated.channel_id is not null
    ) as graph_evaluable
  from evaluated
)
select
  classified.company_id,
  classified.source_contract_offer_id,
  classified.name,
  classified.product_code,
  classified.customer_type,
  classified.contract_type,
  classified.channel,
  classified.supported_areas_valid,
  classified.invoice_fee_sek,
  classified.pricing_snapshot,
  classified.external_tenant_reference,
  classified.company_status,
  classified.assignment_id,
  classified.assignment_status,
  classified.website_publication_allowed,
  classified.api_publication_allowed,
  classified.channel_id,
  classified.channel_status,
  classified.publication_id,
  classified.publication_status,
  classified.publication_version_id,
  classified.offer_reference,
  classified.publication_version_status,
  classified.locked_at,
  classified.valid_from,
  classified.valid_to,
  classified.content_sha256,
  classified.publication_snapshot,
  classified.snapshot_source_contract_offer_id,
  classified.public_offer_id,
  classified.website_enabled,
  classified.website_cta_enabled,
  classified.is_public,
  classified.website_publication_status,
  classified.invoice_fee_component_count,
  classified.invoice_fee_canonical_count,
  classified.invoice_fee_component_amount,
  classified.invoice_fee_ready,
  classified.price_option_count,
  classified.default_count,
  classified.required_selection_count,
  classified.invalid_option_count,
  classified.duplicate_option_count,
  classified.legal_ready,
  classified.missing_area_count,
  classified.channel_state,
  case
    when classified.graph_evaluable and not classified.structural_graph_consistent
      then array_append(
        array_remove(coalesce(classified.blockers, '{}'::text[]), 'PUBLICATION_GRAPH_INCONSISTENT'),
        'PUBLICATION_GRAPH_INCONSISTENT'
      )
    else array_remove(coalesce(classified.blockers, '{}'::text[]), 'PUBLICATION_GRAPH_INCONSISTENT')
  end as blockers,
  classified.forward_publication_link_valid,
  classified.reverse_legacy_link_valid,
  classified.company_chain_valid,
  classified.tenant_assignment_valid,
  classified.channel_graph_valid,
  classified.product_version_valid,
  classified.source_offer_consistent,
  classified.snapshot_hash_valid,
  classified.energy_direction_valid,
  classified.contract_type_valid,
  classified.successor_chain_valid,
  classified.structural_graph_consistent as canonical_graph_consistent,
  (classified.company_status = 'active') as tenant_ready,
  (
    classified.assignment_id is not null
    and classified.assignment_status = 'active'
  ) as assignment_ready,
  (
    classified.channel_id is not null
    and classified.channel_status = 'active'
  ) as channel_ready,
  (
    classified.publication_id is not null
    and classified.publication_status = 'published'
  ) as publication_ready,
  (
    classified.publication_version_id is not null
    and classified.publication_version_status = 'published'
    and classified.locked_at is not null
  ) as publication_version_ready,
  classified.invoice_fee_ready as canonical_invoice_fee_ready,
  (
    classified.price_option_count > 0
    and classified.default_count = 1
    and classified.invalid_option_count = 0
    and classified.duplicate_option_count = 0
    and classified.missing_area_count = 0
  ) as price_options_ready,
  classified.legal_ready as canonical_legal_ready,
  (
    (classified.valid_from is null or classified.valid_from <= now())
    and (classified.valid_to is null or classified.valid_to > now())
  ) as date_window_valid,
  (
    classified.channel = 'api'
    or (
      classified.public_offer_id is not null
      and classified.website_enabled
      and classified.website_cta_enabled
      and classified.is_public
      and classified.website_publication_status = 'published'
    )
  ) as public_offer_ready,
  (classified.visible and classified.structural_graph_consistent) as visible
from classified;

comment on view public.canonical_public_contract_delivery_readiness_v is
  'Single canonical source for public feed and diagnostics. Structural graph integrity is separated from tenant state, operational readiness, pricing, legal state, validity windows and final visibility for both website and API channels.';

revoke all on public.canonical_public_contract_delivery_readiness_v from public;
revoke all on public.canonical_public_contract_delivery_readiness_v from anon;
revoke all on public.canonical_public_contract_delivery_readiness_v from authenticated;
grant select on public.canonical_public_contract_delivery_readiness_v to service_role;
