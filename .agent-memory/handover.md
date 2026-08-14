# Handover

Updated: 2026-08-14

Branch `cursor/codebase-health-and-stability-515d` closes tip residuals after
`6f9b5d66` (Merge PR #128 portal-bundle OpenAPI scopes).

Main tip after `#135` still left lifecycle resume vs activation guard and
permissions-promote go-live bypass open on `9740`/`#136`. `#128` then landed
on tip and made `#136` unsafe to merge as-is (would regress `2026-08-14.1`
OpenAPI artifacts/scopes). `#128` also left developer docs joining portal-bundle
scopes with "eller" despite `scopeMode=all`, and a stale `OPENAPI_RELEASED_AT`.

This branch (rebased on tip):

1. Adds forward `20260814180000` lifecycle-resume exemption for launch-ready
   tenant website clients paused with `lifecycle_paused_by_tenant`.
2. Forces `paused` + `TENANT_WEBSITE_PERMISSIONS_REQUIRE_CANONICAL_GO_LIVE`
   when permissions UI promotes an already-active non-canonical client.
3. Shares `isTenantWebsiteIntegrationClient` from
   `lib/integrations/tenantWebsiteClient.ts`.
4. Joins developer endpoint scopes with `och` when `scopeMode=all`.
5. Bumps `OPENAPI_RELEASED_AT` to `2026-08-14T12:00:00.000Z`.

Prefer merging `515d`, then closing `#136` as superseded rather than rebasing
`9740`.

ggshield was unavailable in this environment; run secret scan in CI/host.
Live DB apply of `20260814180000` was not observed in this run.
