# Gridex OPS — Test Results

## Current audit status

This file records only checks actually performed during the audit. Repository command execution is blocked; direct GitHub source inspection and Supabase catalog queries were completed.

## Passed direct checks

| Check | Status | Result |
|---|---|---|
| Repository identity | passed | `heke99/gridex-ops-platform` verified |
| Audit branch identity | passed | exact branch `audit/gridex-ops-full-integrity-review` verified before reads and writes |
| Start commit capture | passed | `3aa8309767dc4fbd58b59322082d85127c48c194` |
| External branch-change preservation | passed | external commit `3eb8445cb840d38af6068d49266ce0881a8e0157` reviewed; it added skills only |
| Supabase project identity | passed | `gridex-ops-dev`, `piidsfebjqjmnepdpnas` |
| Supabase project health | passed | active/healthy at audit time |
| Latest live migration | passed | `20260805085617_api_contract_billing_tenant_hardening` present in live migration history |
| Public schema CREATE privileges | passed | `anon`/`authenticated` cannot CREATE; `service_role` can |
| Public table RLS catalog check | passed | current public base/partitioned tables found by catalog have RLS enabled |
| Core integration tenant binding | passed by source inspection | tenant derived from authenticated API client; scope/status/origin/IP/rate limit fail closed |
| Customer portal sync tenant filters | passed by source inspection | candidate and identity operations include authenticated company scope |
| Website application unknown-field handling | passed by source inspection | explicit top-level/nested allowlist runs before Zod parse |
| Manual inbound webhook authentication | passed by source inspection | bounded raw body, timestamp window and timing-safe HMAC |
| Resend webhook authentication | passed by source inspection | signature verified before event processing |
| Analytics cron authentication | passed by source inspection | configured secret required and timing-safe comparison |
| Portal sync fix presence | passed by exact commit inspection | commit `aeaa08283e714160181cd007f2c04196d6cf88a2` imports `ApiInputError`, preserves controlled status/code/field and keeps unexpected errors generic |
| Portal sync regression source | passed by exact commit inspection | `scripts/gridex-customer-portal-sync-error-contract-regression.cjs` exists and asserts the intended contract |

## Failed or defect-revealing checks

| Check | Status | Result |
|---|---|---|
| Customer portal sync controlled input error mapping at baseline | failed, implementation corrected | original route converted `ApiInputError` to 500; code/test added in `aeaa082…`; execution still blocked |
| Billing webhook response indistinguishability | failed/unverified impact | unknown provider invoice reference and bad signature produce different external status classes; see `BUG-002` |
| Architecture documentation currency | failed/partially mitigated | current root layout conflicts with older `apps/ops` memory references; quality docs and current-task handoff now describe actual layout |
| Complete large-file inventory | blocked | no local archive/checkout; one >8,400-line module verified |

## Blocked checks

All root npm commands listed in `quality/TEST_BASELINE.md` remain blocked because the audit environment cannot run a clean checkout/dependency install. Live end-to-end tests are additionally blocked by deployment and credential requirements.

The newly added command was not executed:

```bash
node scripts/gridex-customer-portal-sync-error-contract-regression.cjs
```

Reason: no local repository checkout and no GitHub Actions workflow run for the commit.

## Required post-commit verification

After the audit commits are checked out in a normal development/CI environment, run at minimum:

```bash
npm ci
node scripts/gridex-customer-portal-sync-error-contract-regression.cjs
npm run lint
npm run typecheck
npm run typecheck:scripts
npm run typecheck:tests
npm test
npm run db:migrations:check
npm run security:rbac
npm run api:compatibility
npm run api:release:verify
npm run api:runtime:parity
npm run ops:hardening-regression
npm run gridex:production-route-readiness-regression
npm run gridex:rls-multisite-metering-billing-regression
npm run security:audit-production
npm run build
```

No readiness level above further testing is justified until those commands and deployment-dependent two-tenant flows complete successfully.
