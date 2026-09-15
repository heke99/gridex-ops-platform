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

Actual first run35000914570/job104488786738 at5c1cda15 reaches owned PG17.5
but stops before foundations at PRIVATE_INPUT_ADMISSION. Cleanup, directory
removal and source preservation pass. Source inspection locates the exact
integration mismatch: the adapter admits only fixed/continuation owner prefixes;
the new workflow had invented a portable-invariants prefix. The workflow now
uses the established continuation prefix with globally unique run ID/attempt.
The admission guard remains unchanged. New real AcceptedInputs integration test
admits the actual interpolated workflow owner and still rejects the old prefix.
Seven local tests PASS. Actual replay/final SQL remain pending rerun.

Actual rerun35001559027/job104490915869 at37844d94 completes144 foundations,
514 timestamps and all six forward positive/repeat checks. The first four pinned
final SQL checks pass and preserve catalog/rows. At17:33:49UTC the fifth rejects
one recognized breach: F14_INERT_POLICY with affectedCount24. No other invariant
rule fails. Owned cleanup, private removal and source preservation are true.
This localizes the native-style final rejection to policies whose target roles
have no table DML privileges. The count alone does not identify policies or
justify changing privileges; exact source-backed identities remain to establish.

Added a supplementary read-only query using the exact pinned F14 predicate. It
returns only SHA256 table/policy identities in the fixed public schema. The
projector requires the exact reported breach count, unique object pairs and
strict hexadecimal hashes, and preserves full catalog/row snapshots. Any query,
shape or preservation failure retains the original rejected invariant receipt;
it cannot approve SQL. Nine local tests PASS, including malformed/extra fields,
count mismatches, changed state and failed supplement retaining the24-policy
rejection. Actual identity projection still requires the next owned rerun.

Actual identity run35002680872/job104494673280 atca4ab72a returns24 unique
count-matched SHA256 table/policy pairs. Every pair matches exactly one authored
full-row record in PR310_ADDED_POLICY_DISPOSITIONS_2026-09-15.json. Compiler names
are independently reconstructed from the immutable md5 naming formula. All24
are authenticated policies: four compiled permissive commands plus four
restrictive lifecycle commands on each of inbound_ediel_match_attempts,
inbound_ediel_parse_results and inbound_email_attachments. The exact mapping,
source row hashes and derived definition fingerprints are recorded in
inert-policy-identities.json. The unrelated suggested closed auth tables were
not implicated and will not be changed.

Confirmed cause: the third forward,20260915132224, correctly closes authenticated
privileges according to20260904120000's service-only contract but preserves the
now-inert client policies. The candidate removes only those24 exact identities;
it requires exact definition/role hashes, closed anonymous/authenticated table
and column DML (including inherited grants), ordinary RLS-enabled tables, no
unexpected client/PUBLIC policies, and a whole24-or-zero set for repeat safety.
All validation precedes removal inside one transaction and short owned locks.
No privileges are added/revoked and all other policies/objects/rows remain.
Existing267 removed-policy qualification identities have zero overlap with these
three tables, independently checked by the schema agent; no set exception or
policy-hash rewrite is needed.

Candidate: scripts/sql/forward-candidates/drop-inert-inbound-client-policies.sql,
SHA256 b04ce7766f0d3e4655778cdd6aa6fcde1bb3a0661867e381aa0939f015c9e2c1.
It is not registered as a forward migration. New ownedPG17 qualification creates
the exact source expression structures with synthetic helper signatures, executes
the entire pinned prior revoke, requires F14 0→24, then24→0 after candidate,
repeat equality and only24 catalog-policy removals with unchanged ACLs/rows.
Seven negative shapes exercise reachable table/column/PUBLIC grants, changed
roles/definitions, missing expected identity and unexpected client policy.
Both clients must fail real DML with42501; service_role has NOBYPASSRLS and must
retain real read/write access through the preserved service policy. Application
helper semantics are explicitly outside this ACL-only qualification.

Local source/admission/delta tests3 PASS and selection-only PASS. Actual owned
PostgreSQL qualification, independent review and later full replay remain pending.

The candidate qualification workflow includes pinned Supabase CLI2.101.0
`migration new` after actual SQL qualification. It fills the genuine fresh file
with exact candidate bytes, requires its timestamp to follow20260915174614,
and uploads only that SQL file and the closed CLI receipt embedding the verified
qualification fields. No local/manual timestamp promotion or remote database
operation is performed. Independent review approved the bounded candidate/core
harness; the final CLI receipt addition is separately under review.
