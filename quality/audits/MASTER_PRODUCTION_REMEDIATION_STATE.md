# Gridex OPS production remediation evidence register

## Current checkpoint — PR #310

Authenticated GitHub publication succeeded after explicit user authorization.
PR: https://github.com/heke99/gridex-ops-platform/pull/310, draft.
Head `55ed2f0402497d981b693412be797ee0932e6e60` has all three OPS jobs green
(run 33957586449), plus smoke/coverage/PR certificate and public browser green.
Staging runtime/load jobs were skipped; no production-parity closure follows.
Vercel now independently reports production `eb9a25bc989c6de808903f41c2314d5465e9c07b`,
deployment `dpl_6qevcw57wT7X2p5yd5rQA7hzRq8c` on app.gridex.se.

Exhaustive input accounting now reuses the exact replay selector and verifies
every migration checksum and classification overlap. Actual 585-file breakdown:
494 FULL_FILE_SELECTED, 32 SUBSTITUTED with unresolved full effects,
1 EXPLICITLY_EXCLUDED, 58 UNCLASSIFIED. Selection is not execution evidence.
Seventeen disposable-fixture tests pass. Replay now runs this check with
`--require-full-effects` before moving originals or starting the database;
its JSON evidence is retained by CI even when it fails. The actual repository
fails as intended: no blanket exclusion or green completeness claim is allowed.
Recovery regression expanded to 11 passing cases including accounting rejection.
No historical migration or canonical artifact changed in this accounting fix.

Next: individually classify historical data/diagnostic scripts and reconstruct
required schema effects in forward migrations. Tenant-guard reconstruction and
legacy-script classification are active independent bounded workstreams.
No masterplan phase is closed. The previous publication approval blocker below
is historical and superseded, not an active external dependency.

Updated: 2026-09-05. Campaign: `IN_PROGRESS`. No phase is closed.

Closure requires convergence of code, migration ledger, canonical replay,
generated types and the actual production database through the parity engine.
Passing a static checksum check or a subset comparison does not establish it.
`.agent-memory` remains the active task/checkpoint; this register records evidence.

## Baseline and provenance

- Initial main: `15e6b487423a05c655635d8b632721bcc6debfd9`; refreshed to
  `eb9a25bc` after #309 (memory-only changes).
- Vercel domain `app.gridex.se`: project `prj_xA3EDI1xztkkyx21e3LY4UhgYrWt`,
  deployment `dpl_VDfQotLdmE7wwhfjqELbuGDKMqAG`, production, READY,
  deployed SHA `a1dba4146ab50d3804c1875d94533f7ff08171f9`.
- Supabase project `piidsfebjqjmnepdpnas`, named `gridex-ops-dev`:
  `db.piidsfebjqjmnepdpnas.supabase.co`, database `postgres`, PostgreSQL 17.6.
  Read-only catalog query: 279 ledger entries, latest `20260904222450`,
  502 public tables, 160 views/materialized views, 632 functions, 332 triggers.
  Runtime environment binding still needs independent verification; the project
  name alone does not identify environment.
- Exact initial main OPS run 33952340999 passed. Full E2E run 33952340993
  failed production-migration-readiness (72/73). Production deploy run
  33952341021 skipped both deployment creation and waiting; its green result
  is not deployment evidence. Browser/load staging jobs were skipped.
- Local Node 24.19.0 differs from required Node 22; hosted verification required.
  npm ci completed. Local psql, PostgreSQL server, Docker and Supabase CLI are
  absent. apt update failed on unavailable UID/group operations; this is a
  local limitation, not proof that CI reconstruction is externally blocked.

## Findings

| ID | Severity / subsystem | Status | Evidence and root cause | Remediation / residual risk |
| --- | --- | --- | --- | --- |
| F-PARITY-1 | Critical / replay completeness | VERIFIED_OPEN | Replay selects 14-digit files and foundation entries; prior #308 audit reports 84 never-executed files and partial substitutions. `scripts/gridex-aud-003-clean-replay.sh` still lacks exhaustive input classification. | Account for every historical SQL and restore required effects via reviewed forward migrations; never blindly replay historical production repairs. Full two-way diff remains outstanding. |
| F-PARITY-4 | Critical / tenant integrity | VERIFIED_OPEN | Fresh production catalog finds all six company-guard triggers; canonical `supabase/schema.sql` lacks the six corresponding functions. Source is omitted `20260615_multitenant_integrity_and_claim_locks.sql`. | Reconstruct guards with migration lineage, canonical types and aggregate parity. All customer/site/meter/POA/billing/legal tenant chains affected on rebuild. |
| F-VERIFY-001 | High / migration readiness | PARTIALLY_CLOSED | Fresh readiness failed on 14 hashes while integrity passed. Inventory omitted Ediel/runtime additive manifests. All 14 bytes match main and existing immutable pins. | Generator now reads all five sources and rejects conflicts. Local readiness 585/585; regression covers each source, ten source-pair conflicts, missing and changed bytes. Hosted CI and global parity outstanding. No schema or ledger changed. |
| F-VERIFY-002 | High / replay recovery | PARTIALLY_CLOSED | EXIT cleanup deleted migration originals and overwrote seed when preflight failed before backups. Nine failures reproduced in disposable fixtures. | Restore only after both backups succeed; retain recovery copies on restore failure. Ten fixtures pass. Hosted replay outstanding; no production database changed. |
| F-LIFECYCLE-001 | High / supplier switch activation | VERIFIED_OPEN | `20260903090000_atomic_supplier_switch_activation_sweep.sql` finalizer bypasses `activate_customer_supply_v1`; `lib/operations/db.part-2.ts` manual/bulk finalizer does sequential incomplete writes. Compensation search found only operation-task sync and date/Z04 guards. | Converge on canonical transactional activation, including supply periods/contracts/events/outboxes. Verify live-only compensation and failure/idempotency/concurrency cases before closure. |

