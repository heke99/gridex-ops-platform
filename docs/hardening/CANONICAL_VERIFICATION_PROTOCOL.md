# Canonical hardening verification protocol

Status values are limited to **PASS**, **FAIL** and **NOT VERIFIED**.

## Local verification results

| Check | Status | Evidence |
|---|---|---|
| Forward-only migration integrity | PASS | `node scripts/check-migration-versions.cjs`: 335 files, 239 version groups, checksums verified. |
| Canonical hardening static regression | PASS | Permissions, tenant scope, evidence, lifecycle, workers and migration contracts. |
| OPS behavior regression | PASS | Address cases, parsing/SSRF, UUID normalization and fail-closed outbox claim. |
| Ediel routing security regression | PASS | `ediel-routing-security-regression: ok`. |
| Inbound tenant resolution regression | PASS | Static inbound tenant-resolution checks passed. |
| Canonical multi-tenant static regression | PASS | TenantContext/API/onboarding/tenant-qualified write checks passed. |
| Script/JSON syntax checks | PASS | New/changed CJS scripts passed `node --check`; `package.json` and the migration manifest passed JSON parsing. |
| Existing `ops-hardening-regression.cjs` | FAIL | Pre-existing unrelated expectation: `lib/website/customerApplications.ts` lacks `website_application_committed`. This delivery did not alter that file. |
| Dependency installation | FAIL | `npm ci` could not fetch `zod-validation-error-4.0.2.tgz` from the configured package registry (`E404`). |
| Full TypeScript typecheck | NOT VERIFIED | Dependencies and Next.js/React/Node types are unavailable. Global `tsc` exited 2 with 36,142 diagnostics; among changed files, 1,264 diagnostics were limited to missing modules/types, missing JSX intrinsics/JSX runtime, missing `Buffer`, and React `key` follow-on errors. |
| Full ESLint | NOT VERIFIED | Dependencies unavailable. |
| Full unit/integration test suite | NOT VERIFIED | Dependencies unavailable. |
| Full Next.js build | NOT VERIFIED | Dependencies unavailable. |
| Production readiness runtime regression | NOT VERIFIED | Could not load `@supabase/supabase-js`. |
| Migration apply on staging | NOT VERIFIED | No staging database/CLI credentials available. |
| Preflight against real data | NOT VERIFIED | No staging database available. |
| DB tenant-FK/test-production regression | NOT VERIFIED | Script supplied; requires staging fixture IDs. |
| Authenticated RLS regression | NOT VERIFIED | Script supplied; requires two real authenticated users/tenants. |
| Lifecycle concurrency/idempotency | NOT VERIFIED | Requires concurrent staging transactions. |
| SMTP/IMAP/S/MIME | NOT VERIFIED | Requires configured external services and certificates. |
| Real AGT/TGT/system-test portal evidence | NOT VERIFIED | Requires external portal traffic. |
| Pause after claim/before external transport | NOT VERIFIED | Runtime guards are implemented; provider-level staging execution is required. |

## Required commands

```bash
# Install
npm ci

# Static local quality gates
npm run lint
npm run typecheck
npm run typecheck:scripts
npm run typecheck:tests
npm run test
npm run build

# Migration and hardening integrity
npm run db:migrations:integrity
npm run ops:canonical-production-hardening

# Database preflight
export DATABASE_URL='postgresql://...'
npm run ops:canonical-production-preflight

# Apply to linked staging only after preflight review
supabase link --project-ref "$SUPABASE_STAGING_PROJECT_REF"
supabase db push --linked --include-all

# Regenerate database types after successful staging apply
supabase gen types typescript --linked --schema public > lib/supabase/database.types.ts
npm run typecheck

# Service-role database invariants. Fixture IDs must represent:
# tenant A test run, tenant B test message, tenant A production message.
export GRIDEX_TEST_RUN_A_ID='...'
export GRIDEX_TEST_MESSAGE_B_ID='...'
export GRIDEX_PRODUCTION_MESSAGE_A_ID='...'
npm run ops:canonical-production-db-regression

# Authenticated RLS. Use two real active users and two different tenants.
export GRIDEX_TEST_COMPANY_A_ID='...'
export GRIDEX_TEST_COMPANY_B_ID='...'
export GRIDEX_TEST_USER_A_ID='...'
export GRIDEX_TEST_USER_B_ID='...'
npm run ops:canonical-production-rls-regression

# Focused regressions executed locally in this delivery
node scripts/ops-hardening-behavior-regression.cjs
node scripts/ediel-routing-security-regression.cjs
node scripts/ediel-inbound-tenant-resolution-regression.cjs
node scripts/canonical-multitenant-platform-regression.cjs
```

## Mandatory staging scenarios

- Two tenants execute the same AGT/TGT cases concurrently.
- Cross-tenant attachment fails even under service role.
- Production/test-flag-zero messages cannot attach as evidence.
- UL2 KVART and UL3 SCH require distinct semantic evidence.
- UTILTS does not pass before final inbound APERAK.
- Tenant pause before claim and after claim prevents transport.
- Closed tenant cannot prepare, activate or resume production.
- Route/certificate/role/rule/test-package change creates a new snapshot and stales previous evidence.
- Last owner/admin invariants and owner-assignment rules are enforced concurrently.
- RLS is tested with authenticated JWT contexts, not only service role.

## Final decision

**NO-GO** until every mandatory staging scenario is **PASS**, the full install/typecheck/test/build pipeline is green and real external transport/test evidence has been recorded.
