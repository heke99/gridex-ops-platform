# Canonical residual source accounting and owned ordinary continuation

Status: IMPLEMENTED_NOT_VERIFIED (native verification of this integration pending).
Base: 6064dcf02319342e1a88424d9999bf0f42dd8b0a, PR310.

## Established evidence

The base commit fixes DB2's invitation index namesake: the immutable May19 source
creates lower(email),status; DB2 requests a third created_at DESC key. A guarded
same-transaction transition replaces only that known predecessor. Unknown,
unique, partial, wrong-order or annotated preimages fail; rollback and repeat
controls preserve state. Historical SQL was not rewritten.

GitHub residual run34776030335/job103774181992 passed both native lanes on that
base: all144 foundation stages, seven residual sources, all513 timestamp stages,
including the run where original migration paths remain absent through the tail.
The four DB2 and fifteen DB1 index semantic checks passed. Historical DB2
operator reconciliation, official-ledger provenance, accepted schema and generated
types were not certified. OPS34776030297 clean103774182283 rejected the unsupported
native target before SQL; verify103774182298 retains the types-manifest gate.
The quality-release-gates job103774182237 passed on that base.

## This increment

- Add an exhaustive byte-partition contract for all seven residual sources.
  Exact source, renderer, executor, authority and boundary hashes are required.
  Every original byte has one explicit disposition; DB2 operator-only DDL/data
  remain explicitly excluded, not represented as executed or passed.
- Combine that contract with the unchanged original selector. The600 inputs are
  588 original whole-file selections, seven reviewed residual dispositions and
  five explicit pre-existing exclusions. Unknown or overlapping inputs, wrong
  hashes, changed code/boundaries, duplicate keys and false scalar types fail.
  The old selector still reports its own588/2/5/5 categories truthfully.
- Use this complete canonical-source preflight before owned-container creation
  and before the actual shell stages originals. This is not SQL acceptance.
- Route the real clean shell's timestamp continuation through the same retained
  driver as the native proof. Retain all sources before HOLD; require completed
  foundation/residual execution, exact full scope, the same owned target,
  original-path absence, and once-only execution. Failure is terminal. No SQL,
  target URL or alternative paths can be supplied to the new transport operation.
- Select PG17/PostGIS only for full scope. All bounded scopes retain their prior
  behavior. Required-object/true-only checks, schema fingerprint and NO-ledger
  boundaries remain unchanged; the supported compatible target is not silently
  promoted to a managed Supabase genesis.
- Add a read-only native CI lane for the actual owned clean shell. The existing
  managed clean-replay/type release job is not removed or made optional.

## Verification and review boundaries

New source-disposition tests:18 passed locally. New controller/transport tests:13
passed locally; the same new tests failed against the published pre-integration
controller (3 failures and9 errors). Cleanup20, required-check12, timestamp13,
residual/DB2/index/retained-tail51 and repair selection-only constructors passed.
The original38-test accounting suite is run separately; do not infer its result
from these counts. No native SQL was available in the local container. An initial
repair invocation without --selection-only correctly failed at unavailable Docker;
the static rerun with the explicit flag passed. Do not call that initial attempt
a passing full repair proof.

Review performed: direct source/diff and boundary analysis by the implementing
agent. No independent reviewer approval is claimed. Relevant skill routing:
systematic-debugging (namesake/lifecycle root causes), test-driven-development and
verification-before-completion (negative/positive controls), differential-review
and code-review (exact diff and unchanged sources), fp-check/variant-analysis
(index and source-admission variants), Supabase/Postgres (RLS/ACL/transaction and
owned-runtime boundaries). UI, React performance and product-design skills were
not triggered; no UI/runtime product code is changed. Independent spec-to-code
fan-out is not available here and is not claimed as executed.

## Next exact acceptance work

Read the actual owned clean-shell CI result. Repair its first genuine failure
without changing the accepted fingerprint merely to match a diagnostic database.
Then establish reviewed native/managed target lifecycle and real migration-ledger
provenance; regenerate and compare schema/types from that accepted reconstruction.
The types tail20260911114443 and points85/86 remain open. No production database,
main branch or deployment is modified. The partner-price patch remains paused.

## Delivery boundary

The existing38-test input-accounting suite also passed locally (complete run,
126.866s). Publication may use a temporary fixed-base/fixed-patch/fixed-result-tree
workflow for this exact increment. It may only fast-forward the existing PR310
branch after static tests; it removes itself and its transport payload in the
same commit. No main merge, force push, production access, secret retrieval or
release-gate waiver is permitted. The subsequent native job is read-only and
must check out the exact published SHA/tree. Publication success alone is not
native or canonical acceptance; the final status must read its actual result.
