# Approved syntax repair — real replay result

Candidate a87aa667e12c94cfe105dfff3cde35b1a3759d60.
OPS35878957343/native107242115069 applies migration20260923135706
at15:07:51Z and reaches COMMIT. The user-approved parentheses correction
therefore resolves the actual compilation blocker.

Replay subsequently passes71 source-object SQL checks, then stops inside
the adapted retained test helper pg_temp.retry_persist:
scripts/ediel-utilts-committed-retry-regression.sql124, helper body line8,
ambiguous id variable/table column in source_transaction_id=id.

This is a test-helper failure, not a new migration parse failure.
The eight retained assertions must remain; qualify table columns and local
names without relaxing their expected outcomes, then rerun the real RPC.
New native suites/typegen/schema generation were not reached.

Log-only artifact10759358895, reported ZIP SHA256
689023f7489a8457c1969504df30e010ee83b890c77fe52e47c850c08d27d578.
No database-source or complete retry acceptance is implied.
Independent checkpoint review requires billing ownership/atomicity fixes
and the remaining full-processor/mutation/native matrix.
