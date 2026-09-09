# Current state

Updated: 2026-09-09
Status: IN_PROGRESS

Active branch: `codex/gridex-parity-remediation-20260905`; [draft PR #310](https://github.com/heke99/gridex-ops-platform/pull/310).
Active group: `auth_membership_tenant`. The reviewed RBAC restoration batch is published
at `8750a5b94b8dade5da2748d71268f4178a077653`; its tree exactly matches the
reviewed local tree. Hosted verification found an additional invitation-order defect. No masterplan phase is closed.

Working-tree accounting is 589 inputs: 511 `FULL_FILE_SELECTED`, 28 `SUBSTITUTED`,
46 `UNCLASSIFIED`, and 4 `EXPLICITLY_EXCLUDED`. The focused group contains 335
inputs: 269 selected, 25 substituted, 37 unclassified, and 4 excluded.
The initial four review findings were corrected in local399271d4 and passed
scoped/integrated review before publication8750a5b9. Local prefix/selection,
nine-command runner regression, 29 accounting tests and migration integrity
(589 inputs/493 version groups) pass. Hosted OPS34343823950 auth102440584698
passed auth and POA SQL, then failed invitation --selection-only at line106: the
active-company prerequisite separates the template source from its hardfix
predecessor. Fix round2 is in progress. The actual new RBAC prefix has not run.
Published d32a3457 had 588 inputs and 77 unresolved.
Selection and lexical hints do not prove execution or surviving effects.

Verification boundaries:

- Latest hosted restoration batch8750a5b9: OPS34343823950 Ediel102440584673
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

Next active work: correct the hosted invitation adjacency failure without
weakening existing gates, add its database-free selection check, scoped review
and publish the coherent CI fix. Then rerun the nine-command hosted PG17 group.
Full replay, generated artifacts and production parity remain unverified.
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
