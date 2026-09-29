# ACK-08 — actual UTILTS ERR gateway, 2026-09-29

## Baseline and requirement scope

Same draft #421, branch `codex/ediel-v2-identity-e035-owner-20260928`, starting local/remote/PR head `0b6ea32ad7e284fc3eca30e827b16aab64614a31`, main `53bf989b0ad402bb2ce151c186eea31f1ec9cf03`. Clean tree, no unpublished commits and five successful baseline workflows were rechecked, not rerun. E72 and E73 are already corrected; native baseline 407/407, types SHA256 `36e989375ef5313e506a04f7d6e79b4058316ed0f39eb7d9530658fa1cbbed6d`, schema fingerprint `c66e9457de217943904622927f60618c5fa0af1546376906df52bf7e360a7924`.

The accompanying reconciliation covers all 121 rule cards and 231 acceptance contracts and hashes every existing code/test reference. It preserves formal coverage and inherited 2026-09-27 semantic verdicts. Five fresh independent bounded requirement reads found the queued U-02/U-03/U-14/ACK-03 candidates and selected ACK-08. Root owns all writes; requirement/refutation agents were read-only, as required by the compliance skill.

Affected bounded clauses: **ACK-08**, **AT-ACK-08**, **SC-044**, proper-scope part of **U-03**, **CALL-09**. Frozen A rule card ACK-08 requires correct mutation/ACK scope; D SC-044 separates accepted, guide-negative and functional-negative IDE outcomes. Masterplan E87 and frozen U appendix2 p132 identify the genuine wrong observation-count fault. This is not full acceptance of these whole requirements.

## Reproduction before product changes

Actual `runUtiltsRuntimeForMessage` supplies September E19 and October E87 dispositions. The October fixture has a 30-minute period, 15-minute resolution and one observation; the guide accepts it and functional validation rejects its own IDE. Physical IDEs remain distinct, including two with a shared prefix longer than the legacy 18-character wire token.

1. `createUtiltsRuntimeAcks` → `createAckIfMissing` → `buildUtiltsErrDraft` → common builder → actual canonical gateway/validator. Builder unconditionally sets process `ack`; canonical ERR profile owns `functional_rejection`. The real validator blocks before ERR write/finalization with `CANONICAL_PROCESS_GROUP_MISMATCH`. ERR is active outbound in the canonical UTILTS profile; this is not an activation hold.
2. To isolate the second defect, a diagnostic-only draft property is set to the canonical policy process. The actual gateway/find function keys ERR duplicates by the first error code alone (`utiltsErrSequenceToken`), and source operation uses the same code. Two different IDEs with E87 return the same ACK ID containing only the first `RFF+TN`. Actual finalization can then attach both reservations to that ACK. This is also reachable with an existing ERR row.

Independent refutation confirmed both call chains and ran four temporary real-source probes. The new repository ordinary suite ran **4/4 RED** before product changes: two true process-mismatch failures, the distinct-ID assertion failed, and mixed interruption failed earlier at the process mismatch. Runtime, builder, validator, kernel, DB create/find and finalizer are real; only Supabase IO is in memory, unknown tables/RPC throw and network is forbidden. Ordinary RED is retained locally until the corrective commit so the native test-only publication isolates durable evidence.

## First native proof — pending, product unchanged

`scripts/ediel-utilts-err-gateway-native.test.ts` is added to the mandatory local-only native suite. It seeds isolated synthetic tenant/legal actor, matching point/request, ACK route/profile and source-owned E66 bytes. No transport worker runs. The actual canonical public UTILTS dispatcher, matching, source binding SQL, transaction reservation, ACK builder, canonical policy validator, row writer and finalizer execute. Only final metering/billing/completion writes are observed.

Four cases require: two same-code ERRs with own IDs/physical references and zero positive/sink/series effects, separate clean positive control; mixed accepted/guide-negative/two function-negative reservations and physical ACKs; interruption before second ERR insertion with immutable first ACK/reservation and convergent retry; direct native gateway duplicate-identity isolation with canonically qualified drafts.

These tests do not turn the existing mixed-functional consumption hold into full SC-044 acceptance. Outbox rows are snapshotted for retry integrity; this direct consumer creates durable ACK drafts and does not invoke external transmission. No atomicity claim is made for the whole ACK loop; committed first-ACK recovery is explicitly tested. Local PostgreSQL/docker are unavailable, so native results must come from the authentic exact-head clean replay.

## Minimal correction, conditional on first native evidence

Keep canonical validator/source/tenant/route evidence intact. Derive ERR business process from the canonical UTILTS profile in `ack.ts`. For transaction-scoped APERAK **or ERR**, use full original IDE for duplicate lookup, source-operation identity and unique-violation recovery. Retain code-sequenced unscoped ERR behavior. No SQL change or public API/type change is proposed.

## Holds and next action

Publish substantive native/test/reference evidence fast-forward, inspect the first actual native failure before product edits, then correct and run focused ordinary/type/lint and five exact-head workflows. Historical203/505 issuer/originals/retention, positiveLOC175 owner/mandate/consumer/ACK and fullE035 stay blocked. Older Storage delete/before_witness cause stays unknown. #421 remains draft/unmerged, #310 untouched, traffic held. No staging, TGT/AGT, counterparty trial or real send.
