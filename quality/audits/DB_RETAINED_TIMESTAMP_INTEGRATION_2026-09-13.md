# Retained timestamp integration — 2026-09-13

Status: IMPLEMENTED_NOT_VERIFIED (native result pending).
Base: d47bfb0fb482d3e986de3abae98a8a0c7bafac56, tree c378126e41d03d2ceac3c800b6e6575f133ff51f.

## Existing CI blocker is superseded

On the base commit, OPS34771242285 actually ran: the former status-marker and
repair-constructor failures passed; application quality/build also passed.
The remaining verify failure is db:migrations:check; clean replay/types remains
failed. Native residual34771242282 and frontier34771242291 passed. Do not carry
forward the older action_required result from39b4e4f6 as the current state.

## Confirmed integration gap and correction

The prior staging proof removed source SQL only for the foundation, then restored
it before all513 timestamp stages. The timestamp reader and session authority
reader reopened repository originals, so that proof did not establish an end-to-end
HOLD-compatible execution path. This matters before ordinary replay can be admitted.

Freeze selected timestamp/prerequisite bytes and the three pinned session
authorities before staging. All reads require canonical paths, immutable bytes
and matching hashes; missing authority never falls back to the checkout. Verify
the complete bundle before the first timestamp SQL effect. Duplicate source
selection is rejected. The session reconstruction is byte-identical to the old
candidate, including transaction boundaries, source guards and security transition.

The native staging proof now executes the full tail before restoring originals,
and verifies that originals were not recreated. Existing native rollback, row,
ACL, lock, view and DB2 controls remain active. There is no new target option,
logging relaxation, source rewrite, migration marking or type generation.

## Tests performed before publication

11 new tests passed after reproducing the missing retained API and the staging
gap. The real513-input scheduler is exercised with SQL-only transport doubles;
this is not native database evidence. Existing suites passed: session14,
timestamp13, residual-integration11, residual-transition12, DB2 6, required-checks12.
Total:79 enumerated tests across seven suites. git diff --check passed.
The native workflow runs the new tests and both real continuation lanes.

## Scope and remaining gates

No full source-effect disposition is admitted by this change. Accounting remains
600 inputs:588 selected,2 substituted,5 unclassified,5 excluded. Ordinary
CLI/native ownership and ledger provenance remain incomplete. Accepted schema,
type manifest and migration tail20260911114443 remain unchanged. No production
SQL, app/API changes, main merge, Vercel deployment or independent review claimed.

Skill routing: existing plan execution, systematic debugging, TDD, verification,
Supabase/PostgreSQL preservation review. UI, billing, new runtime permissions and
deployment changes are outside this batch.
