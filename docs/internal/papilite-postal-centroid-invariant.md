# Papilite postcode-centroid invariant

This file records the release invariant enforced by code and CI.

- PAP/API Lite is postcode enrichment only. The Lite API has no house-number data.
- Papilite coordinates are stored and labelled as `postal_centroid`, never as an exact site address.
- A Papilite centroid may help estimate an electricity price area when Gridex has no stronger shared mapping.
- It must never set a final grid owner, final grid-area binding, facility verification, or Ediel automation permission.
- `platform_postal_code_grid_mappings` is shared across companies and contains no tenant/customer/site identifiers.
- Verified tenant sites may strengthen the shared postcode mapping only after `facility_verified` or `manual_verified`.
- Tenant-specific results are materialized to `customer_sites`; shared geography remains tenant-neutral.
- Canonical quote and invoice engines remain the only pricing/billing calculation path.
- Grid-owner information requests remain gated by verified facility/grid-owner routing readiness.
