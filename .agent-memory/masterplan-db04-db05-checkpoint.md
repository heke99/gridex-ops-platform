# DB-04 / DB-05 checkpoint (Claude, session_011iqKUHUejdrDzQDBYR89SU)

- Branch claude/magical-cerf-55zxau from main 498ebd1. CLAIM: #530 comment 5994563449.
- DB-04 (2026-10-05): the existing native EXPLAIN test (`scripts/ediel-transport-data-query-plan-native.test.ts`) was run by no CI job. Added: masterplan tag, no-Seq-Scan assertion, `quality/audits/ediel-masterplan-v2/db04-query-plan/native.config.ts`, `.github/workflows/ediel-db04-native.yml` (push/dispatch on this branch).
- 2026-10-05 12:40Z CI-GREEN (native, not local): run 37310758561 @9a8ffd7, 1/1 test passed (37s): 7 plans, expected index used, no Seq Scan, <500ms, 2 tenants, 0 leaks. Artifact db04-query-plans.
- BLOCKER for approval: `scripts/ediel-masterplan-test-coverage.cjs` only scans `__tests__/**/*.test.ts` and `scripts/test-ediel-*.cjs`; `--check` fails 'VERIFIED but no test tagged' for a native-only test (reproduced; coverage.json restored, DB-04 stays NOT_VERIFIED). Needs integration-owner decision on how native tests are recognised (shared file, not edited by me).
- Earlier: NOT run locally (no Docker Hub image, 429; no supabase CLI). Local-verified: none. coverage.json NOT changed. DB-04 stays NOT_VERIFIED until the CI run is green and the card is reviewed against the test.
- DB-05 2026-10-05: fp-check CONFIRMED defect F-DB-05-01 (hard delete of companies cascades away audit/billing journal; repro + finding in quality/audits/ediel-masterplan-v2/db05/). No migration written: needs owner decision (guard vs RESTRICT) + root migration order. DB-05 stays NOT_VERIFIED. Existing per-class Ediel retention (gridex_ediel_retention) not yet mapped to the other card parts (access revoke = canonical_transition_tenant_lifecycle; persondata purge).
- Next: push, read the workflow run, then decide DB-04 approval.

## 2026-10-05 DB-05 F-DB-05-01 fix (owner chose: guard on companies/customers)
- Migration `20261005130000_hard_delete_guard_companies_customers.sql` (+ checksum line in scripts/migration-history-manifest.json). BEFORE DELETE guards: companies only if status=deleted_test_only or owner roles postgres/supabase_admin; customers only owner roles (gridex_delete_test_customer_v1 is SECURITY DEFINER). Others get 23001.
- Test `__tests__/db-05-hard-delete-guard.test.ts` (PGlite over supabase/schema.sql snapshot + migration; 7 PASS; RED proof: 5 of 7 fail without the migration). Local: vitest, eslint, typecheck:tests, db:migrations:integrity PASS. Not native PostgreSQL; not CI-run.
- NOT done / for root: regenerate supabase/schema.sql + fingerprint + generated types from a clean replay (shared generated artifacts, not hand-edited); CI parity gates will flag the new migration until then. Check no native test relies on service_role deleting live companies.
- DB-05 / AT-DB-05 stay NOT_VERIFIED: card still needs the other parts (workflow per retention class, access revoke, personal-data purge mapped to asserting tests). Test is intentionally untagged.

## 2026-10-05 13:30Z native CI GREEN @82de2b4 (run 37316852211, 3/3 native tests)
- Clean replay incl. migration 20261005130000 succeeds natively.
- DB-04 query plans PASS (again).
- DB-05 guard native PASS: service_role 23001 on company and customer; rows, audit kept; both triggers enabled.
- DB-05 offboarding native PASS (canonical_transition_tenant_lifecycle): outsider 42501; unsettled billing -> tenant_closure_blocked with nothing changed; after settling: closed, api client revoked, webhook disabled, portal identity disabled, sessions 0; customer, email, customer_events, seeded audit kept, transition audit +2; hard delete after close still 23001.
- Remaining for DB-05 approval: (1) link retention-class purge proof (ediel-retention-sql-regression.mjs, ediel-record-retention-sql-regression.mjs, both PASS locally) into a tagged test the coverage scanner sees; (2) root decision on native-test approvals (same as DB-04); (3) root regenerates schema.sql/types for the migration. Status: CI-green on branch, not reviewed, not merged, coverage unchanged.
