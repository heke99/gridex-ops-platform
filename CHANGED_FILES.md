# Ändrade och tillagda filer

Katalogen `files/` bevarar sökvägar relativt Gridex Ops-repots rot.

## Projektminne

- `.agent-memory/checkpoint.json`
- `.agent-memory/completed-work.md`
- `.agent-memory/current-state.md`
- `.agent-memory/current-task.md`
- `.agent-memory/handover.md`
- `.agent-memory/open-blockers.md`
- `.agent-memory/session-log.md`
- `.agent-memory/verification-matrix.md`

## Runtime och tester

- `__tests__/api-canonical-release.test.ts`
- `app/api/v1/integration/context/route.ts`
- `app/api/v1/openapi/release-manifest.json/route.ts`
- `app/api/v1/website/quote/route.ts`
- `eslint.config.mjs`
- `lib/api/apiError.ts`
- `lib/customer-portal/externalApi.ts`
- `lib/integrations/openApiReleaseManifest.ts`
- `lib/integrations/openApiResponse.ts`
- `lib/integrations/webhooks.ts`
- `lib/integrations/websiteApiContract.ts`

## OpenAPI och generator

- `docs/openapi/customer-portal-v1.json`
- `docs/openapi/website-integration-v1.json`
- `scripts/finalize-openapi-release.cjs`

## Migrationer

- `scripts/migration-history-manifest.json`
- `supabase/migrations/20260728170000_live_schema_code_canonical_sync.sql`
  (återställd trusted originalfil)
- `supabase/migrations/20260730130000_historical_sync_forward_repair.sql`
  (ny)

## Borttagningar

Inga projektfiler tas bort.