All findings discovered/reverified 2026-09-05. Current remediation branch:
`codex/gridex-parity-remediation-20260905`. PR/commit evidence pending publication.
No customer records, external messages, production schema or ledger were mutated.

## Verification and impact

- `node scripts/canonical-migration-inventory-selftest.cjs`: PASS after demonstrated RED.
- `python3 scripts/gridex-aud-003-clean-replay-selftest.py`: 10 PASS after 9 RED.
- `node scripts/check-production-migration-readiness.cjs`: PASS after 14 missing registrations.
- `node scripts/check-migration-versions.cjs`: PASS, 585 files / 489 version groups.
- `node scripts/check-supabase-generated-types.cjs`: PASS, existing type hash
  `b839bc610ff376fe78469cd7266de7a1d205022afa96c9924e2a9b1f0b4da6e8`.
- `node scripts/gridex-aud-003-migration-provenance-regression.cjs`: STATIC_PROVENANCE_PASS;
  does not prove exhaustive history or production equivalence.
- `bash -n scripts/gridex-aud-003-clean-replay.sh` and `git diff --check`: PASS.
- Inventory consumers: production-readiness gate and generated local inventory
  artifacts. Those artifacts remain `LOCAL_INVENTORY_ONLY`; never apply their SQL
  to the live canonical manifest before schema-effect verification.
- Replay consumer: clean-migration-replay workflow sources the shell and retains
  the stack until types/schema/tenant verification finishes. Backup guard does
  not change execution ordering, SQL, pins, fingerprint or ledger model.
- CI now executes both behavior regressions plus production-migration-readiness.

## Skill routing and next work

Activated: Supabase and Vercel API (live identity/catalog), repository
using-superpowers, systematic-debugging, test-driven-development,
verification-before-completion, dispatching-parallel-agents (bounded independent
CI, domain and replay-recovery reviews). Repository/quality baseline continues.
Next: publish reviewable verification fixes, inspect hosted CI, then close the
replay input-accounting and forward-schema reconstruction gap. UI/performance,
browser/load and full domain matrices remain pending their prerequisites.
No hook installation, new skill creation or unrelated product integration is in
the current atomic fix. No external blocker has been asserted for the campaign.

## Publication gate and additional verification

Implementation commit: `49c9b2a48f18bea019b8b740368f38d4a0df6ee9`.
Local typecheck PASS. Focused domain Vitest run: seven files, 22 tests PASS
(atomic supply activation, sweep, Z02 worker/parser, global policy propagation,
tenant revalidation and readiness authority). These existing tests do not cover
the source-confirmed activation omission, so F-LIFECYCLE-001 remains open.

Automatic approval review rejected `git push -u origin
codex/gridex-parity-remediation-20260905` to heke99/gridex-ops-platform. Stated
reason: publishing this payload was not explicitly authorized in the reviewed
context and the destination was not verified as trusted; potentially sensitive
organization code/operational state would leave the workspace. No alternative
publication route was attempted. User approval of this concrete branch push is
required before retrying. No PR, new hosted CI, merge or deployment was performed.
This blocks publication/hosted verification, not all remaining read-only audit.

## F-VERIFY-003 — incomplete introspection accepted

High, verification, discovered 2026-09-05; PARTIALLY_CLOSED. Both parity inputs
containing `{}` produced a false PASS in blocking mode; the snapshot tool also
accepted missing sections. Root cause: absent sections treated as empty arrays,
without checking requested namespaces. Shared schema-document validation now
requires all introspection sections, each row's required fields and exact
requested schemas. Valid empty schemas remain supported. CLI fixture regression
demonstrated RED, then PASS for both tools and all parity modes. No introspection
SQL or canonical artifact was changed; fingerprint serialization is unchanged.
Hosted validation and production convergence remain outstanding.

User explicitly authorized necessary publication in this conversation after the
auto-review rejection. The subsequent shell push reached Git and failed for
missing authentication (could not read Username), not policy rejection. Continue
through the authenticated GitHub connector. This supersedes the approval blocker.
