# Handover

Updated: 2026-09-04

Branch `claude/gridex-ops-production-hardening-lrknxa`.
**PR #307 is open and GREEN**: https://github.com/heke99/gridex-ops-platform/pull/307
`mergeable_state: clean`, all three OPS hardening jobs pass on head `f685d42`.
It has NOT been merged — the user has not authorised a merge. Do not merge.

## Done and verified in CI (do not redo)

1. `npm run db:parity` + `db:parity:selftest` — canonical/live schema parity in
   both directions, and the gate that proves the engine still detects drift.
2. `npm run db:schema:snapshot` / `db:schema:check`, and the canonical baseline
   `supabase/schema.sql` + `supabase/schema.fingerprint.json` (`3b0dd50e...`)
   captured from the green replay artifact. **The baseline IS committed and the
   check IS active and passing.**
3. Dockerless clean replay via `GRIDEX_REPLAY_DB_URL`.
4. `20260904120000_canonical_tenant_invariant_convergence.sql` — the tenant
   isolation gate now passes against a database replayed from this repository.
   It reported 21 breaches there before.
5. The tenant gate, parity self-test and schema snapshot run inside the replay
   step in `clean-migration-replay`.
6. `security:audit-production` distinguishes a vulnerability from an unreachable
   npm registry. `db:types:gen` generates from the local shadow.

## Pick up here, smallest first

- **Readiness policy versioning (Fas 10, §13).** No readiness relation binds a
  snapshot to the policy version it was computed against.
  `platform_runtime_readiness` already carries `schema_version` and
  `migration_version`, so there is a precedent to copy. See current-task.md
  Stage 18.
- **Typed Supabase clients (P0-E, Fas 5 §8).** No client factory is typed with
  `<Database>`. 487 files use the service client, 197 `.rpc(` call sites, and
  only one `as any` in the whole app. Re-run the typecheck probe on its own
  branch to get a real error count first; the one attempted here was abandoned
  without a result. See Stage 17.
- **Trace the Z02 activation rule properly (Fas 12, §36).** Recorded as
  UNVERIFIED, not satisfied: no Z02-driven activation was found, but the path
  through `lib/ediel/flows/inboundBusinessStateMachineLegacy.ts` was never
  traced. See Stage 20.
- **Production parity in blocking mode** stays blocked on the production
  Supabase project, which is not visible from the agent environment.

## Rules a later session must not break

- Do NOT change `EXPECTED_FINGERPRINT` in the replay script. CI's clean replay
  verifies `c70fa2f...` and is authoritative; see Stage 10.
- Do NOT generate the canonical baseline locally. The dockerless harness is not
  byte-equivalent to the Supabase stack — same relations, columns, functions,
  indexes and triggers, but 714 policies against 2548 and 5546 relation grants
  against 13307. Refresh it from a green CI artifact; the procedure is in
  `database-and-migrations.md`.
- Never edit `gridex-aud-003-migration-provenance-regression.cjs` to make a
  replay change pass; see Stage 9.
- The schema check is byte-for-byte, so any migration touching the public schema
  turns it red until the baseline is refreshed. That is by design.

## Already checked and correct — do not re-audit

- Fas 13 billing integrity: every unique index on billing and invoice relations
  is company-scoped (Stage 19).
- Fas 9.2 SLA timestamps: deadlines derive from `message_sent_at` and the
  watchdog index excludes unsent messages (Stage 19).
- Cron jobs DO have concurrency control, via claim-based `FOR UPDATE SKIP
  LOCKED` and named automation locks, not via route-level keywords. See
  `known-failures.md`.

Read `.agent-memory/current-task.md` first. It carries the findings register,
every design decision, the experiments that were run, and the ones that were
disproved.


## 2026-09-04 — after Steg 3

Production (`piidsfebjqjmnepdpnas`) has been reconciled with the canonical
migration chain except for one migration. Do NOT re-apply the three below —
they are in the production ledger and verified:

    20260904221046  gridex_inbound_operations_foundation
    20260904221936  z02_snapshot_market_context_guard
    20260904222045  canonical_tenant_invariant_convergence

`20260904222450  admin_signed_contract_import_canonicalization` is applied too.
That one is behavioural: admin imports can no longer INSERT a contract straight
into `signed`/`active`, and a `complete_agreement` / `signed_agreement` upload
now runs full evidence finalization or raises a named error. It was preflighted
to a blast radius of zero existing rows.

