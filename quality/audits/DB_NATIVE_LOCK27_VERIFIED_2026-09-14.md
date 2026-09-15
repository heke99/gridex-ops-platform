# Ordinal27 native transaction boundary — verified 2026-09-14

Status: VERIFIED for ordinal27 and the native first43 prefix ONLY.
The overall database reconstruction and release remain PARTIAL.

## Source and execution identity

- Tested code: `a7622e16c63e561cb62fc792d07c4ddf53103945`.
- Tested source tree: `80edf36b111fa7544e0249407fff15ee8c183ff8`.
- Official OPS run: `34860588353`; clean job: `104031445849`.
- Artifact: `10354879366` (`gridex-rem-002-clean-replay`).
- Artifact ZIP SHA256: `1a9f8493a6ce82a8a56ce7d4bec670375a64fcdecaf79fc9c6494d74759ecddf`.
- Original native JSON SHA256: `5e07fc4daaf5403b6b6412f4a3ccdd70dc620c50ad74d3b2b107a9d9b026b27d`.
- Source artifact10354603161 ZIP SHA256: `c2adb9310e986a6ee8d8f158a59f898a73814dbb7556fa5cd97f7aca8e917c8e`.

The runtime correction was already published in20be4640/a7622e16 when this
verification started. This documentation increment does not claim a new runtime
patch or a new execution: it reviews the actual completed native result and
supersedes the stale ordinal27 blocker in current state.

## Root cause and narrow correction

Source `migrations/20260909120000_canonical_role_permission_uniqueness_reconstruction.sql`
is unchanged, SHA256 `b86f056fb868a3642eb6663068bc1cb4b86d03d430e6a1f339687868ec2773a6`.
Transferring its outer BEGIN/COMMIT to the CLI implicit batch left a top-level
LOCK TABLE requiring a transaction block; the old program failed25P01.

`scripts/canonical_native_lock_boundary.py` wraps each exact LOCK statement in
an atomic DO body. The table, lock mode, original SQL bytes and sequence remain
unchanged. The DO body does not COMMIT or create an autonomous transaction.
The lock remains in the CLI transaction through the CLI's own history INSERT.
Only four complete source hashes (ordinals27,28,29,43) and their exact counts
are admitted; the remaining39 prepared programs are unchanged by this adapter.
No historical migration or source manifest was edited. Ledger verification
requires the actual adapted program, not an invented original applied version.

The caller `canonical_native_historical_prefix.py` makes the native boundary
proof mandatory before applying ordinal27. Local infrastructure logging setup
and the migration role separation are unchanged. Probe helpers are in a
non-exposed test schema, SECURITY INVOKER, revoked from client roles, and removed.

## Actual PostgreSQL/CLI evidence

Official CLI2.101.0, native Supabase PostgreSQL17.6.1.106.
The native report proves all three required failure paths on the owned first26:

| Probe | Required result | Verified properties |
| --- | --- | --- |
| Exact former execution program |25P01| Original defect reproduced; ledger/schema/rows unchanged |
| Corrected body plus test DDL/DML, then explicit failure |P2727| Source and marker changes roll back; no applied row |
| Failure in CLI's actual ledger INSERT trigger |P2728| Lock,5s lock_timeout and30s statement_timeout still present; SQL and ledger roll back together |

Each case checks snapshots and removes its test input. The real migrated
ordinal27 then succeeds, followed by all remaining sources through ordinal43.
All43 source/program receipt hashes were independently recomputed from the
exact downloaded source and matched to the native artifact. The executor checks
every actual CLI ledger statement and verifies no changes on repeat migration up.

Native fields: historicalPrefixLedgerVerified=true;
foundationInputsExecuted=43; timestampInputsExecuted=0;
transactionBoundary27.verified=true; lockHeldAtLedgerInsert=true;
localTimeoutsPreserved=true; sourceAndMarkerRollbackVerified=true;
noAppliedProbeRows=true; helpersDisposed=true; cleanupVerified=true;
historicalPrivateInputsDisposed=true; privateWorkspaceRemoved=true.

Fresh offline verification on the same code:9 lock-boundary tests,30 historical
prefix tests,15 lifecycle tests and8 ledger regressions, all PASS (62 total).
The immutable migration check passes601 files and505 version groups. These are
simulated/local controls, not additional native database executions. The actual
native evidence is the job/artifact identified above. No separate human or agent
review, full schema parity, hosted row-access test or whole-repository scan is
claimed by this focused review.

## Remaining acceptance boundary

The ordinary job intentionally still exits nonzero with
`NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED` AFTER the verified43.
The full workflow is not green. The first43 proof does not execute the remaining
101 foundation or514 timestamp stages. completeReplayVerified=false and
generatedTypesVerified=false remain correct. Auth-email and schema/E2E failures
outside this correction are not waived or reclassified as passing.

Next: integrate the reviewed atomic legacy envelope at foundation44–52,
starting20260519_company_invite_temp_password_sync.sql and ending
20260910140053_canonical_auth_provisioning_legacy_boundary.sql. Do not simply
raise LIMIT or flatten later transaction envelopes. Continue full native history,
independent schema reconciliation and types/required CI before merge.

No hosted calls or mutation, original SQL rewrite, fabricated applied ledger,
expected fingerprint/type refresh, forced ref, main merge or deployment.
Legitimate company fields, white-label FK and existing application/API work stay.

## Review scope and routing

Activated Supabase guidance, systematic debugging, differential review and
verification-before-completion for the locked SQL/CLI/ledger path. Source-bound
negative tests and native failure injection supply regression evidence. No UI,
Next.js, performance, cloud deployment or repository-wide security change is in
this documentation-only increment; those skill groups are not activated.
The source, executed native result and actual job failure take precedence over
stale memory and PR wording. Current state remains the sole active work pointer.
