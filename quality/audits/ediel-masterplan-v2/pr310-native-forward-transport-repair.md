# PR310 native forward transport repair — 2026-09-16

Parent source: `4702d0360873aad7d7971a93c04163113a1fe333`.
This is a bounded CLI admission repair, not native replay or release acceptance.

The registered forward compiler produces exactly twelve source-bound programs.
The CLI transport still only admits ordinals01–10, so the two registered
20260916095318/20260916095319 migrations cannot reach the official CLI via this
path. The lifecycle test also hard-codes ten examples and wrongly requires11
be rejected. No terminal result of the long native run is inferred here.

Replaced the example-only positive loop with all twelve actual compiler outputs,
retaining an explicit count12. This reproduced FIXED_NATIVE_CLI_COMMAND_REQUIRED
before changing transport. Expand only the bounded ordinal pattern to01–12.
Ordinals00,13,100, missing leading zero, short/long hashes, shared workspaces,
foreign networks, linked/remote targets, unexpected typegen flags, incomplete
CLI bundles and failed cleanup remain rejected by the unchanged adjacent tests.
All15 lifecycle/transport tests pass locally after the one-line correction.
The test is already present in the ordinary OPS native verification step.

No migration bytes, SQL role/grant, reference, ledger or type manifest is changed.
The real native run must still apply each registered source through CLI2.101.0,
record genuine statements, verify rollback/repeat, and satisfy every final gate.
