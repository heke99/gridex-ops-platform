# Gridex OPS — Central Bug Register

## Status model

Only these statuses are used: `open`, `in_progress`, `verified`, `fixed`, `partially_fixed`, `blocked`, `unverified`, `accepted_risk`, `not_applicable`.

## Current totals

| Severity | Total | Fixed | Partially fixed | Open | Blocked | Unverified |
|---|---:|---:|---:|---:|---:|---:|
| Critical | 0 | 0 | 0 | 0 | 0 | 0 |
| High | 0 | 0 | 0 | 0 | 0 | 0 |
| Medium | 5 | 2 | 0 | 1 | 0 | 2 |
| Low | 4 | 2 | 1 | 0 | 1 | 0 |

No Critical or High issue was verified in the reviewed and executed paths. This is not proof that none exists repository-wide: deployed two-tenant/provider/EDIEL flows, complete service-role coverage, SAST/history secret scanning and browser accessibility remain incomplete.

## BUG-001 — Customer Portal sync converted controlled input errors to HTTP 500

- Severity: `Medium`
- Status: `fixed`
- Category: API / error contract
- File: `app/api/v1/customer-portal/sync/route.ts`
- Symbol: route error handler
- Evidence: bounded JSON parsing can throw `ApiInputError` with controlled 400/413 status, code and field; the baseline catch converted every error into generic HTTP 500.
- Actual behavior: invalid or oversized client requests were misclassified as server faults.
- Expected behavior: controlled input failures retain their 4xx status and machine-readable contract; unexpected faults remain generic 500.
- Impact: incorrect retry and diagnostic behavior; no cross-tenant or data-loss path verified.
- Fix: preserve controlled status/code/message/field, log the actual classification and keep unexpected internal details private.
- Regression: `scripts/gridex-customer-portal-sync-error-contract-regression.cjs`.
- Commit: `aeaa08283e714160181cd007f2c04196d6cf88a2`.
- Verification: the dedicated regression passed in the expanded V3 workflow before the later full-suite fixture failure; the production source has not changed since.

## BUG-002 — Billing webhook target/signature failures are externally distinguishable

- Severity: `Medium`
- Status: `unverified`
- Category: security / webhook / enumeration
- Evidence: source review found target resolution by provider invoice reference before signature validation; an unknown reference can produce a different status class than a known reference with invalid signature.
- Possible impact: reference enumeration; no data read/write bypass reproduced.
- Safest solution: first verify the billing provider's retry/status contract, then normalize unauthenticated failures if compatible.
- Required regression: unknown reference, known reference/bad signature, stale timestamp, valid event and duplicate event.
- Blocker: no safe provider fixture or authoritative retry contract was available.

## BUG-003 — Website customer application orchestration exceeds 8,400 lines

- Severity: `Medium`
- Status: `open`
- Category: architecture / maintainability
- File: `lib/website/customerApplications.ts`
- Evidence: direct inspection confirmed a module exceeding 8,400 lines that combines validation, customer/site/meter handling, pricing, legal evidence, POA, storage/PDF, email, events and saga logic.
- Impact: elevated regression and review risk; file size alone is not treated as a runtime defect.
- Safest solution: characterize behavior first, then extract one stable responsibility at a time while preserving exports.
- Verification required: full tests/build and critical website/legal/POA/two-tenant regressions.

## SEC-001 — Supabase leaked-password protection appears disabled

- Severity: `Medium`
- Status: `unverified`
- Category: authentication configuration
- Evidence: Supabase security advisor reports leaked-password protection disabled; repository documentation lists enabling it as a pre-go-live requirement.
- Possible impact: increased credential-stuffing/account-takeover risk.
- Blocker: current connector access cannot independently read or change the relevant Auth dashboard setting.
- Verification: authorized platform administrator confirms the setting and performs a safe non-production test.

## BUG-006 — Contract version `2026-08-05.2` lacked immutable release material and routes

- Severity: `Medium`
- Status: `fixed`
- Category: API / release integrity / backward compatibility
- Files:
  - `docs/openapi/releases/2026-08-05.2/website-integration-v1.json`
  - `docs/openapi/releases/2026-08-05.2/customer-portal-v1.json`
  - `app/api/v1/openapi/2026-08-05.2/website-integration-v1.json/route.ts`
  - `app/api/v1/openapi/2026-08-05.2/customer-portal-v1.json/route.ts`
