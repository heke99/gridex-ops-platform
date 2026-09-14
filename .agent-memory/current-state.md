# Current state — database reconstruction, 2026-09-14

Status: PARTIAL

Native foundation1–56 is VERIFIED on actual Supabase. The complete provider-
event fix is PUBLISHED as b1a80fb1829463eea57f026080e248005a720e94, tree
e03c94394d124a42038df6ca63d5a4e38c9423de. The old tool publication block and
P0004/P5653 mismatch are SUPERSEDED. Do not republish or re-fix that patch.
Full replay, generated types, release and plan85/86 are NOT accepted.

## Current verified evidence

Ordinary OPS34888356621 / clean job104124511143 / artifact10365822727.
Native outcome: NATIVE_HISTORICAL_THROUGH56_VERIFIED.
ZIP SHA256:3b2add320cbdc5d91b9d59061cb2955e71315e4d0563883c0f006141d143d6b6.
All43 prefix inputs plus the one44–52 and one53–56 CLI units are verified.
The actual ledger, unchanged earlier entries, source preservation, no-op repeat
and private/owned-resource cleanup pass. All nine repair56 negative controls
pass:42501, four P0004 controls, P5653,57014,P5656,P5657.
The eight native provider event/routine contracts match the pristine image.
No event was disabled, no domain privilege expanded and no historical version
fabricated. GraphQL cache-sequence VALUE rollback is explicitly not claimed.
Zero timestamp inputs execute. Full replay/types flags remain false.

Fresh independent check:56 source hashes,43 prefix program hashes,8 support
hashes and native result/rollback/repeat/cleanup assertions PASS. Fresh145
local control tests and601-file/505-group integrity PASS. Local callbacks are
not native SQL evidence. Full receipt:
quality/audits/DB_NATIVE56_VERIFIED_2026-09-14.md.

## Active implementation and release blockers

Next actual code task is native foundation57 (H2), then fixed-target58–63.
The pinned H2 source has BEGIN/COMMIT followed by a verification SELECT; the
native adapter must qualify that exact transaction/ledger shape while keeping
the whole source. Do not drop verification or assert rollback across COMMIT.
Continue remaining foundation64–144 and514 timestamp stages afterwards.

The ordinary clean job intentionally stops AFTER verified56 with
NATIVE_LATER_ENVELOPES_AND_FULL_ACCEPTANCE_REQUIRED. Full schema/reference,
residual source, full E2E, auth-email and generated-types gates remain failed.
The types tail is20260913211625_ediel_intent_customer_company_integrity.sql;
actual generation from complete accepted replay is required, not a manifest edit.

## Whole PR310 to main

Preserve the complete PR310 branch and all existing changes for eventual merge;
do not cherry-pick only this fix. The eight-file fix extends the previous head
normally. All4049 prior files were compared: only six intended existing patch
files changed and two new files were added. The original601 migrations, real
company/white-label fields, all app/API work and the paused partner-price patch
are intact. No hosted mutation/reset, main merge, force push or deployment.
Main at inspection:eb9a25bc989c6de808903f41c2314d5465e9c07b. PR remains draft.
Merge the entire PR only after complete replay/schema/auth/types and required
same-head CI pass. No further user approval is needed for the requested work.

## Machine-checked continuity contract

Working-tree accounting is 601 inputs: 589 `FULL_FILE_SELECTED`, 2 `SUBSTITUTED`, 5 `UNCLASSIFIED`, and 5 `EXPLICITLY_EXCLUDED`.

The focused group contains 347 inputs: 335 selected, 2 substituted, 5 unclassified, and 5 excluded.

No production mutation has been performed in this replay-verification batch.
Push reviewed, coherent batches stepwise as requested.
