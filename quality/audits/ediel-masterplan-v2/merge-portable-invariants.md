# Owned portable final invariant diagnostic

Status: IMPLEMENTED_NOT_VERIFIED on an actual database. Purpose is to diagnose
native final check five while the independently running native chain continues.
No native ledger, schema or type acceptance is issued by this diagnostic.

Skill routing: systematic-debugging for the observed native rejection;
verification-before-completion for evidence boundaries; targeted test-first
privacy/admission checks and independent parent review. Relevant existing
Supabase ownership and source-preservation rules apply. UI, application
performance, deployment and historical migration editing are outside scope.

The new standalone driver reuses the frontier's exact foundation selector,
retains timestamp and forward source bytes, then executes 144 foundation steps,
514 selected timestamps and the six currently registered portable forwards on
an exclusively owned, network-disabled PostgreSQL 17/PostGIS target. It runs
all five unchanged, hash-pinned final SQL checks in original order and preserves
their transaction choices. Every successful final check must preserve catalog
and row snapshots. Any nonzero SQL exit, primary error or state difference fails.

The owned command builder supplies database/process identity. Final SQL is
passed via subprocess stdin, with captured output never printed or written to
an artifact. Only the existing exact-source invariant parser can produce closed
rule identifiers, counts and object hashes. Unknown errors remain failures.
The aggregate receipt is printed after owned cleanup, private-directory removal
and source preservation. Existing replay diagnostics retain their established
closed per-command receipts. No schema baseline, historical SQL or generated
manifest changes were made.

The workflow triggers only on relevant push paths in the closed PR311
continuation branch; its unique container and absence of a shared concurrency
group ensure it cannot cancel or clean the ordinary native job's target.
No external database URL or scope override is accepted.

Local verification:

- `python3 scripts/test-canonical-portable-invariants.py`: 6 PASS, covering
  exact bytes/order/transactions, recognized failure remaining failure, unknown
  output privacy, contradictory exit/error signals, changed state, incomplete
  prefix and changed source rejection. The sixth uses the real owned command
  builder and verifies explicit `-f -` stdin script mode with psql transaction
  handling, following the independent review finding before execution.
- Foundation selector 8 PASS; timestamp selector16 PASS; portable forwards5 PASS;
  native final SQL/parser10 PASS.
- `git diff --check`: PASS.

Actual SQL execution and independent review remain required. Portable success
will not satisfy native replay, schema comparison, genuine type generation,
application CI or main merge gates.
