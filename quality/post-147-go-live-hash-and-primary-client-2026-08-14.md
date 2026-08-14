# Post-#147 go-live residuals (2026-08-14)

## Confirmed

1. HIGH — Same `canonical_request_hash_mismatch` class as #147 lifecycle
   repair still present on production activate/pause, first-live-send
   approve, tenant provision, actor profile save, and tenant user-access
   wrappers (payload enrich without atomic hash bind).
2. HIGH — Go-live verify selected newest `tenant_website` client while the
   summary preferred `metadata.primary`, so operators could verify a
   different credential than the one shown.
3. HIGH — Post-#145 Processa om residuals from draft #146 were not on tip
   (terminal job sync + actionable reasons). Relanded on this branch.

## Fix

- Forward `20260814235000_fix_canonical_production_command_request_hash.sql`
- Shared `selectPrimaryTenantWebsiteClient`
- Inbound terminal Processa om + reason plumbing + `20260814210000` repair

## FP / deferred

- Certification evidence UI only attests `passed` (no failed/revoked form):
  intentional for this panel; action still accepts other statuses.
- `api_client.execute` remains independently gated from
  `contract_channel.sell` live production requirement: intentional.
