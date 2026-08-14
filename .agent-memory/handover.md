# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-8637` closes post-`fe3b9425`
(#136 tip health) residuals that remained after the tenant-website lifecycle
guard fixes landed.

Main tip `fe3b9425` merged lifecycle resume exemption
(`20260814180000`), permissions promote pause for non-canonical active
clients, and the shared `isTenantWebsiteIntegrationClient` helper. Tip hunt
after merge found the OpenAPI docs residuals previously queued on unmerged
`515d`/`#137`:

1. Developer endpoint table still joined multi-scope routes with `eller` (OR)
   even when `scopeMode=all` (AND), mis-documenting portal-bundle after #128.
2. `OPENAPI_RELEASED_AT` still pointed at `2026-08-10` while
   `WEBSITE_INTEGRATION_CONTRACT_VERSION` is `2026-08-14.1`.

This branch:

1. Makes `PUBLIC_API_ENDPOINT_ROWS` join with `och` for `scopeMode=all` and
   `eller` for `scopeMode=any`.
2. Sets `OPENAPI_RELEASED_AT` to `2026-08-14T12:00:00.000Z`.
3. Adds `__tests__/post-128-openapi-tip-residuals.test.ts` regression coverage.

Prefer this tip-based branch over draft `#137`/`515d` (same OpenAPI fixes plus
auth fixes that are already on main via #136). Close `#137` as superseded after
`8637` merges.

ggshield was unavailable in this environment; run secret scan in CI/host.
