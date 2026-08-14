# Current state

Updated: 2026-08-14

## Tip health after #147 merge

- Main tip: `c5756245` (`Production verification: lifecycle, tenant go-live and website sales gate (#147)`).
- Active health branch: `cursor/codebase-health-and-stability-e446`.
- Tip residual hunt found production command hash variants, go-live primary
  client drift, and still-open post-#145 Processa om residuals from draft #146.

## Residuals closed on `e446`

1. HIGH — Processa om terminal job sync + actionable review reasons (relanded
   from draft #146 / `4764`)
2. HIGH — Atomic `request_payload` + `request_hash` bind for production
   transition, first-live-send approve, provision, actor profile, user-access
3. HIGH — Shared `selectPrimaryTenantWebsiteClient` for summary + verify

## Verification executed on `e446`

- vitest post-145/147 + go-live flow: 9/9 PASS
- `db:migrations:integrity`: PASS (443 files)
- `db:types:check`: PASS
- `security:audit-production`: PASS (0 vulnerabilities)
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)
- hosted CI: NOT YET

## Intentionally not changed / deferred

- Certification evidence panel remains attest-passed-only.
- `api_client.execute` remains independent of the sell/live gate.
- Official UTILTS matrices / TGT-AGT remain external.
- Live DB apply of new forward migrations not observed in this run.
