# Arbel intake repair — 2026-09-02

Production findings for the website intake path:

- The API accepted a structured signed power of attorney; the canonical POA, authorization document and authorization scope existed.
- The admin application view selected the historical `powers_of_attorney.expires_at` field while production used `valid_to`/`valid_until`, causing the compatibility read to degrade to an empty list and falsely display the POA as absent.
- `power_of_attorney_scopes` had not been materialized for website POAs even though the immutable `signed_scope_snapshot` was present. The repair materializes only the captured scopes and is idempotent.
- SVK geodata used the trading name `Ellevio` while the actor registry canonical identity is `Ellevio AB` with Ediel identity. Grid areas could therefore resolve geometrically but map into an unverified alias owner. The repair binds only unique canonical legal/trading-name matches that already have both Ediel identity and an OPS owner mapping.
- Vallentuna/VAT now resolves to the canonical Ellevio actor in master data.

Safety boundary:

A postal centroid is not treated as the customer's exact facility location. The repair does not invent a facility/metering-point ID and does not permit a supplier switch until facility identity is verified. This preserves the existing production safety contract while allowing valid POA and canonical grid-owner master data to remain visible and reusable.
