# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-e446` closes tip residuals after
`c5756245` (#147 production verification).

#147 repaired lifecycle request-hash binding and gated website sales on live
production, but:

1. The same security-convergence wrapper pattern still updated
   `request_payload` without `request_hash` for production activate/pause,
   first-live-send approve, tenant provision, actor profile save, and tenant
   user-access — the hash guard still fails those paths.
2. Go-live verify selected the newest `tenant_website` client while the panel
   summary preferred `metadata.primary`.
3. Draft #146 Processa om residuals were not on main; tip still excluded
   terminal jobs and invented opaque `review_reason` tokens.

This branch:

1. Relands inbound terminal Processa om sync + actionable reasons +
   `20260814210000`.
2. Adds forward `20260814235000` for the remaining hash-binding variants.
3. Shares `selectPrimaryTenantWebsiteClient` between summary and verify.

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of the new forward migrations was not observed in this run.
