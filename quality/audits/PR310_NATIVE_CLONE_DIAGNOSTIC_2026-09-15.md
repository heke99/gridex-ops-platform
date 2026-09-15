# Native timestamp clone diagnostic — PR310

Status: IMPLEMENTED_NOT_VERIFIED. No semantic clone correction is asserted.

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