Canonical is now a subset of production: every canonical table and function
exists there. Do not re-apply any of the four.

Next: classify the production-only surface (74 relations / 546
policies / 57 functions) per plan 3.4/3.5, then Steg 4 (make `db:parity
production` blocking — only after classification), then Steg 5+.


## 2026-09-05 — #308 merged

PR #308 is merged to main as `15e6b48`, all seven relevant gates green
(`verify`, `quality-release-gates`, `clean-migration-replay`, `coverage`,
`smoke`, `browser-public`, `pr-certificate`). It is FINISHED — do not push
follow-up work onto it. The branch has been restarted from main; a follow-up
needs a new pull request.

What is on main now: the parity register
(`quality/audits/GRIDEX-PROD-PARITY-2026-09-04.md`) and the project memory. No
source or migration changes; the production work went through migrations that
were already on main.

What is still open, highest severity first:

1. F-PARITY-4 (critical) — the canonical chain does not build the six
   tenant-attribution guard triggers. Fix this before anything else in the
   register.
2. The fail-closed replay guard, so an unclassified `.sql` under
   `supabase/migrations/` aborts the replay instead of being ignored.
3. The 546 production-only policies are UNMEASURED. 3.4 is not finished until
   they are.
4. Steg 4 (blocking `db:parity production`) stays blocked until 1-3 are done.


## 2026-09-05 — active parity remediation

Status: IN_PROGRESS. No phase closed. Branch codex/gridex-parity-remediation-20260905.
Inventory manifest divergence and unsafe replay cleanup fixed with red/green
regressions, wired into OPS hardening. Production catalog read only; no live
mutations. See quality/audits/MASTER_PRODUCTION_REMEDIATION_STATE.md for baseline,
findings, tests and exact next work. Publish reviewable fixes and verify hosted CI;
then exhaustive replay accounting and forward canonical reconstruction.
Prior claims of unavailable production project or completed schema phases are
superseded by current catalog access and unresolved two-way parity.

2026-09-05 publication update: implementation 49c9b2a4 committed locally; automatic review rejected branch push (payload authorization/destination trust). No workaround attempted. Request approval for the concrete branch push before hosted CI. Typecheck and focused domain 7 files/22 tests PASS locally. Production parity remains open.


## Active checkpoint 2026-09-05 — supersedes earlier status claims

IN_PROGRESS; no masterplan phase is complete. Publication is authorized and
PR #310 is open as draft. Head 2568c28f has passing verify/quality jobs and a
failing canonical replay completeness gate (OPS run 33971545934). This is a real
repository remediation task, not an external permission blocker.

Forward migration 20260905141608 restores seven tenant relationship triggers
while preserving the newer snapshot function. Isolated PGlite 0.3.14 tests pass
18 reference cases under authenticated/service_role, twice; live read-only
catalog assertion also passes. These tests do not establish full RLS isolation
or canonical replay provenance. Integrity and production-readiness pass for
586 files; generated-types check correctly fails the new migration tail. Do not
update the types manifest without actual authoritative generation.

Two exact reviewed read-only diagnostic inputs receive an explicit classification.
The plan still has 56 unclassified files and 32 unresolved substitutions.
Next: finish reviewed effect reconstruction and parity semantic checks, then
obtain authoritative replay/type/schema artifacts and compare both ways with
production. No production mutation has occurred in the 2026-09-05 campaign.

Parity semantics: 26 isolated catalog checks PASS; expanded schema fingerprint requires authoritative recapture. Replay recovery: 14 tests PASS; no stop on preflight failure. Ownership of a pre-existing local stack after reaching startup remains unresolved; do not call this a fully isolated replay.


## Active checkpoint 2026-09-06 — supersedes previous progress

IN_PROGRESS. No phase closed. PR #310 published head 0a0f4068 has passing quality
gates and isolated reconstruction/parity SQL tests; verify fails generated-types
tail, and clean replay fails completeness (OPS 33988318141). These are required
internal remediation gates, not external permission blockers.

Next reviewed batch restores eleven invitation columns and corresponding role/FK/
unique-index effects through forward migration 20260906081839. Isolated tests
pass 18 assertions and two invalid-data rollback scenarios; the historical
regression table is frozen separately so canonical artifact refresh cannot erase
the failing baseline. Full RLS/RPC/provider E2E is not established.