- Evidence: run `31052421121` failed because both immutable snapshots were absent; run `31052649096` then failed because both immutable routes were absent.
- Actual behavior: the advertised contract version lacked a complete immutable, retrievable release set.
- Fix: materialize the exact canonical snapshot blobs and add routes following the existing version pattern; canonical schema content was not rewritten.
- Commits: `c39794361ec342d5e75a530136724f779f1f2b5e`, `f5d81c726dbe3f023f00e3f99c3a33829e5a9ac1`.
- Verification: OPS hardening run `31052844335` completed successfully after both fixes; the expanded workflow also contains release verification.

## BUG-004 — Repository architecture and agent-memory paths drifted

- Severity: `Low`
- Status: `partially_fixed`
- Category: documentation / agent context
- Evidence: current source roots are `app/`, `components/`, `lib/`, `scripts/` and `supabase/`, while older context referenced `apps/ops`.
- Impact: maintainers or agents may inspect the wrong paths.
- Completed: current quality reports and handoff describe the actual layout.
- Remaining: reconcile or explicitly archive stale historical sources without deleting useful audit history.

## BUG-005 — Checkpoint filename contract is inconsistent

- Severity: `Low`
- Status: `blocked`
- Category: repository instructions
- Files: `AGENTS.md`, `.agent-memory/checkpoint.json`
- Evidence: instructions expect `.agent-memory/checkpoint.md`; repository contains `checkpoint.json`.
- Blocker: the canonical format and every consumer were not established safely.
- Next step: inventory readers/writers, choose one format, migrate forward and test the workflow.

## BUG-007 — Reserved `module` bindings caused lint to fail

- Severity: `Low`
- Status: `fixed`
- Category: static analysis / CI
- Files: `lib/customer-portal/tenantSync.ts`, `lib/legal/customerDocumentPackage.ts`
- Evidence: run `31053249461` passed all typechecks and then failed on exactly two `@next/next/no-assign-module-variable` errors. The other 130 lint findings were warnings.
- Fix: rename local variables to `legalModule`; no behavior or validation changed and no lint rule was disabled.
- Commits: `507340ed8fdbf21bac42e0625e670548cc5360c5`, `f8ea025bb8ef7030bfc6c905b5df5d535ba23d5a`.
- Verification: the following expanded run passed lint and continued to the full suite.

## BUG-008 — Public-contract tests used stale legal and contract-version fixtures

- Severity: `Low`
- Status: `fixed`
- Category: tests / contract drift
- Files:
  - `__tests__/public-contract-canonical-model.test.ts`
  - `__tests__/contract-channel-publication-completion.test.ts`
  - `__tests__/public-contract-publication-graph-repair.test.ts`
  - `__tests__/public-contract-route-openapi-regression.test.ts`
- Evidence: run `31053761076` failed four tests: three new-publication fixtures supplied `content_sha256: null` despite strict immutable legal evidence, and one route test compared current headers with historical version `2026-08-04.3`.
- Fix: update test evidence only, retain strict production validation and preserve the explicit historical-null test.
- Commits: `39e20f587c3e8c2da2dce39a03bbc13d70a2115d`, `5b7e52105f041dba26231ace1011fbfb79abca6b`, `65bec4ee9536d1beb1893d2d7bb724b8eb06e050`, `20220a9b83b65148862685f3fec47bbebff64ae2`.
- Verification: final expanded workflow on the resulting branch HEAD is the verification gate.

## Supabase observations not promoted to bugs

Fresh advisor output included function-search-path and RLS-without-policy notices. Direct `pg_catalog` verification of the reviewed `SECURITY DEFINER` helpers showed constrained `search_path`, no `anon` execute privilege and explicit session/membership/admin/service-role checks. No cross-tenant bypass was verified. RLS-enabled tables without policies can intentionally deny client roles; they require grant and call-path evidence before classification.

## Remaining highest-priority work

1. Retain a green expanded V3 workflow on the final branch HEAD.
2. Run safe staging two-tenant/API/legal/POA/billing/provider/EDIEL scenarios.
3. Verify the leaked-password setting and billing webhook provider contract.
4. Run repository-approved SAST and full current-tree/history secret scans.
5. Characterize and incrementally split `customerApplications.ts` only after coverage is sufficient.
