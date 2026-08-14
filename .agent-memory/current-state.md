# Current state

Updated: 2026-08-14

## Tip health after #135 merge

- Main tip: `fbb8e617` (`Merge PR #135: close post-#134 health residuals`).
- Active health branch: `cursor/codebase-health-and-stability-9740`.
- Hosted CI for `#135` was still in progress at branch start; tip residual hunt
  found second-order activation-guard gaps introduced by the go-live series.

## Residuals closed on `9740`

1. HIGH — Lifecycle resume vs tenant_website activation guard
   Forward migration `20260814180000_tenant_website_activation_lifecycle_resume.sql`
2. HIGH — Permissions promote of active non-canonical clients to tenant_website
3. LOW — Shared `isTenantWebsiteIntegrationClient` helper (UI/server drift class)

## Verification executed on `9740`

- vitest go-live + lifecycle + circuit + RLS UI: 34/34 PASS
- `db:migrations:integrity`: PASS (434 files)
- `security:audit-production`: PASS (0 vulnerabilities)
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)
- hosted CI: NOT YET

## Intentionally not changed

- Applied activation guard / receipt-binding migrations (immutable; forward only).
- Official UTILTS matrices / TGT-AGT remain external.
- Platform-admin operate bypass remains intentional.
- DB scope-heuristic DiD beyond profile_key left for a later pass (app layer
  already fail-closed after #135).
