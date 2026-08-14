# Current state

Updated: 2026-08-14

## Tip health after #136 merge

- Main tip: `fe3b9425` (`Merge PR #136: close post-#135 tenant website lifecycle residuals`).
- Active health branch: `cursor/codebase-health-and-stability-8637`.
- #136 closed lifecycle resume + permissions promote residuals on tip.
- Unmerged `#137`/`515d` OpenAPI docs residuals remain on tip and are closed here.

## Residuals closed on `8637`

1. LOW — `PUBLIC_API_ENDPOINT_ROWS` scope join follows `scopeMode` (`och`/`eller`)
2. LOW — `OPENAPI_RELEASED_AT` aligned to `2026-08-14T12:00:00.000Z` for contract day `2026-08-14.1`

## Verification executed on `8637`

- vitest OpenAPI residuals + go-live/lifecycle: 29/29 PASS
- `db:migrations:integrity`: PASS (434 files)
- `security:audit-production`: PASS (0 vulnerabilities)
- `tsc -p tsconfig.app.json`: PASS
- ggshield: BLOCKED (CLI not installed)
- hosted CI: NOT YET

## Intentionally not changed

- Auth/lifecycle migrations from #136 (already on tip; immutable).
- Official UTILTS matrices / TGT-AGT remain external.
- Platform-admin operate bypass remains intentional.
- DB scope-heuristic DiD beyond profile_key left for a later pass.
- Historical `.patch-backups/` and Ediel UNH `eller` wording left alone.