Portal/API-origin source 20260609150000 is now preserved after its early bootstrap
at its original timestamp. Whole-source selection failed before the fix; actual
SQL now runs twice in an isolated fixture, preserving existing explicit origins
and valid identities, restoring match_strength=manual (read-only live default),
and verifying indexes. Other historical substitutions remain blocking.

Integrity/readiness pass for 587 files. Types still fail the new migration tail;
no manual hash or schema baseline edits. Complete historical effect review, then
run authoritative full replay, generate types/schema and verify ledger/live parity.
No production mutation performed in this batch.

## Published verification checkpoint — 2026-09-06

Code revision 8344cbb84eb6691bf7507bcc9c6580565bc6a114 is published on draft
PR #310. OPS run 34035865807 finished: quality-release-gates PASS; all isolated
reconstruction/parity SQL fixtures PASS; verify FAIL at the new generated-types
migration tail; clean replay FAIL at completeness. Later verify steps skipped
after the type gate are not certified. No phase closed and no production writes.

Next: complete the bounded Ediel environment source review, then test its complete
SQL with actual prerequisite ordering and successor hardening on PostgreSQL 17
before changing either source-suppression declaration. Full historical accounting,
authoritative schema/types generation and ledger/live comparison remain required.

Publication review completed: 28 accounting tests, 14 recovery tests, portal SQL
and invitation SQL (18 assertions plus two rollback scenarios) pass on the current
worktree. Operational DB2B classification has its missing evidence report restored
after direct source/body review. Actual accounting: 587 inputs, 497 full selected,
31 partial, 4 exclusions, 55 unknown. Full-effects exit remains 1. The planned
batch publication is now superseded by the verified code-head checkpoint
above; continue the Ediel source review. No phase is closed.

Ediel next step: isolated PostgreSQL 17 CI fixture implemented; SQL composition
and diff checks pass, execution pending. Both source suppressions remain unchanged.
Inspect ediel-source-effects job before changing selection. No phase closed.

## Ediel source restoration — 2026-09-06

PostgreSQL 17 job 101502920151 in OPS run 34039266103 passed on published
revision d6967d21c4f7985c0f2a452ddaf8ae0cef8b3c60. Complete original source and
successor ran twice, including pgcrypto; synthetic backfill/history, uniqueness,
FK/column/RLS and non-owner policy assertions passed. This is isolated source
evidence, not canonical provenance or production parity.

Both bootstrap declarations now preserve source 20260602143000 at its original
timestamp. Selection regression failed SUBSTITUTED before the fix, passed after,
and rejects either declaration reverting independently. Accounting selftest now
passes 29 tests. Inventory integrity/readiness pass (587 files). Accounting now
498 FULL_FILE_SELECTED, 30 unresolved SUBSTITUTED, 4 exclusions, 55 UNCLASSIFIED;
full-effects gate correctly remains exit 1. Original SQL/checksums are unchanged.

Next: inspect CI for the restoration revision, then review the remaining source
substitutions and unclassified SQL. Authoritative canonical replay, schema/types
regeneration and bidirectional ledger/live parity remain open. No phase closed.

## Customer-flow source batch — 2026-09-06

Ediel restoration revision 69d51ee2c80a9a6221e871cc47027af66a02d125 has passing
PostgreSQL17 source-effects job 101503578599 (OPS run 34039506238). Its global
verify/types and replay/completeness gates remain red; quality is still running.
The next customer-flow source batch restores full pre-ledger selection after
its actual table prerequisites. Complete SQL runs twice in PGlite, preserving
existing values; source selection was red before and green after. Static
provenance, integrity and 29 accounting tests pass. Hosted SQL verification is
pending publication. Accounting: 499 full selected, 29 partial, 55 unknown,
4 exclusions. No phase closed or production mutation. Continue remaining source
reviews, then authoritative canonical regeneration and live/ledger parity.

## Actor-testing source batch — 2026-09-06

Customer-flow revision a201d3f2c60f9b9ad845f47f7137e4d8b0e7f9b1 has passing
hosted complete-source SQL/selection in verify job 101504319679 (OPS 34039783462).
Ediel PG17 job 101504319838 also passes. Verify subsequently fails generated
types tail; replay fails completeness. Neither is an external permission blocker.

