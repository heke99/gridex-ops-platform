# Current state

Updated: 2026-08-14

## Tip health after #128 merge

- Main tip: `6f9b5d66` (`Merge PR #128: align portal-bundle OpenAPI scopes with runtime`).
- Active health branch: `cursor/codebase-health-and-stability-515d`.
- `#135` closed post-#134 residuals at `fbb8e617`. `#128` then aligned
  portal-bundle OpenAPI scopes. Unmerged `9740` / `#136` still held
  post-#135 auth residuals and was pre-`#128` (merge would regress OpenAPI).

## Residuals closed on `515d`

1. HIGH — Lifecycle company resume vs activation guard
   Forward migration `20260814180000_tenant_website_activation_lifecycle_resume.sql`
2. HIGH — Permissions promote of already-active non-canonical clients
3. LOW — Shared `lib/integrations/tenantWebsiteClient.ts` classifier
4. LOW — Developer endpoint table AND (`och`) for `scopeMode=all`
5. LOW — `OPENAPI_RELEASED_AT` aligned to `2026-08-14.1` contract day

## Verification executed on `515d`

- vitest go-live + lifecycle + post-128 OpenAPI residuals: 29/29 PASS
- `db:migrations:check`: PASS (434 files)
- `security:audit-production`: PASS (0 vulnerabilities)
- `tsc -p tsconfig.app.json`: PASS
- variant analysis of the four known classes: none found
- ggshield: BLOCKED (CLI not installed)
- hosted CI: NOT YET

## Intentionally not changed

- Applied RLS / activation migrations already on tip (immutable).
- Official UTILTS matrices / TGT-AGT remain external.
- Open `#136` (`9740`) is a pre-`#128` vehicle; prefer `515d` and close
  `#136` as superseded after `515d` merges.
