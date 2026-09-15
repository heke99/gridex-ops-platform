# Ordinary final-gate evidence and read-only diagnostic

Status: PARTIAL; diagnostic IMPLEMENTED_NOT_NATIVE_VERIFIED.
Verified implementation base:6a65e75597ddf388d1ea304701b6b7c30d9f2672.

## Actual native progress

Run34779330429/job103783333423 completed SUCCESS at20:04:56Z: source rejection
controls, selected continuation, originals-absent staged continuation and cleanup.
Actual owned-shell job103783333534 completed FAILURE at20:02:18Z, but now executes
144 foundation,7 residual and513 timestamp stages plus5 retained prerequisites.
At20:02:15.691Z all18 existing required-object/execution predicates are true.
The workflow identity correction in6a65e75 is therefore natively verified.

The unchanged final fingerprint immediately rejects:
expected=c70fa2f017f6ce3af3ff806d948f18b58a3c196e4bf94daa9304629a3926680c
actual=7664566cda0fbad62af3e5b07dfd4b6e4f6cb5dd33a9cf70d775618ba2efcc4d

At20:02:16.384Z terminal receipt reports privacy
SOURCE_LITERAL_IN_PRIVATE_ARTIFACT, stateINTAKE_COMPLETE, disposalVERIFIED.
Exact container cleanup passes. Original SQL/hash files and accepted types remain
unchanged. No complete replay, surviving-schema or real-ledger acceptance exists.

Canonical admission accounts600 inputs,0 unresolved; old selector588/2/5/5 remains
unchanged and source substitutions/exclusions remain explicit. Managed OPS direct
invocation is still unsupported and type check still fails migration tail20260911114443.

## Bounded read-only evidence collection

Route: systematic debugging, test-driven development, source/safety differential
review and verification before completion. No UI/API/performance/deployment work;
no subagent or independent reviewer is available/claimed for this diagnostic.

A separate diagnostic entrypoint invokes the existing controller/main and actual
ordinary shell. Only the original full-tail failed-child terminal call is observed.
Its readonly catalog query uses the pinned existing fingerprint CTE. The expected
fingerprint and its comparison are unchanged. The original terminal handler always
executes, even if collection fails; success/release/ownership/privacy methods stay
unchanged. There is no alternate SQL target, arbitrary path, success override,
exception-content serialization or accepted artifact publication.

Snapshot projection is pinned to committed supabase/schema.sql SHA256
b46b90d7ff066d71964c9157044ac70b31b47cab114cfcbce5d270751012dd30.
Fingerprint query SHA256
7c861698fe8d3034805ca0599a6679fe0eb8543679a00058fd1e242a8ea6fa28.
Projection covers the same13 tables and2 function bodies, but is explicitly NOT
full default/constraint-semantics/index/RLS/ACL/physical-ordinal/ledger verification.
It cannot replace the original final hash or certify the schema.

Private-file census emits only safe file identities, content hashes, matching-marker
counts and existing whole-input-name records. A recorded name is not a provenance
exemption. Raw source literals, body/default definitions and business rows are never
printed. Symlinks and malformed source/query shapes are rejected. Marker values
come only from the previously pinned source references, not a production read.

## Local verification

13 diagnostic tests PASS: pinned sources, complete projection parsing, body-format
normalization, structural drift detection, no raw-value output, symlink denial,
recorded-name nonacceptance, preserved terminal failure, and no external arguments.
Existing3 identity tests and13 owned-tail tests PASS. git diff --check PASS.
No local native PostgreSQL execution is claimed. Fresh CI is required before
claiming the observer's native output. Root causes must be established from the
emitted evidence; neither new blocker is fixed by this diagnostic.
