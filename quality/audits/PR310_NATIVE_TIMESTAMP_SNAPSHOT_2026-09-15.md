# Native timestamp snapshots and clone identity — 2026-09-15

Status: targeted correction; full PR310 remains PARTIAL.
Publication base70ce549fa9facdec9add63f91db224ee4c2bc2bb.
Exact imported tree039f59bd30d5625b686c3145ff5fc0a5bdc25405. Concurrent clone
NULL fix/tests and FK/source-disposition work retained. Our duplicate clone fix
and test are superseded; this patch adds only the reviewed snapshot work.

## Confirmed findings

High verification-integrity: the timestamp executor's catalog/row images omitted
source-modified private schemas, extensions, enum/domain metadata and event
triggers. An effect outside public/auth/storage could evade source-equivalence
or rollback checks. Direct projection and full runtime path review confirms it.

Actual native335 run34963346318/job104361913920/artifact10394374227:
ZIP SHA2569c14aab272826678adf7bc4f3b3dfed9f1d99f36eb9246fac275694eced90112
matches its upload log. It proves foundation144 and timestamps1–7; timestamp8
has a real verified CLI statement row before JSONDecodeError at clone setup.
The absent-clone scalar subquery feeds SQLNULL into to_json; psql emits a blank
field, which json.loads rejects. Explicit coalesce(...,'null'::json) fixes this
transport mismatch without relaxing finite-name or OID ownership checks.

## Correction

Compose a timestamp projection from the unchanged SHA-pinned broader RBAC SQL.
Include every non-system schema, schema owner/ACL/comment, extension metadata/
comment, event triggers, enum/domain metadata/typeACL/domain constraints and
existing objects/dependencies. Row fingerprints include non-system tables except
the canonical ledger table; Runner separately checks every actual ledger row.
The catalog INCLUDES ledger schema/table/trigger metadata. No meaningful values
are normalized away. Native live-sync clones use the same full domain image.

Before timestamp execution, require nine real SQL detection cases on an owned
clone: enum label, extension comment, private function, private row, schema ACL,
domain constraint, ledger schemaACL, ledger trigger and synthetic event trigger.
Each must change its exact expected object key; an unrelated change cannot pass.
Drop the clone and verify unchanged parent image and real migration ledger.

Native postgres is deliberately not superuser. A separate helper accepts only
three fixed synthetic cases, on the fixed already-owned probe clone. It verifies
container/internal-network ownership, current clone OID, local loopback endpoint,
server port and infrastructure owner in the same transaction as the operation.
No SQL or database argument can be supplied. Historical migrations remain under
postgres; no provider trigger is disabled or modified. Logging helper unchanged.

## Verification and boundaries

- Clone-null regression RED with JSONDecodeError, then GREEN after correction.
- python3 -B scripts/test-canonical-native-timestamp-proof.py:23 PASS.
- python3 -B scripts/test-canonical-native-timestamp-runtime.py:19 PASS.
- Original auth-membership/continuity selftest and whitespace checks PASS.
- Tests cover all nine missed-object cases, parent drift, immutable catalog hash,
  finite privileged cases, missing/replaced clone, failed admin SQL and adapter.
- Independent review approved projection/ownership scope after correcting both
  ledger metadata exclusion and native event-trigger privileges; final null
  regression is preserved from70ce549 and remains green.
- Actual new-head PostgreSQL controls still require Actions. Mocked tests are
  transport/comparator evidence, never SQL acceptance.

Remaining: real-ledger readiness qualificationT257/T262/T275/T351, complete514
native execution/schema reconciliation/genuine type generation/mandatoryCI/E2E/
review; merge entirePR only after all same-head gates pass. No production change,
reference rewrite, historical ledger alias, weakened control or force push.
