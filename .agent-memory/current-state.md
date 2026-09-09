# Current state

Updated: 2026-09-09
Status: IN_PROGRESS

Active branch: `codex/gridex-parity-remediation-20260905`; [draft PR #310](https://github.com/heke99/gridex-ops-platform/pull/310).
Active group: `auth_membership_tenant`. The reviewed RBAC restoration batch is published
at `fac58faee7db406a556c3bde44978e972545964b`; its tree exactly matches the
reviewed local tree. Hosted verification passed all ten auth/RBAC/SaaS commands, including both integrity reconstructions. No masterplan phase is closed. System integrity and customer deletion gates are
[explicitly recorded](../quality/audits/SYSTEM_DATA_INTEGRITY_ACCEPTANCE_2026-09-09.md).

Working-tree accounting is 592 inputs: 515 `FULL_FILE_SELECTED`, 27 `SUBSTITUTED`, 46 `UNCLASSIFIED`, and 4 `EXPLICITLY_EXCLUDED`. The focused group contains 338 inputs: 273 selected, 24 substituted, 37 unclassified, and 4 excluded.
The unpublished mandatory-reference implementation cb49b468 adds one selected
input. Static selection/emit, accounting29, provenance75/49/20/4/499 and integrity
592/496 passed; all61 reduced identity scenarios and actual selected-prefix SQL
remain pending hosted PG17. Separate static code review is approved; integrated
approval of the corrected candidate is the next gate. Published
fac58fae receipts below describe591 inputs.
Publishedfac58fae now includes the complete SaaS source and the two intended/live
integrity repairs. OPS34348338877 auth102455180423 PASS: actual selected SaaS
prefix, stable source repeats, real platform-grant cleanup, eight labeled reduced
branches, five uniqueness and five invitation-index reconstruction cases.
Conflicts/dirty data/replacement failures preserve data and roll back. The shared
RBAC prefix and all previous commands also pass. Static accounting29, integrity
591/495, provenance, selection and immutable history checks passed before
separate/integrated review and publication. Full-system parity remains open.
Selection and lexical hints do not prove execution or surviving effects.

Verification boundaries:

- Currentfac58fae: OPS34348338877 auth102455180423 and Ediel102455180529 PASS.
  Clean102455180692 FAILED before full replay. Verify102455180144 FAILED generated-types tail20260909120100;
  quality102455180308 PASS. These checks do not close
  generated types, later effects, ledger/live parity or customer deletion.

- Historical01e31ed8: OPS34344515597 auth102442823593 and Ediel102442823708 PASS;
  quality102442823418 PASS. Clean102442823777 FAILED before replay;
  verify102442823751 FAILED generated-types tail20260908120000. The failed8750 receipt
  below is historical and its invitation adjacency defect is fixed.

- Historical hosted restoration batch8750a5b9: OPS34343823950 Ediel102440584673
  and quality102440584712 PASS. Auth102440584698 FAILED at invitation selection
  adjacency before new RBAC prefix execution. Verify102440584657 FAILED generated
  types at migration tail20260908120000. Clean102440584460 FAILED before replay.
  Earlier d32 receipts below remain valid only for that earlier seven-command code.

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

Next active work: obtain integrated approval of the corrected mandatory-reference
candidate, publish the reviewed tree once to draft PR310, and run the actual
selected prefix plus61 reduced identity scenarios on hosted PG17. Implementation
cb49b468 is complete and separately approved for the bounded static gate; all new
SQL remains unexecuted. No FK-action reconstruction is included in this batch.
Initial audit c220acd5 needed corrections to same-parent assignment preservation
and legacy-key comparison. Corrected evidence c0b661a9 was separately approved;
the current implementation follows its mandatory-reference-only scope and exact
admission predicates. Parent lifecycle and FK-action reconciliation remain
separate internal follow-up work. Fresh catalog
confirms live user_roles.role_id CASCADE while selected core lacks that FK;
this newly verified dependency prevents treating join-only deletion as complete. Live has NOT NULL role/permission IDs and CASCADE FKs;
core/generated schema retain nullable IDs and RESTRICT. Do not use blanket
cascade changes: each relationship needs its own verified ownership contract.
The SaaS source/uniqueness/invitation-index batch is now published and its
ten-command PG17 execution passed; broader system integrity, deletion, full
replay, generated artifacts and production parity remain unverified.
[The SaaS restoration plan](../quality/audits/SAAS_TENANT_SOURCE_RESTORATION_PLAN_2026-09-09.md)
records superseded broken-prefix expectations and verified corrections.
Bounded customer catalog inventory records 175 direct FKs across100 tables,
including14 composite SET NULL relationships targeting mandatory columns.
These are catalog observations requiring lifecycle/source/synthetic review;
no customer deletion behavior or index performance has been verified.
The [auth source map](../quality/audits/AUTH_GROUP_REVIEW_MAP_2026-09-07.md)
records required view/table prerequisites, 29 dynamic policy targets, operational
DML decisions and missing coverage. The [334-candidate inventory](../quality/audits/AUTH_GROUP_INPUT_INVENTORY_2026-09-07.json)
is a pinned review snapshot, not complete statement-by-statement approval.

Historical helper dependency is already repaired: restored RBAC history had
weakened gridex_user_has_role_key, and selected forward migration
20260908120000_preserve_gridex_user_has_role_key.sql restores the core body
while retaining later invoker/search-path/ACL hardening. Its final-helper tests
passed in the published ten-command batch. Do not restart this completed repair.
The prior Supabase project-access denial is resolved. Observed live helper MD5
is d76c8c4ae10c4f36b772b86255f728ba; this scoped match remains distinct from full
live parity and runtime database binding.


Internal work remains: 61 unresolved active-group candidates plus cross-group
work, then authoritative replay, generated artifacts and bidirectional ledger/live
parity. The previous connection dependency is resolved; no current external blocker is
established. Full replay and live parity remain internal verification work. Publish once per reviewed batch.
Do not publish per file or subtask. No automatic replay decisions, gate weakening or phase
closure from isolated tests. The published SaaS batch changed replay selection and adds forward reconstruction
files; it made no production database writes or generated schema/types refresh.
The mandatory-reference repair is implemented and separately reviewed, but its
SQL is not yet verified. Parent-ownership/FK-action and customer-deletion repairs
remain open; do not restart the implemented ID repair or claim lifecycle parity.

The published tooling contract remains scoped to that batch: "For this
workflow-tooling batch, no production mutation is authorized or performed."

Historical status: `archive/pre-batch-20260907/`. Other active memory files are
pointers here; archive text is not current verification evidence.
