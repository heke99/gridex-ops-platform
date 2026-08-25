# OPS precision: Papilite first, GeoTorget fallback

This architecture is internal to Gridex OPS. The public website must never depend on GeoTorget/Lantmateriet.

## Authority chain

1. Papilite supplies postcode-centroid precision.
2. Canonical SVK grid-area geometry determines the grid area.
3. Gridex platform masterdata maps the grid area to the OPS grid owner and SE1-SE4.
4. A Papilite candidate is accepted only when the point is covered by one unique active SVK area, the SVK geodata is current, the price area does not conflict, the platform owner maps to an OPS owner, and spatial confidence is at least the configured OPS threshold (0.95 by default).
5. If any of those conditions fail, OPS may call GeoTorget/Lantmateriet Belagenhetsadress Direkt for one exact address point.
6. The exact point is mapped through the same SVK geometry and masterdata. Lantmateriet is a precision provider, never grid-owner authority.

## Public website

`resolveWebsiteEnergyContext` remains postcode/Papilite price-area-only and strips street/house number before resolver execution. GeoTorget credentials and exact-address calls are never required for quote/signup.

## Persistence

Canonical geography is versioned in `customer_site_resolution`. `customer_sites` is a materialized projection bound by `resolution_id`. A postcode centroid is never copied into site/facility coordinate columns.

Facility responses create a new `facility_verified` resolution and bind it in the same database transaction. Ediel/PRODAT readiness is evaluated after geographical identity and remains a separate concern.

## Secrets

OPS production uses server-side secrets only:

- `PAPILITE_API_KEY`
- `LANTMATERIET_BELAGENHETSADRESS_USERNAME`
- `LANTMATERIET_BELAGENHETSADRESS_PASSWORD`
- optional `OPS_PAPILITE_GRID_OWNER_MIN_CONFIDENCE` (default `0.95`, clamped to `0.90..0.99`)

Never expose GeoTorget/Lantmateriet credentials to browser code, tenant websites, logs, database rows, or client responses.
