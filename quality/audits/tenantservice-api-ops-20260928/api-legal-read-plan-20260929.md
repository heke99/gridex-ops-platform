# Delegated legal-acceptance read implementation plan

> For agentic workers: use subagent-driven-development for this single coherent task. Root owns publication and CI; one implementer owns the package.

Goal: make the existing legal-acceptance GET runtime, public OpenAPI, guide and synthetic client agree without changing the database or advertising missing support routes.

Architecture: retain the existing signed customer guard, tenant/customer-scoped read model and explicit public DTO. Add contract and runtime boundary evidence first; materialize one new paired immutable API release using the existing generator.

Tech stack: installed Next.js, TypeScript, Supabase query client, Vitest, local Node synthetic HTTP client.

## Global Constraints

- Work only on `codex/tenantservice-api-structure-20260929` and draft PR #422.
- No edits to #418, SQL migrations, OPS/UI/native fixtures or canonical `requirements.csv`.
- Keep all historical release files, including 2026-09-29.5 and 2026-09-29.7, byte-identical.
- Preserve local commits and user changes. No reset, rebase, force push, merge to main or production actions.
- Do not claim a real event version from v1: absent `event_version` remains null; v2 requires the masterplan migration and native proof.
- No actual customers, credentials, provider calls, user communications or new dependencies.
- No full T/U or P-phase acceptance; evidence is PARTIAL.

### Task 1: legal-acceptance read contract and client package

Files:
- Create `__tests__/customer-api-legal-read-parity.test.ts` and `__tests__/customer-api-legal-read-routes.test.ts`.
- Modify `scripts/finalize-openapi-release.portal.cjs`, release-version inputs/gates and guides following the existing 29.7 release pattern.
- Modify `scripts/tenantservice/customer-api-reference.mjs` for a signed read-only two-page legal journey.
- Generate paired current/immutable OpenAPI releases and routes for `2026-09-29.8` using existing tooling. Do not manually edit generated JSON.
- Create `api-legal-read-evidence-20260929.md` in this audit directory with exact local commands, RED/GREEN and open boundaries.

Interfaces and independent expectations:
- `GET /api/v1/customer/legal-acceptances` is the only operation in this package, with scope `customer_legal.read`, mandatory signed exact-action assertion and no write/idempotency semantics.
- It calls `listPortalLegalAcceptancesPage(context, publicPageInput(searchParams))` and responds with `data` plus `page`.
- Query params `limit` and `cursor` match the verified existing keyset parser (default 50, cap 100; actual implementation verified before encoding these values). Non-positive, fractional and non-numeric limits become null in `publicPageInput` and therefore use the default, not a floor-to-positive interpretation.
- The public DTO has exactly: `acceptance_reference`, `acceptance_type`, `document_reference`, `document_code`, `document_version`, `document_hash`, `accepted_at`, `source`, `created_at`.
- `acceptance_reference` matches `^acceptance_[A-Za-z0-9_-]{32}$`; document reference derives from bundle-document ID, or legacy legal-text ID, and is nullable. Other nullable fields follow actual `publicPortalLegalAcceptance`, not desired future semantics.
- Never expose raw IDs, snapshot, metadata, trace/request IDs, customer/tenant IDs, contract relations or signatures.
- Runtime query filters `company_id` and `customer_id` before keyset limit, with accepted_at/ID descending order, customer/resource-bound cursor and schema fallbacks already implemented. Test these existing properties without claiming native SQL proof.
- There are no external support/case/message/attachment endpoints in the current customer runtime/register; do not create or document them in this package.

- [x] Step 1: write reproducing contract tests before generator edits. Assert missing query params, concrete data/item schema, page schema and independently hand-derived DTO fields/nullability. Run and record expected RED failures against 29.7.
- [x] Step 2: run the actual GET route using only synthetic service boundary doubles. Positive row projects the nine public fields; scope/failed delegation must stop before reading; another customer/tenant/resource or tampered cursor gives controlled 400 with no list read; stable tied timestamp/ID pagination has no duplicates; schema fallback produces truthful null fields. Keep real guard/error/DTO/parser code where practical and clearly label mock boundaries.
- [x] Step 3: minimally add `CustomerLegalAcceptance` and paginated response contract plus query descriptions in the existing finalizer. Do not alter successful runtime behavior solely to justify a code diff. If a separate runtime defect appears, report it before expanding scope.
- [x] Step 4: set version 29.8 in all required release inputs, registry/routes, guides and gates; preserve old release paths. Materialize through existing `api:finalize` process and verify deterministic output twice.
- [x] Step 5: extend the signed synthetic HTTP fixture/client to follow two legal pages, reject wrong signed action and foreign cursor, check expected public/null fields and no internal snapshot. No network except loopback.
- [x] Step 6: run targeted tests, app/test/script typechecks, scoped lint, API docs/compatibility/releaseverify/runtimeparity, synthetic client and relevant build. Record evidence and scope limits. Root may run broader verification after review; do not push.
- [x] Step 7: self-review, stage only package files and this plan, commit, and report commit(s), exact test commands/results, RED/GREEN details, changed paths and any concerns in the assigned report file.

Implementation evidence: `api-legal-read-evidence-20260929.md`. The checkpoint remains PARTIAL; root-owned independent review, broader configured tests/lint/quality and publication are not implied by these checked local implementation steps.

## Routing and known limits

Use TDD/systematic-debugging/verification-before-completion, installed Next route docs and Supabase filter guidance. Repository-wide quality-playbook/codebase-document creation triggers are absent for this narrowly scoped contract checkpoint. UI, database optimization, migration and external activation workflows are outside this API ownership. Request read-only review before publication. GitGuardian CLI is not installed/configured here; no scanner qualification is implied by synthetic-data inspection. Root will record the available repository secret gate and any blocked scan honestly.
