# Current state

Updated: 2026-09-09
Status: IN_PROGRESS

Active branch: `codex/gridex-parity-remediation-20260905`; [draft PR #310](https://github.com/heke99/gridex-ops-platform/pull/310).
Active group: `auth_membership_tenant`. The reviewed RBAC restoration batch is published
at `01e31ed89255ba829e24a7bd8ce324d36c475add`; its tree exactly matches the
reviewed local tree. Hosted verification passed all nine auth/RBAC commands after the invitation-order correction. No masterplan phase is closed. System integrity and customer deletion gates are
[explicitly recorded](../quality/audits/SYSTEM_DATA_INTEGRITY_ACCEPTANCE_2026-09-09.md).

Working-tree accounting is 591 inputs: 514 `FULL_FILE_SELECTED`, 27 `SUBSTITUTED`, 46 `UNCLASSIFIED`, and 4 `EXPLICITLY_EXCLUDED`. The focused group contains 337 inputs: 272 selected, 24 substituted, 37 unclassified, and 4 excluded.
The four initial findings and hosted invitation-adjacency defect are corrected,
separately reviewed and published. OPS34344515597 auth102442823593 PASS includes
all nine commands, actual selected prefix, repeated complete RBAC sources and
preserved final helper. That published baseline passed accounting29 and
integrity589/493; these are not test receipts for the pending591-input batch.
This verifies the bounded RBAC prefix, not later surviving effects or full parity.
Published d32a3457 had 588 inputs and 77 unresolved.
Selection and lexical hints do not prove execution or surviving effects.

Verification boundaries:

- Current01e31ed8: OPS34344515597 auth102442823593 and Ediel102442823708 PASS;
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

Next active work: implement the separately reviewed complete
20260519_saas_ui_tenant_admin.sql restoration, data-driven reference seeds and
first/repeat-effect characterization. Audit07075c8b confirmed the old prefix lacks semantic pair uniqueness. Fresh
live catalog proves the intended unique constraint exists; the user-corrected
Task2 now reconstructs it before SaaS and requires stable canonical repeat
effects. It also reconstructs the source-intended/live3-column invitation
status index, replacing only the confirmed older2-column definition. The old duplicate-endpoint expectation is superseded. Additional live
NOT NULL and FK delete-action differences remain explicit parity work. Follow
[the SaaS restoration plan](../quality/audits/SAAS_TENANT_SOURCE_RESTORATION_PLAN_2026-09-09.md).
Published01e31ed8 still classifies this source SUBSTITUTED. Local unpublished
work selects it and the uniqueness/invitation-index reconstructions; ten-command integration
and its new SQL harness are committed locally as a1d807e3. Selection/emit,
ten-command runner/status, accounting29, integrity591/495, provenance and
immutable-history checks pass. Separate/integrated review and hosted execution
are pending; these edits are not published.
Full replay, generated artifacts and production parity remain unverified.
The verified published prefix uses 27 files through its membership boundary;
the unpublished SaaS/integrity prefix has30, followed by the same three originals; the narrow final helper migration retains later hardening. Follow
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


Internal work remains: 61 unresolved active-group candidates plus cross-group
work, then authoritative replay, generated artifacts and bidirectional ledger/live
parity. The previous connection dependency is resolved; no current external blocker is
established. Full replay and live parity remain internal verification work. Publish once per reviewed batch.
Do not publish per file or subtask. No automatic replay decisions, gate weakening or phase
closure from isolated tests. The completed characterization batch changed no production database, migration
selection or generated schema/types. The current unpublished SaaS batch changes
replay selection; this alone cannot establish surviving effects or parity.

The published tooling contract remains scoped to that batch: "For this
workflow-tooling batch, no production mutation is authorized or performed."

Historical status: `archive/pre-batch-20260907/`. Other active memory files are
pointers here; archive text is not current verification evidence.
