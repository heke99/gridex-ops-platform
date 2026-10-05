# F3-D — published reference projection qualification

## Publication and completed code qualification (2026-09-17)

PR324 publishes c343dfd155586b653989281c6bc07f621a5dbcce, tree
800c68dcfc0f883ba9dae151f89016293d363d29. It exactly matches saved179e2b5e;
source-transfer35207511634 checked patch/tree hashes but is NOT a test certificate.
The helper files/workflow are on a separate branch, excluded from this PR.

Normal exact-code-head OPS35207689478, Ediel35207689453, Browser35207689469 and
FullE2E35207689487 all completed SUCCESS. This includes the21 consumer tests
previously unavailable locally and all ordinary types/tests/lint/security/build
and budget gates. Local439 source cases and immutable specification integrity
were rerun successfully. This final documentation commit still requires ordinary
CI on its own exact head before merge; do not substitute the earlier runs.

Differential review followed the11 original RFF descriptors through the new
projector, parser/AST/facts, field-presence/allowed-value checks, staging,
permission/ACK/preflight/compatibility/transport readers and reference writer.
Adversarial cases cover empty/metadata-only values, escaped punctuation, header,
later-object and stale parsed fallbacks, new/old meter distinction, first-message
boundaries and undecodable wire. Source-matrix usages remain unchanged. No new
SQL, caller privilege, tenant authorization or external-message capability is
introduced. No unresolved blocking thread or submitted blocking review was
present at this checkpoint; re-read them before merge. No independent human
review or full-production acceptance is claimed.

The separate f3-reference-fields.md records the earlier ZIP-only checkpoint. Its
publication blockers are superseded by the evidence above, not current blockers.
