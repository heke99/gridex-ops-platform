# PR310 OID JSON snapshot repair

Base: bf9b124ada6dd5b1ed96cf3128ff8c22e2902101. Date: 2026-09-16.

Skill routing: systematic-debugging, test-driven-development, Supabase,
code-review/differential-review and verification-before-completion apply to the
isolated SQL/Python boundary and CI repair. Schema/type generation and branch
completion activate only after verified database qualification. UI/design,
commercial, AWS and unrelated application skills are not in scope. Existing
project invariants and historical source pins are preserved.

## Confirmed defect

Run35076315945, artifact10438154381, failed in Storage policy scope preimage
validation after complete selected replay. PostgreSQL17 constant-only read-only
query verified `to_jsonb(ARRAY[0::oid]) = '["0"]'::jsonb`, whereas the Python
verifier and its mocks expected integers. The candidate SQL uses PostgreSQL's
native oid[] and already passed its own preimage validation; no SQL change is
required for this comparison bug.

Repair compares precisely `["0"]` and `[str(authenticated_oid)]`, including the
negative snapshot, and rejects integer/boolean/noncanonical-string lookalikes.
Complete catalog, row and ledger equality requirements remain unchanged.

## Verification

Regression with real JSON representation fails before repair (PREIMAGE_REQUIRED),
then passes. 6 scope +17 clone +8 seed +10 bootstrap offline tests PASS.
Full database qualification must be checked on the published head. No production
or full replay/schema/generated-type acceptance is claimed.

The status-file integration test also failed because main reconciliation dropped
required inventory/status declarations. Restore current measured inventory and
status pointers instead of changing or disabling that test.

Published code commit: 8297f2e3d161ca859f72712be4e2bce8333da604.
Published tree c939db996572c53e5ccd487aa4676adc2a1d74cb matches the local tree.
The unchanged canonical-auth-membership-group-selftest.py passed in full,
including runner failure-stop, environment isolation, archive hashes and status
pointers. Full clone run35080283797 was still executing when this receipt was
written; this receipt does not claim its result or any merge.
