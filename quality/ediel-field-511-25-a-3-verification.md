# Gridex UTILTS field 511 — authoritative import package

Source workbook:
- Tidsserieprodukter_20250528 (3).xls
- SHA-256: 2317450436391e1422e176cf503352c96fc9c38040962e8668f036563784fa98

Historical comparison workbook:
- Foreskrifterna_och_tidsserieprodukter_130124 (2).xls
- SHA-256: f1ca5dc5d43d3f0b29f4d3782b52477d4eacc37602be5bb4dcc81ac6e867b3fb

Verified source facts:
- 133 source rows in Tidsserieprodukter.
- 91 unique TimeSeriesProductCode values.
- 91 unique PC/PT/OT/LOD/BAP tuples.
- 0 tuples with a missing component.
- Repeated rows are ValueNo variants; none change the five-component field-511 tuple.
- 3 source products are explicitly marked retired/not in use and are retained for provenance but excluded by the current resolver: L336Q, S195, S196.
- Current resolver universe: 88 tuples.

Production mapping:
- Guide: 25-A-3, revision 3, E5SE5A.
- Validity window used by Gridex rule pack: 2025-06-01 through 2026-09-30.
- Source is bound to ediel_rule_pack_sources and ediel_rule_packs.code_list_versions.
- Exact service-role resolver: resolve_ediel_timeseries_product_511(PC, PT, OT, LOD, BAP, business_date).
- Resolver is fail-closed: no exact tuple => no product resolution.

Migration SHA-256:
- 188b18da215227f35463ebcb432ef5f8b0064681a2d87b764b3653656a82e6b9

Write/deploy note:
The migration was schema-tested with BEGIN/ROLLBACK against Supabase project piidsfebjqjmnepdpnas.
No persistent database change was made because GitHub repository writes were blocked by the platform safety layer; applying DB-only would create repository/database migration drift.

## Tip residual notes (post-f596dc55)

- `VERIFICATION.md` remains the repository production-gate document; this file
  holds the field-511 import package evidence that previously overwrote it.
- Workbook provenance for L653Q retains a leading tab in the import migration
  and `field-511-products-25-a-3.json`. Live descriptions are cleaned by
  forward migration `20260813221500_ediel_utilts_field_511_l653q_description_trim.sql`.
- Canonical checksum registration is
  `scripts/migration-history-manifest.additions.json` plus
  `supabase/migrations/migration-history-manifest.additions.snippet.json`.
  Do not recreate a root-level orphan snippet.
