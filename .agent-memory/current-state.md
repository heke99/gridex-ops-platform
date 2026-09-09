# Current state

Updated: 2026-09-09
Status: IN_PROGRESS

Active branch: `codex/gridex-parity-remediation-20260905`; [draft PR #310](https://github.com/heke99/gridex-ops-platform/pull/310).
Active group: `auth_membership_tenant`. The reviewed RBAC characterization batch is published
at `d32a3457983f36b159f5180e8c5ac4fc9516842e`; its tree exactly matches the
reviewed local tree. No masterplan phase is closed.

Working-tree accounting is 589 inputs: 511 `FULL_FILE_SELECTED`, 28 `SUBSTITUTED`,
46 `UNCLASSIFIED`, and 4 `EXPLICITLY_EXCLUDED`. The focused group contains 335
inputs: 269 selected, 25 substituted, 37 unclassified, and 4 excluded.
The implementation is committed locally; prefix composition/selection/provenance,
nine-command runner regression, 29 accounting tests and migration integrity
(589 inputs/493 version groups) pass. Separate review found four confirmed prefix/test blockers, corrected locally in
399271d4; scoped re-review, integrated review and hosted PG17 remain pending; these edits and the forward migration are not yet published. Published d32a3457 had 588 inputs and 77 unresolved.
Selection and lexical hints do not prove execution or surviving effects.

Verification boundaries:

- Implementation: mapper, fixed runner, status consolidation and auth candidate
  inventory passed separate and integrated review. Local mapper tests: 15;
  accounting tests: 29; group runner/status regression, integrity, provenance
  and readiness passed. Six historical status files are archived byte-for-byte.
- Isolated: on published code `d32a3457`, [OPS 34227210022](https://github.com/heke99/gridex-ops-platform/actions/runs/34227210022)
  auth job `102064145147` passed all seven commands on PostgreSQL 17.11.
  The three complete RBAC sources ran twice; incomplete prerequisites omitted
  the billing view as expected, and invalid environment data rejected and rolled
  back the predecessor transaction. Ediel `102064144786` and quality
  `102064145173` also passed. The missing profile-status prerequisite was fixed
  during separate review; final integrated review approved the scoped batch.
- Canonical: verify `102064144999` failed generated types at migration tail
  `20260907121951`; clean replay `102064145219` failed with the full-effects
  accounting gate still blocking the 77 unresolved inputs. Full replay,
  schema/types, ledger and live parity remain open.
- Live/environment: this batch performed no production writes. Fresh read-only
  Supabase ledger on `piidsfebjqjmnepdpnas`: 279 entries, latest `20260904222450`.
  Vercel production
  deployment `dpl_6qevcw57wT7X2p5yd5rQA7hzRq8c` READY at `app.gridex.se`,
  main commit `eb9a25bc989c6de808903f41c2314d5465e9c07b`. A fresh 2026-09-08
  Vercel project/deployment read confirms the same production deployment, SHA
  and alias. Runtime-to-database
  binding is not independently proven. These observations are not parity proof.
  A 2026-09-08 catalog-only read also confirms both RBAC billing/audit views
  exist with `security_invoker=true`; later hardening must remain in scope.

Next active work: scoped re-review of fix 399271d4, then integrated review and
hosted PG17 verification of the nine-command group. The local fix preserves
auth-source adjacency, supplies the managed generated confirmed_at prerequisite,
uses constraint-valid company test data and derives audit expectations from the
real prefix baseline. Local covering checks pass; no new batch is published.
The prefix uses 27 selected files through its membership boundary and the
three restored originals; the narrow final helper migration retains later hardening. Follow
[the restoration plan](../quality/audits/RBAC_CANONICAL_RESTORATION_PLAN_2026-09-08.md). The reduced characterization used
8 of 29 dynamic policy targets; actual foundation candidates include 25.
A new restoration batch must prove its real prerequisites, not reuse the reduced
fixture as canonical evidence. Characterization plan and evidence:
[RBAC fixture plan](../quality/audits/RBAC_GROUP_FIXTURE_PLAN_2026-09-08.md).
The [auth source map](../quality/audits/AUTH_GROUP_REVIEW_MAP_2026-09-07.md)
records required view/table prerequisites, 29 dynamic policy targets, operational
DML decisions and missing coverage. The [334-candidate inventory](../quality/audits/AUTH_GROUP_INPUT_INVENTORY_2026-09-07.json)
is a pinned review snapshot, not complete statement-by-statement approval.

A source-level dependency is confirmed: restoring the predecessor overwrites
`gridex_user_has_role_key` and omits baseline status/is_active checks. The current
restoration plan requires a narrow forward migration preserving the exact selected
core helper after historical replay, with secure synthetic regression checks.
The prior Supabase project-access denial is resolved: fresh project listing and
catalog reads now succeed. The live helper body MD5
`d76c8c4ae10c4f36b772b86255f728ba` matches core01; later selected hardening and
live catalog agree on SECURITY INVOKER, search_path=public,auth,extensions and
EXECUTE for authenticated/service_role, not anon. The forward migration must
retain those later properties and grants after restoring the function body.
This scoped observation is not full live parity or runtime-to-database binding.


Internal work remains: 62 unresolved active-group candidates plus cross-group
work, then authoritative replay, generated artifacts and bidirectional ledger/live
parity. The previous connection dependency is resolved; no current external blocker is
established. Full replay and live parity remain internal verification work. Publish once per reviewed batch.
Do not publish per file or subtask. No automatic replay decisions, gate weakening or phase
closure from isolated tests. The completed characterization batch changed no production database, migration
selection or generated schema/types. The next restoration batch may change
reviewed replay selection; this alone cannot establish surviving effects or parity.

The published tooling contract remains scoped to that batch: "For this
workflow-tooling batch, no production mutation is authorized or performed."

Historical status: `archive/pre-batch-20260907/`. Other active memory files are
pointers here; archive text is not current verification evidence.