The previously unclassified actor-testing source is now selected after its four
table prerequisites. Actual complete SQL runs twice in PGlite, validates five
index definitions and preserves evidence/messages. Selection red UNCLASSIFIED
before, green after; 29 accounting tests, static provenance and integrity pass.
Hosted actor-source test pending publication. Counts now 500 full, 29 partial,
54 unknown, 4 exclusions. Continue remaining historical source reviews; complete
canonical generation and ledger/live parity before closing any phase.

## Verified code-head checkpoint — 2026-09-06

Published code head 29dc94974825b329b9b822c2219b077d8679bb33, draft PR #310.
OPS run 34039976860: Ediel PostgreSQL 17 job 101504839380 PASS. Verify job
101504839441 passes all isolated SQL fixtures, including complete customer-flow
and actor-testing sources, then FAILS generated-types tail 20260906081839.
Clean replay job 101504839286 FAILS; complete input accounting remains unresolved.
Quality job 101504839408 is still running and is not certified. PR body records
these exact code-head results. No phase closed, production writes or manual
canonical/type hash changes. Next: inspect quality result and continue remaining
29 partial/54 unclassified sources; full authoritative replay/ledger/live parity
is still required. These are internal remediation items, not permission blockers.

## Billing completion source — 2026-09-06

Previous code-head 29dc9497 quality-release-gates is now PASS (OPS 34039976860).
Full source 20260520_batch_3_4_final_completion.sql now selected after the real
billing_export_run_id prerequisite. Isolated complete SQL passes twice with four
exact index definitions and unchanged rows in five tables. Wrong prerequisite
order is demonstrably rejected. Selection was UNCLASSIFIED before, full after.
29 accounting tests, static provenance, integrity pass. Hosted test pending.
Counts: 501 full selected, 29 partial, 53 unknown, 4 exclusions. No phase closed.
Next: verify published CI, then review status-check broad constraint removal and
profile-normalization trigger effects; do not blindly restore these sources.
Authoritative replay/schema/types/ledger/live parity remain required.

## Request-status continuation — 2026-09-06

Published billing code head a4063e3896ccefc487a2c39825c74462c444c9a2 passes full
billing SQL/selection in job 101545606099, OPS run 34055141338; verify subsequently
fails generated-types tail. Ediel PG17 passes; complete replay remains red.

Request status source 20260521_final_customer_info_request_status_check.sql is
now selected immediately after its first table definition. That reviewed boundary
has only the intended status CHECK; no earlier selected foundation references
the table. Full source passes twice with 19 exact states, unchanged rows/PK/FKs,
and atomic rejection of invalid existing data. Selection red before, green after.
29 accounting tests and static provenance pass; hosted status test pending.
Counts: 502 full selected, 29 partial, 52 unknown, 4 exclusions. Continue profile
normalization trigger/dependency review and remaining history, then authoritative
canonical replay/schema/types and ledger/live parity. No phase or merge approval.

## Profile metadata continuation — 2026-09-06

Status source on published code head 9266c1b65130302b47a78c6d26182391d3e56be9
passes hosted complete SQL, 19-state validation and selection in job 101546218730,
OPS 34055377589. Verify subsequently fails types tail; replay remains red.

Profile normalization full source is now selected at its reviewed trigger-free
foundation boundary. Two passes with valid and legacy synthetic values verify
only tracking metadata changes; identity/status/timestamps/auth FKs are preserved.
29 accounting tests, static provenance and integrity pass; hosted test pending.
Counts: 503 full, 29 partial, 51 unknown, four exclusions. Next: verify hosted
profile SQL, then test the complete auth-callback/email-event source on PG17
before restoring it ahead of normalization. Full parity remains unverified;
no production writes, phase closure, merge or deployment in this batch.

## Published verification — 2026-09-06

Verified code head 4df526a8f73228ecb1f41c672db98cebbc7bf108: OPS 34055573705,
verify job 101546734266 passes all isolated SQL, including all three new source
fixtures, then fails generated-types tail. Ediel PG17 passes; replay fails;
quality job 101546734174 is still running. PR #310 records exact results.
Next: inspect quality and test full auth-email source on PG17 before restoring
it ahead of normalization. 29 partial/51 unknown remain; no phase is closed.
