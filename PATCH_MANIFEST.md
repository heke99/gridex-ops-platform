# Patchmanifest

## Identitet

- Projekt: Gridex OPS
- Bas: `gridex-ops-platform-main(105).zip`
- Leverans: canonical price-option/publication/website API completion
- API-release: `2026-07-30.3`
- Omfattning: 69 filer — 3 nya och 66 ändrade
- Borttagna filer: inga

## Faktiska fel som reparerats

- `ContractPriceOption` var inte nåbart från `PublicContract`.
- Prisalternativ saknade exakt publiceringskoppling, kundtyp, default och
  selection-policy.
- Quote, validate och application använde inte samma fullständiga kommersiella
  assertioner.
- Legal runtime och OpenAPI skilde på dokument-UUID och extern referens.
- Centrala publika scheman var öppna och releasekontroller kunde missa drift.
- Kärnflödets publika onboarding-entry point var beroende av äldre
  textreplacement-reparationer.
- Slutgrinden upptäckte dessutom att portalavtalets
  `signature_snapshot_sha256` saknades i DTO/OpenAPI trots dokumenterad
  runtimekälla.

## Nya filer

- `PATCH_MANIFEST.md`
- `scripts/gridex-canonical-price-options-post-apply.sql`
- `supabase/migrations/20260730220000_canonical_price_option_publication_api_completion.sql`

## Ändrade filer

- `.agent-memory/checkpoint.json`
- `.agent-memory/completed-work.md`
- `.agent-memory/current-state.md`
- `.agent-memory/current-task.md`
- `.agent-memory/decisions.md`
- `.agent-memory/handover.md`
- `.agent-memory/known-failures.md`
- `.agent-memory/open-blockers.md`
- `.agent-memory/session-log.md`
- `.agent-memory/verification-matrix.md`
- `.agent-memory/work-plan.md`
- `CHANGED_FILES_CUSTOMER_PORTAL_API_PRODUCTION_COMPLETION_2026-07-30.txt`
- `GRIDEX_CONTRACT_CHANNEL_PUBLICATION_COMPLETION_2026-07-28.md`
- `PATCH_NOTES.md`
- `VERIFICATION.md`
- `__tests__/api-canonical-release.test.ts`
- `__tests__/contract-admin-schema.test.ts`
- `__tests__/contract-channel-publication-completion.test.ts`
- `__tests__/contract-commercial-selection.test.ts`
- `__tests__/market-price-api-contract.test.ts`
- `__tests__/public-contract-website-visibility.test.ts`
- `app/admin/contracts/actions.ts`
- `app/api/v1/website/quote/route.ts`
- `app/api/v1/website/quote/validate/route.ts`
- `app/developers/customer-portal-api/page.tsx`
- `components/admin/contracts/CommercialPricingEditor.tsx`
- `docs/ai-context/10_CHANGELOG.md`
- `docs/canonical-market-resolution-quote-billing-flow-2026-07-24.md`
- `docs/external-integration-contract-tests.md`
- `docs/external-website-api-integration-guide.md`
- `docs/gridex-customer-portal-api.md`
- `docs/openapi/customer-portal-v1.json`
- `docs/openapi/website-integration-v1.json`
- `docs/ops-api-customer-intake-facility.md`
- `docs/ops-summary-1-api-completion-2026-07-22.md`
- `docs/single-api-key-tenant-integration.md`
- `docs/staging-smoke-test-checklist.md`
- `lib/customer-portal/publicDto.ts`
- `lib/external-contracts/publicationDto.ts`
- `lib/integrations/websiteApiContract.ts`
- `lib/integrations/websiteIntegrationContract.ts`
- `lib/pricing/commercialModel.ts`
- `lib/pricing/offerQuote.ts`
- `lib/pricing/websiteQuotes.ts`
- `lib/website/customerApplications.ts`
- `lib/website/publicContracts.ts`
- `lib/website/publicCustomerApplication.ts`
- `scripts/check-api-compatibility.cjs`
- `scripts/check-api-documentation-examples.cjs`
- `scripts/check-api-documentation-version.cjs`
- `scripts/check-openapi-runtime-parity.cjs`
- `scripts/finalize-openapi-release.cjs`
- `scripts/gridex-canonical-fixed-area-flow-regression.cjs`
- `scripts/gridex-canonical-market-resolution-quote-billing-regression.cjs`
- `scripts/gridex-canonical-portfolio-pricing-regression.cjs`
- `scripts/gridex-contract-api-signature-visibility-regression.cjs`
- `scripts/gridex-contract-channel-publication-regression.cjs`
- `scripts/gridex-contract-commercial-selection-regression.cjs`
- `scripts/gridex-contract-go-live-regression.cjs`
- `scripts/gridex-contract-security-energy-direction-regression.cjs`
- `scripts/gridex-contract-single-source-regression.cjs`
- `scripts/gridex-invoice-fee-canonical-regression.cjs`
- `scripts/gridex-market-price-api-regression.cjs`
- `scripts/gridex-public-pricing-visibility-regression.cjs`
- `scripts/migration-history-manifest.json`
- `scripts/verify-openapi-release.cjs`

## Migration och backfill

Kör migrationen efter samtliga tidigare registrerade migrationer. Den binder
endast rader till en publicering när produkt-/prisplansgrafen ger exakt en
deterministisk kandidat. Ambiguiteter eller ofullständig policy lämnas orörda
och registreras i `contract_pricing_migration_reviews`. Signerade avtals-
snapshots muteras inte. Kör därefter den read-only post-apply-kontrollen.

## Verifiering

- Migration integrity: 325 filer / 229 versionsgrupper.
- TypeScript: app, scripts, tests, EDIEL och contract-profiler passerar.
- Vitest: 58 filer / 376 tester.
- Lint: 0 fel / 124 befintliga varningar.
- API: contract, parity, docs, examples, compatibility och release passerar.
- Sammansatta kontraktsgrindar: commercial selection, channel publication,
  fixed-area och go-live passerar.
- Next.js 16.2.6 produktionsbuild passerar med temporär 4096 MB Node-heap.

## Risker och manuella produktionssteg

- PostgreSQL fresh/upgrade apply och post-apply är inte körda.
- Tre äldre duplicerade migrationstimestamps måste lösas från authoritative
  applied-ledger; byt inte namn utan den evidensen.
- Deploya OPS och verifiera exakt manifest/OpenAPI-SHA innan Web synkas.
- Gridex Web saknades och ingår inte i patchen.
- Två-tenant-, concurrency-, webhook- och provider-E2E återstår i staging.
