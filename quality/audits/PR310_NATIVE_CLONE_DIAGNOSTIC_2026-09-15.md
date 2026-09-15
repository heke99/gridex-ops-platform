# Native timestamp clone diagnostic — PR310

Status: ACTUAL_CAUSE_AND_BOUNDED_CLONE_CORRECTION_VERIFIED; historical continuation pending.

Actual70ce549f OPS34966099676/job104370788723 completes the144 foundations and
all seven groups with actual ledger/fault/repeat proof. Timestamps1–7 pass.
Timestamp8 source20260531111600_system_readiness_foundation.sql executes and
its real CLI ledger statements are verified. Its positive restoration SQL passes;
the subsequent clone utility fails NATIVE_COMMAND_FAILED, exit1, command1449.
Private disposal and owned cleanup are verified. Artifact10396872362 has ZIP
SHA2562336122aa980d9e55dd27906bf10656b178b93af0381a678e307bfb70034132f.
The previous SQL-NULL JSON parse failure is gone. The exact new cause was not
exported, so source-in-use or permission explanations remain hypotheses.

The same-container adapter now captures utility return codes with allow_failure
but still rejects every nonzero result before claiming creation or removing
retained ownership. A single exact createdb primary error can yield only fixed
source-in-use, copy-owner, create-permission or OTHER categories. The expected
finite source name must match; NOTICE/DETAIL, other names, duplicate primaries,
trailing spoof text and arbitrary SQL are never included in public reports.
Drop failures produce a fixed OTHER code. Five exact codes join the existing
trusted-ValueError allowlist. No permission, session, source or clone semantics
change is made.

A separate short native preflight reuses the existing isolated Supabase2.101.0
lifecycle: real initialization, genuine CLI ledger, repeat and failed-migration
rollback, then cloning postgres inside the owned container. It verifies copied
actual ledger and synthetic probe rows, OID-owned clone disposal and unchanged
parent ledger. The mode cannot combine with historical execution and makes no
historical/schema/type acceptance claim. Parent stop/disposal remains mandatory.
The dedicated workflow publishes only the existing sanitized lifecycle report.

Faithful failure tests first produced10 failures because the old collector hid
the utility result. Corrected proof26, timestamp-runtime19, lifecycle15, ledger8,
preflight3 and full historical integration166 tests pass. Reviewer independently
checked the diagnostic and preflight scopes; no necessary findings. Actual native
preflight is required to identify the cause before a narrowly scoped correction.

## Subsequent actual diagnosis and bounded correction

139c837d preflight34971870647/job104389843483 produces exactly
NATIVE_TIMESTAMP_CLONE_CREATE_SOURCE_DATABASE_IN_USE and verified cleanup.
Artifact10398315121 metadata digest is
22b3b03ae25178d1cfe5bdf6a52c29bf10aed95673de4158f66971ce5234ce96.
The short native reproduction identifies the former utility ambiguity.

The correction admits only the exact owned NativeTimestampTarget and finite clone
name. An owner-checked template1 maintenance connection temporarily disables new
connections to the isolated postgres source, drains at most64 source-bound
backends, and lets the original createdb operation copy it. The finally block is
entered before disabling connections; it restores the original connection setting
and requires exact database metadata, role settings, snapshot and ledger equality.
No hosted address, caller database name, arbitrary SQL or PID can enter this path.
Only finite failure categories are published. Failed restoration cannot be accepted
and enclosing owned-container disposal remains mandatory. Offline quiescence6 and
proof26 tests pass; actual native proof is required and is not asserted here.

## Actual corrected native preflight

824f24d4 run34974499990/job104398708790 SUCCESS. Artifact10398429821 ZIP digest
1b762725ef52c4e195d1c657d69f9c097b86a1eaac3a27136e5be6ced7bd4186.
CLI2.101.0 and official postgres17.6.1.106 image execute the real quiescence path.
Safe backend count category other=2 explains the source-in-use reproduction.
Copied actual ledger, synthetic probe rows, parent metadata/settings/snapshot and
ledger preservation, clone disposal, container cleanup and private workspace
removal all pass. This proves the bounded correction, not the historical chain.
The ordinary824f24d4 native34974499849/job104398696940 is still in progress.
