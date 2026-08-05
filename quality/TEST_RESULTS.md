# Gridex OPS — Test Results

## Current audit status

This file records only checks that were actually performed. Evidence now comes from:

- direct GitHub source inspection on `audit/gridex-ops-full-integrity-review`;
- direct Supabase catalog/project queries performed during the initial audit;
- GitHub Actions workflow `OPS hardening`, run `31050422153`, against commit `f55805e235abf3296aebcabdd8ba1eab21a8b844`.

The successful workflow does not cover every command in the v2 prompt and does not prove deployed/live parity.

## Passed direct checks

| Check | Status | Result |
|---|---|---|
| Repository identity | passed | `heke99/gridex-ops-platform` verified |
| Audit branch identity | passed | exact branch `audit/gridex-ops-full-integrity-review` verified before reads and writes |
| Original audit start commit | passed | `3aa8309767dc4fbd58b59322082d85127c48c194` |
| V2 supplement start commit | passed | `1028bdde8f944ee69154d761e7cdc00c0afd3756` |
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

## GitHub Actions — passed on `f55805e235abf3296aebcabdd8ba1eab21a8b844`

Workflow: `OPS hardening`, run `31050422153`, job `verify`, conclusion `success`.

| Executed step | Result |
|---|---|
| `npm ci` | passed |
| `npm run db:migrations:check` | passed |
| `npm run gridex:api-billing-tenant-hardening-regression` | passed |
| `npm run typecheck` | passed |
| `node scripts/gridex-quote-idempotency-multitenant-regression.cjs` | passed |
| `npx vitest run __tests__/usage-event-and-integration-idempotency.test.ts` | passed |
| `npm run ops:hardening-regression` | passed |
| `npm run ops:hardening-behavior-regression` | passed |
| `npm run ops:final-contract-regression` | passed |
| `npm run api:error-boundaries` | passed |
| `npm run security:audit-production` | passed |

This workflow proves that the approved GitHub runner could install the locked dependencies and execute the listed checks. It does not prove commands absent from the workflow, live provider behavior, deployed environment configuration, or production tenant isolation.

## Failed or defect-revealing checks

| Check | Status | Result |
|---|---|---|
| Customer portal sync controlled input error mapping at baseline | failed, implementation corrected | original route converted `ApiInputError` to 500; code/test added in `aeaa082…`; the dedicated new regression command remains unexecuted |
| Billing webhook response indistinguishability | failed/unverified impact | unknown provider invoice reference and bad signature produce different external status classes; see `BUG-002` |
| Architecture documentation currency | failed/partially mitigated | current root layout conflicts with older `apps/ops` memory references; quality docs and current-task handoff now describe actual layout |
| Complete large-file inventory | blocked | no complete local line-count scan; one >8,400-line module verified |
| Canonical `.env.example` | failed/gap found | exact branch path is absent; documented in `quality/API_CONFIGURATION.md` |
| CI action immutability | gap found | workflow uses mutable major tags `actions/checkout@v4` and `actions/setup-node@v4` |

## V2 source and skill checks

| Check | Status | Result |
|---|---|---|
| Installed skill inventory | passed | 31 branch-local skill files were found and directly read as UTF-8 |
| Skill hash/source records | passed with limitation | `skills-lock.json` records `computedHash` and upstream source for all 31 installed skills; hashes were not independently recomputed from raw bytes |
| Mandatory v2 skill availability | passed | all mandatory skill paths in the v2 prompt were readable |
| Recommended skill gap check | passed | exact paths for `doubt-driven-development`, `performance-optimization`, `documentation-and-adrs`, and `sql-optimization-patterns` returned not found |
| Skill credential/cost classification | passed by source inspection | no Markdown skill itself embedded a separate API key or billing requirement; external execution services remain separate dependencies |
| Existing environment checklist | passed | `docs/env-production-checklist.md` exists and identifies its inventory as a grep from 2026-07-03 |
| Supabase runtime env failure behavior | passed by source inspection | public/server helpers throw outside the production-build phase when required values are absent |
| Supabase build placeholder behavior | passed by source inspection | production-build phase uses placeholders; build success is not runtime configuration proof |
| Scheduled request secret behavior | passed by source inspection | dedicated and allowed global cron secrets are compared timing-safely; no configured accepted secret returns unauthorized |
| Root lifecycle script check | passed by manifest inspection | no root `preinstall`, `install`, `postinstall`, `prepare`, or `prepublishOnly` script identified |
| Lockfile advisory-presence review | passed with reachability limitation | advisory-range `brace-expansion` versions are present in inspected dev dependency trees; production exposure remains unverified |

## Checks still blocked or not executed

The following must not be inferred from the successful hardening workflow:

| Check | Status | Exact reason |
|---|---|---|
| `node scripts/gridex-customer-portal-sync-error-contract-regression.cjs` | not executed | not included in run `31050422153` |
| `npm run lint` | not executed | not included in the workflow |
| `npm run typecheck:scripts` | not executed | not included in the workflow |
| `npm run typecheck:tests` | not executed | not included in the workflow |
| full `npm test` | not executed | only one targeted Vitest file ran |
| `npm run security:rbac` | not independently executed | may overlap other regressions, but no direct command result exists |
| `npm run api:compatibility` | not executed | absent from the workflow |
| `npm run api:release:verify` | not executed | absent from the workflow |
| `npm run api:runtime:parity` | not executed | absent from the workflow and requires runtime context |
| `npm run gridex:production-route-readiness-regression` | not executed | absent from the workflow |
| `npm run gridex:rls-multisite-metering-billing-regression` | not executed | absent from the workflow |
| `npm run build` | not executed | absent from the workflow |
| `npm audit --json` | not executed | `security:audit-production` passed, but it is not represented as a raw npm-audit result here |
| `npm explain brace-expansion` | not executed | dependency reachability analysis was not part of the workflow |
| independent skill SHA-256 recomputation | blocked | no controlled raw-byte checkout/hash pass |
| Dependabot alert reconciliation | blocked | alerts API returned 403 because the security product was not enabled or accessible |
| SAST execution | blocked | no configured scanner result was available |
| full current-tree and Git-history secret scan | blocked | no authenticated history scanner result |
| OpenAPI → deployed runtime parity | blocked | no approved deployment credential and no live tenant/API-client fixture |
| preview/staging runtime environment validation | blocked | no approved deployment access |
| deployed two-tenant legal/POA/customer/billing/EDIEL E2E | blocked | deployment credentials and external provider fixtures unavailable |

## Required remaining verification

Run the missing commands in an approved CI or clean checkout and preserve exit codes and outputs:

```bash
node scripts/gridex-customer-portal-sync-error-contract-regression.cjs
npm run lint
npm run typecheck:scripts
npm run typecheck:tests
npm test
npm run security:rbac
npm run api:compatibility
npm run api:release:verify
npm run api:runtime:parity
npm run gridex:production-route-readiness-regression
npm run gridex:rls-multisite-metering-billing-regression
npm run build
npm audit --json
npm explain brace-expansion
```

Then run the approved SAST/secret scans and deployed two-tenant/provider/EDIEL checks.

The successful hardening workflow materially improves the baseline, but it does not justify a production-ready verdict while the dedicated portal-sync regression, full command matrix, live OpenAPI/runtime parity, dependency reachability and deployed E2E remain incomplete.