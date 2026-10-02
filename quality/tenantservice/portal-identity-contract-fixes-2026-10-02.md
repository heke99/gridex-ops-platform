# Independent Web tenant integration: focused OPS corrections

Status: locally verified candidate; unpublished and awaiting root review. No production writes or migrations.

Base: `e98cef3aeefd0c564a4436e2e409bb0a5262c866`; origin/main rechecked unchanged after verification. Branch: `fix/portal-identity-contract-2026-10-02`. Existing Ediel branches, open PRs and checkpoint files are untouched.

## Scope and skill routing

This is a bounded corrective dependency of the authorized Gridex Web independent tenant/support work, rather than a new repository-wide audit. Applied the local systematic-debugging, test-driven-development (including writing-good-tests), fp-check, spec-to-code-compliance, variant-analysis and verification-before-completion guidance. Inspected the repository operating contract, tenantservice checkpoint and relevant API memory; read the installed Next 16.3.8 route-handler guide. Parent/root owns independent final code review and delivery.

No UI, architecture redesign, schema change, dependency change, SQL tuning, hook installation, scanner installation or reusable-skill change is involved; their workflows are inapplicable to this focused patch. The complete affected resolver/link/response paths, tenant-filtered candidate queries, existing idempotency persistence and public response safety boundary were inspected.

## Findings and direct evidence

All four are true positives in the inspected source and local executable reproduction. They require a scoped integration credential; no unauthenticated bypass is claimed.

| Finding | Before | Corrected behavior | Evidence |
|---|---|---|---|
| Conflicting portal/auth user IDs | `resolvePortalCustomer` preferred the portal ID and immediately returned an active account while ignoring a different auth ID | Both provided, trimmed IDs must agree; controlled `422 portal_identity_mismatch` before resolution, regardless of read/link or rollout mode | Linked-user read/link and report-mode tests returned success on baseline, then rejected after fix |
| Read-mode link mutation | Default/report-mode read fell through to `ensureCustomerPortalUserLink`, inserting account and identity rows | Report-mode identifier fallback remains readable but never links; blocked/revoked/takeover checks remain; explicit `mode: link` still operates | Baseline reproduction recorded two identity/account inserts; post-fix no writes and `identifier_match` |
| Nonunique customer sync | First strong candidate ended search; bounded queries silently truncated possible candidates | Refuse multiple strong candidates with `409 ambiguous_customer_match` before identity write; fetch one extra row and refuse incomplete candidate scans | Baseline duplicate/reversed/mixed-factor/truncation cases returned 200; post-fix all return 409 without identity writes; unique and other-tenant controls pass |
| UUID customer reference response | Sync used the caller's UUID `external_customer_id` as `customer_reference`, then public safety rejected it with 500 after an identity write; same fallback existed in profile/bundle/master-data sync/event responses | Use existing organization-scoped opaque `publicReference('customer', company, resolved customer)`; retain `external_customer_id` in its own allowed field | Mounted sync UUID regression was 500, then 200; shared DTO response safety regression and stable/across-organization reference controls pass |

The report-mode defect is latent in default/report deployments. Latest tenantservice memory says production/preview enforcement was explicitly enabled earlier on 2026-10-02; current production environment values were not independently read by this agent. No claim is made that production currently executes report mode.

## Compatibility and boundaries

- Contract remains `2026-10-02.2`; no schema/endpoint/scope changes. All corrected values already fit published schemas.
- API credential still selects the company; all candidate lookups keep the company predicate. Identical factors in another company neither link nor cause a conflict.
- Missing legacy single user-ID inputs retain current compatibility. Conflicting supplied IDs fail rather than selecting one.
- Report mode retains its identifier read fallback; it no longer grants a persistent account merely because a read succeeded. Strict support routes retain active-link enforcement.
- Candidate scans retain bounded resource use. A saturated factor search requires customer-service review, even if the partial rows seem to contain one strong match.
- Existing identity transition checks, blocked-link protection, idempotency, assertions, support quotas and internal payload protection remain enabled. No rollout flag is changed.
- Customer reference now identifies the same OPS customer consistently across local identifier changes; local caller IDs stay in `external_customer_id`.

## Verification

RED before production fixes: resolver 4 failures/14 passes; unique sync 5 failures/2 passes (including UUID 500); customer DTO 2 failures. No live database was contacted by tests. Test doubles replace external persistence/auth while the actual route, request validation, matching, transition guard and response safety execute.

| Check | Result |
|---|---|
| Eight affected Vitest files: resolver, unique sync, public customer reference, transition guard, support routes, support attachment API, bundle audit, controlled input errors | 50/50 pass |
| Four adjacent Vitest files: canonical API release, customer assertions, support conversation, identity match strength | 53/53 pass |
| `npx vitest run --config quality/vitest.config.ts quality/test_functional.test.ts` | 31/31 pass |
| `npm run typecheck` | pass |
| `npm run typecheck:tests` | pass; adapted existing quality fixture by supplying verified company argument, unchanged assertions |
| Scoped ESLint for all changed source/test files and quality functional test | pass |
| `npm run api:docs` | all seven contract/parity/docs/example/shared-component/runtime/correction checks pass at 2026-10-02.2 |
| Customer portal sync error-contract and OPS-V3-BUG-001 controlled-error scripts | pass |
| `node scripts/check-service-role-tenant-ratchet.cjs` | pass; 2,348 current call sites vs baseline 2,353 |
| `git diff --check` | pass |

Initial checks used environment Node 24.19.0; repository engine requires Node 22. Final targeted rerun on Node 22.23.3 passed 103/103 in 12 affected/adjacent files and 31/31 quality functional tests. The harness emitted its existing EnvHttpProxyAgent experimental warning; no test failed. Root authorized a local checkpoint commit after verification; no push is authorized before root review. Full suite, native database replay and production deployment were not run for this unpublished candidate. No migration is needed.

Next action: root reviews the bounded diff and tests; publish in a separate OPS PR only after review, then run required exact-head CI before any merge. Existing masterplan/other PR work must remain untouched.
