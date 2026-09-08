# Current state

Updated: 2026-09-08
Status: IN_PROGRESS

Active branch: `codex/gridex-parity-remediation-20260905`; [draft PR #310](https://github.com/heke99/gridex-ops-platform/pull/310).
Active group: `auth_membership_tenant`. The reviewed tooling batch is published
at `1824d69d8b31be97096dd0eecaf7fd719db40970`; its tree exactly matches the
reviewed local tree. No masterplan phase is closed.

Current accounting is 588 inputs: 507 `FULL_FILE_SELECTED`, 28 `SUBSTITUTED`,
49 `UNCLASSIFIED`, and 4 `EXPLICITLY_EXCLUDED`. The focused group contains 334
inputs: 265 selected, 25 substituted, 40 unclassified, and 4 excluded.
Selection and lexical hints do not prove execution or surviving effects.

Verification boundaries:

- Implementation: mapper, fixed runner, status consolidation and auth candidate
  inventory passed separate and integrated review. Local mapper tests: 15;
  accounting tests: 29; group runner/status regression, integrity, provenance
  and readiness passed. Six historical status files are archived byte-for-byte.
- Isolated: on published code `1824d69d`, [OPS 34198005843](https://github.com/heke99/gridex-ops-platform/actions/runs/34198005843)
  auth job `101969998315` passed all six commands on PostgreSQL 17, including
  complete auth/POA/invitation characterization and all four actor-FK scenarios.
  Ediel job `101969997965` also passed. Quality job `101969998228` also passed.
- Canonical: verify job `101969998320` passed the new mapper/status checks, then
  failed generated types at migration tail `20260907121951`. Clean replay job
  `101969998208` failed; the full-effects accounting gate still blocks the 77
  unresolved inputs. Full replay, schema/types, ledger and live parity are open.
- Production: this batch performed no production writes. Read-only snapshot on
  2026-09-07: ledger 279 entries, latest `20260904222450`; Vercel production
  deployment `dpl_6qevcw57wT7X2p5yd5rQA7hzRq8c` READY at `app.gridex.se`,
  main commit `eb9a25bc989c6de808903f41c2314d5465e9c07b`. Runtime-to-database
  binding is not independently proven. These observations are not parity proof.
  A 2026-09-08 catalog-only read also confirms both RBAC billing/audit views
  exist with `security_invoker=true`; later hardening must remain in scope.

Next active work: independently review and verify the complete RBAC
predecessor/backfill/platform-role fixture under [the next fixture plan](../quality/audits/RBAC_GROUP_FIXTURE_PLAN_2026-09-08.md).
The local draft composes all three originals twice and the seven-command runner
regression passes. Implementation is committed locally; separate review and hosted PG17 execution
remain pending; these are not executed database results.
The [auth source map](../quality/audits/AUTH_GROUP_REVIEW_MAP_2026-09-07.md)
records required view/table prerequisites, 29 dynamic policy targets, operational
DML decisions and missing coverage. The [334-candidate inventory](../quality/audits/AUTH_GROUP_INPUT_INVENTORY_2026-09-07.json)
is a pinned review snapshot, not complete statement-by-statement approval.

Internal work remains: 65 unresolved active-group candidates plus cross-group
work, then authoritative replay, generated artifacts and bidirectional ledger/live
parity. No external blocker is established. Publish once per reviewed batch.
Do not publish per file or subtask. No automatic replay decisions, gate weakening or phase
closure from isolated tests. The current characterization batch changes no
production database, migration selection or generated schema/types.

The published tooling contract remains scoped to that batch: "For this
workflow-tooling batch, no production mutation is authorized or performed."

Historical status: `archive/pre-batch-20260907/`. Other active memory files are
pointers here; archive text is not current verification evidence.
