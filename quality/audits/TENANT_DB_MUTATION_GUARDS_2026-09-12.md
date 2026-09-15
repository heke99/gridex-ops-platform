# Task 13 implementation report — tenant DB mutation invariants

Date: 2026-09-12
Base checkout HEAD: `fc869cb5`
Scope: bounded application-helper hardening from
`quality/audits/TENANT_DB_INVARIANT_CONTRACT_2026-09-12.md`.

## Result

`tenantDb` now copies every update patch before validation or query-builder
construction. An explicitly supplied `company_id` must exactly match the bound,
normalized company. A matching owner is removed from the copied database patch;
a foreign, null, or undefined owner throws before `supabaseService.from` is
called. The caller's original object is never modified, and later top-level
mutation of that object cannot change the payload held by the query builder.

Generic wrapper upsert now always throws before client I/O. No table/conflict
allowlist was invented. The public method remains present and is documented as
unsupported until a table and company-qualified conflict target are audited
together. The audited caller inventory found no current runtime wrapper upsert
consumer, so no caller migration was required.

Insert stamping, select/delete company filters, company-id normalization, and
the explicit `unscoped()` escape hatch remain intact. This helper still requires
the caller to resolve an authorized company. It does not authenticate users,
validate membership or relationship IDs, enforce RLS, or prove database
constraints.

## Skill routing

- Activated `test-driven-development`: the permanent and actual-source tests
  were written before the production change and the actual-source test was
  observed RED before implementation.
- Activated `systematic-debugging`: the supplied audit established the two root
  causes; the first GREEN attempt then exposed JavaScript evaluation order
  constructing the client before argument validation, which was corrected at
  the source boundary.
- Activated `verification-before-completion`: final claims below are limited to
  freshly executed local commands.
- The supplied tenant/database audit and caller/schema inventory fulfilled the
  evidence, tenant-integrity, code-review, variant-analysis, and false-positive
  phases. SQL, Supabase-native, authorization, performance, UI, dependency,
  worktree, branch-finishing, and delivery skills were not activated because
  Task 13 expressly excludes those surfaces and root owns review/publication.

## Owned files

1. `lib/supabase/tenantDb.ts`
   - Copies update values before validation and client access.
   - Rejects mismatching explicit ownership and omits matching ownership from
     the database patch.
   - Makes generic upsert explicitly unsupported and fail closed.
   - Clarifies the caller authorization boundary.
2. `__tests__/tenant-db-mutation-invariants.test.ts`
   - Permanent Vitest coverage of foreign/null/undefined update ownership,
     same-company and ordinary updates, tenant filtering, caller-object
     preservation, deferred mutation, insert stamping, and default/id/global/
     composite upsert rejection with zero client I/O.
3. `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-13-guard-regression.mjs`
   - Node 24 actual-source RED/GREEN harness. It evaluates the complete actual
     TypeScript module and replaces only the external service client.
4. `.superpowers/sdd/2026-09-12-current-and-plan77-85/task-13-report.md`
   - This report.

The two `.superpowers/sdd` files are task-local intermediate evidence. The permanent Vitest file and this published report provide the durable reviewed artifact. All pre-existing billing,
pricing, audit, proof, and `scripts/__pycache__` dirty files were preserved and
are not owned by Task 13.

## Verification evidence

| Command | Outcome | Meaning |
|---|---|---|
| `node .superpowers/sdd/2026-09-12-current-and-plan77-85/task-13-guard-regression.mjs` before source change | Expected RED, exit 1: `Missing expected exception` at the foreign-owner assertion | Proved the actual wrapper accepted a foreign update owner before remediation. |
| Same command after the first source edit | RED, exit 1: `fromCalls` was `['records']` rather than `[]` | Proved `base().update(prepareUpdate(...))` touched the client before validation because the receiver is evaluated before call arguments. |
| Same command after ordering correction | GREEN, exit 0: `PASS tenantDb actual-source ownership, copy, stamping, scope, and fail-closed upsert cases` | Exercises the complete actual wrapper with only service I/O replaced. Covers 3 invalid owner values, same-company/ordinary copied updates, deferred caller mutation, insert stamping, 4 unsupported conflict-option shapes, select/delete scope, and `unscoped()`. |
| `git diff --check` | PASS, exit 0 | No whitespace errors in tracked changes. |
| `node_modules/.bin/vitest run __tests__/tenant-db-mutation-invariants.test.ts` | Not runnable locally, exit 127: `node_modules/.bin/vitest: No such file or directory` | The checkout has no `node_modules`; project memory prohibits another ENOSPC dependency install. No Vitest pass is claimed locally. |

Required dependency-equipped hosted command:

```sh
npx vitest run __tests__/tenant-db-mutation-invariants.test.ts __tests__/ediel-post-send-source-projection.test.ts __tests__/render-gateway-error-serialization.test.ts __tests__/z02-raw-receipt-before-verification.test.ts
```

The first file is the permanent behavioral regression. The remaining files are
focused existing regressions around the audited runtime importers. Hosted
Vitest, broader typecheck/lint/build, and independent review remain publication
gates and are not claimed by this implementation report.

## Residual limits

- No current reachable user exploit is claimed; the audited runtime callers do
  not upsert and do not update `company_id`.
- No SQL, PostgREST, service-role, RLS, trigger, foreign-key, unique-conflict,
  concurrency, or native-database test ran in this task.
- Generic upsert is intentionally unavailable. A future capability requires a
  separate audited table-qualified conflict API and native database evidence.
- The wrapper does not authorize company selection or validate related entity
  ownership. Existing `unscoped()` callers retain their manual filters and need
  their own review evidence.
- Root owns independent review, explicit ignored-file inclusion, commit, push,
  and hosted publication gates.

## Independent review

Specification and quality APPROVED with no findings. Actual-source ordering/ownership/copy coverage is accepted at the helper boundary; supported hosted Vitest/typechecks/build remain pending. No current reachable exploit or native database acceptance is claimed.
