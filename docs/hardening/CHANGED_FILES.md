# Changed and new files

The delivery preserves the existing navigation, URL and component structure. Files are grouped below.

## Admin actions and pages

- `app/admin/ediel/actions.ts`
- `app/admin/ediel/agt/[testCaseCode]/page.tsx`
- `app/admin/ediel/agt/actions.ts`
- `app/admin/ediel/agt/page.tsx`
- `app/admin/ediel/outbox/actions.ts`
- `app/admin/ediel/portal-feedback/actions.ts`
- `app/admin/ediel/system-tests/actions.ts`
- `app/admin/ediel/system-tests/cases/[id]/page.tsx`
- `app/admin/ediel/system-tests/page.tsx`
- `app/admin/platform/actor-testing/actions.ts`

## Runtime libraries

- `lib/auth/requirePermissionServer.ts`
- `lib/ediel/actionAccess.ts`
- `lib/ediel/actorTestingEngine.ts`
- `lib/ediel/db.ts`
- `lib/ediel/flows/utiltsDataRequest.ts`
- `lib/ediel/outbox/claimOutboxItems.ts`
- `lib/ediel/outbox/sendOutboxItem.ts`
- `lib/ediel/productionReadiness.ts`
- `lib/ediel/testing/agtEngine.ts`
- `lib/ediel/testing/selftest.ts`
- `lib/ediel/testing/tgtAutopilot.ts`
- `lib/ediel/types.ts`
- `lib/email/emailOutbox.ts`
- `lib/integrations/webhooks.ts`
- `lib/tenant/governance.ts`
- `lib/tenant/operationPolicy.ts`

## Migrations

- `supabase/migrations/20260802010000_canonical_tenant_operation_policy_lifecycle.sql`
- `supabase/migrations/20260802011000_canonical_ediel_production_state.sql`
- `supabase/migrations/20260802012000_ediel_configuration_snapshots.sql`
- `supabase/migrations/20260802013000_ediel_test_evidence_v2.sql`
- `supabase/migrations/20260802014000_canonical_provisioning_access.sql`
- `supabase/migrations/20260802015000_canonical_backfill_constraints.sql`

## Verification scripts

- `scripts/canonical-production-hardening-db-regression.sql`
- `scripts/canonical-production-hardening-preflight.sql`
- `scripts/canonical-production-hardening-regression.cjs`
- `scripts/canonical-production-hardening-rls-regression.sql`
- `scripts/ops-hardening-behavior-regression.cjs`

## Configuration/manifest

- `package.json`
- `scripts/migration-history-manifest.json`

## Added documentation

- `docs/hardening/CANONICAL_HARDENING_IMPLEMENTATION.md`
- `docs/hardening/CANONICAL_PREFLIGHT_BACKFILL_REPORT.md`
- `docs/hardening/CANONICAL_CUTOVER_ROLLBACK_PLAN.md`
- `docs/hardening/CANONICAL_VERIFICATION_PROTOCOL.md`
- `docs/hardening/CHANGED_FILES.md`
