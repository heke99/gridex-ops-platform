## Final exact-head receipt — 2026-09-30

Finaldc1c9bae five mandatory workflows and OPS verify/quality/replay SUCCESS; native411/411, all4 ERR cases, case/browser/tenant/parity/types/schema PASS. Exact run/job IDs and limits: S02 successor audit and PR421 final receipt. Earlier pending text is historical and SUPERSEDED by this authentic final result. No concurrent/whole-ID/market closure.

# ACK-08 — actual UTILTS ERR gateway, 2026-09-29

## Baseline and requirement scope

Same draft #421, branch `codex/ediel-v2-identity-e035-owner-20260928`, starting local/remote/PR head `0b6ea32ad7e284fc3eca30e827b16aab64614a31`, main `53bf989b0ad402bb2ce151c186eea31f1ec9cf03`. Clean tree, no unpublished commits and five successful baseline workflows were rechecked, not rerun. E72 and E73 are already corrected; native baseline 407/407, types SHA256 `36e989375ef5313e506a04f7d6e79b4058316ed0f39eb7d9530658fa1cbbed6d`, schema fingerprint `c66e9457de217943904622927f60618c5fa0af1546376906df52bf7e360a7924`.

The accompanying reconciliation covers all 121 rule cards and 231 acceptance contracts and hashes every existing code/test reference. It preserves formal coverage and inherited 2026-09-27 semantic verdicts. Five fresh independent bounded requirement reads found the queued U-02/U-03/U-14/ACK-03 candidates and selected ACK-08. Root owns all writes; requirement/refutation agents were read-only, as required by the compliance skill.

Affected bounded clauses: **ACK-08**, **AT-ACK-08**, **SC-044**, proper-scope part of **U-03**, **CALL-09/11/12/13**. Frozen A rule card ACK-08 requires correct mutation/ACK scope; D SC-044 separates accepted, guide-negative and functional-negative IDE outcomes. Masterplan E87 and frozen U appendix2 p132 identify the genuine wrong observation-count fault. This is not full acceptance of these whole requirements.

## Reproduction before product changes

Actual `runUtiltsRuntimeForMessage` supplies September E19 and October E87 dispositions. The October fixture has a 30-minute period, 15-minute resolution and one observation; the guide accepts it and functional validation rejects its own IDE. Physical IDEs remain distinct, including two with a shared prefix longer than the legacy 18-character wire token.

1. `createUtiltsRuntimeAcks` → `createAckIfMissing` → `buildUtiltsErrDraft` → common builder → actual canonical gateway/validator. Builder unconditionally sets process `ack`; canonical ERR profile owns `functional_rejection`. The real validator blocks before ERR write/finalization with `CANONICAL_PROCESS_GROUP_MISMATCH`. ERR is active outbound in the canonical UTILTS profile; this is not an activation hold.
2. To isolate the second defect, a diagnostic-only draft property is set to the canonical policy process. The actual gateway/find function keys ERR duplicates by the first error code alone (`utiltsErrSequenceToken`), and source operation uses the same code. Two different IDEs with E87 return the same ACK ID containing only the first `RFF+TN`. Actual finalization can then attach both reservations to that ACK. This is also reachable with an existing ERR row.

Independent refutation confirmed both call chains and ran four temporary real-source probes. The new repository ordinary suite ran **4/4 RED** before product changes: two true process-mismatch failures, the distinct-ID assertion failed, and mixed interruption failed earlier at the process mismatch. Runtime, builder, validator, kernel, DB create/find and finalizer are real; only Supabase IO is in memory, unknown tables/RPC throw and network is forbidden. Ordinary RED is retained locally until the corrective commit so the native test-only publication isolates durable evidence.

## First native proof — authentic test-only RED before product changes

`scripts/ediel-utilts-err-gateway-native.test.ts` is added to the mandatory local-only native suite. It seeds isolated synthetic tenant/legal actor, matching point/request, ACK route/profile and source-owned E66 bytes. No transport worker runs. The actual canonical public UTILTS dispatcher, matching, source binding SQL, transaction reservation, ACK builder, canonical policy validator, row writer and finalizer execute. Only final metering/billing/completion writes are observed.

Four cases require: two same-code ERRs with own IDs/physical references and zero positive/sink/series effects, separate clean positive control; mixed accepted/guide-negative/two function-negative reservations and physical ACKs; interruption before second ERR insertion with immutable first ACK/reservation and convergent retry; direct native gateway duplicate-identity isolation with canonically qualified drafts.

These tests do not turn the existing mixed-functional consumption hold into full SC-044 acceptance. Outbox rows are snapshotted for retry integrity; this direct consumer creates durable ACK drafts and does not invoke external transmission. No atomicity claim is made for the whole ACK loop; committed first-ACK recovery is explicitly tested. Local PostgreSQL/docker are unavailable, so native results must come from the authentic exact-head clean replay.

Published test-only head **a671a663aa00a08eaee7c2d52c6c117418c0ad8b** (tree a917efb21cb6652b5316d3670654e946194072ef) is the same local/remote/PR head. OPS **36636440192**, clean replay job **109638111444**, completed native **407 PASS / 4 FAIL / 411 total**. All previous407 tests passed. The first two actual consumer cases and interruption case fail at canonical process mismatch. The diagnostic-only canonically qualified direct gateway returns the first ACK ID for the second distinct IDE. These are actual product RED results; no fixture setup, Storage or migration failure explains them.

Ediel36636440244, browser36636440376, FullE2E36636440160 and tenant36636440211 were successful; OPS verify109638111820 and quality109638111768 succeeded. No unchanged-head jobs were rerun.

## Minimal correction after native RED

`ack.ts` now derives ERR business process from the canonical UTILTS profile. `core/kernel.ts` now uses full original IDE for transaction-scoped APERAK **or ERR** duplicate lookup, source-operation identity and unique-violation recovery. Code-sequenced unscoped ERR behavior and APERAK-specific legacy constraint diagnosis remain. Canonical validator, source inheritance, tenant/route evidence and durable finalizer remain owners. No SQL, grants, schema snapshot, generated type or public API changes.

Ordinary real-runtime/builder/gateway/validator/finalizer controls are now **108/108 PASS in six files**, including two ERR unique-violation cases: recover only a matching committed IDE, and propagate23505 if that IDE is absent rather than borrow another ACK. The synthetic insertion race is ordinary IO evidence, not native concurrency proof. Tests/scripts TypeScript PASS, scoped ESLint0errors/4 inherited unused warnings, canonical ACK persistence/chain/acknowledgement-engine regressions PASS, diff PASS and frozen33 originals/121/231 integrity PASS.

An optional uninvoked static script `gridex-utilts-aperak-profile-regression.cjs` fails its stale source-string check on both this change and verified baseline0b6ea32a, which uses `usesUtiltsAperakProfile`. It is not changed or claimed green. Required exact-head gates still own delivery.

The corrected native fixture removes prefilled canonical source columns and requires the real inbound family/date evidence trigger, checking its authority, effectiveDate and evidence-only role. Retry snapshots now include full source receipt and reservation row (including finalized_at/updated_at), plus ACK created_at/updated_at, bytes, identity, policy, contracts and outbox. An independent read-only review approves this bounded correction pending exact-new-head native/five gates; zero introduced Critical/Important findings. The suggested retained23505 regression is now added.

**Inherited concurrency limit:** the database ACK unique index includes generated transaction_reference; source_operation_id has no unique index. Sequential interruption/retry and23505 recovery do not establish concurrent same-IDE deduplication. No blanket ACK-loop atomicity or repair of immutable historical wrong ACKs is claimed. See the separate differential review.

## First corrected native and actual delivery follow-up

Published correction **d8eccdd6dd2664550c099a9692f6219dd2a43381**: OPS36639375564 clean replay **109647751095 SUCCESS**, actual native **411/411 in7 files**. All four new ERR native cases pass, including real source family/date capture and full receipt/reservation/ACK timestamp stability. Case-native/browser1/1, tenant invariants, parity selftest, unchanged generated types and fingerprintc66e9457 PASS.

Ediel36639375646, browser36639375657, tenant36639375538 and OPS verify109647751121 passed. First remaining actual failure in FullE2E36639377447 smoke/coverage and OPS quality109647751055 is the new operational direct import ofutiltsRulebook. All6255 other ordinary tests passed. This is an introduced authority-boundary violation, not a fixture, schema, Storage or environment issue.

The substantive follow-up consumes **resolveCanonicalEdielPolicy** instead, selecting policy from the generated ERR's own DTM137 date as the existing validator does. Association/guide selection remains in canonical policy; no guard or allowlist is relaxed. CONTRL/APERAK and full-IDE duplicate/recovery semantics remain unchanged. Existing real Sep30E19 and Oct1E87 cases now fix only Date and assert own generated document date, restoring timers after each case.

Actual local follow-up: **109/109 in7 files**, including normative authority guard and dated ERR cases; tests/scripts TypeScript, lint0errors/4 inherited warnings, route-readiness and canonical ACK persistence/chain/engine PASS. Final follow-up exact-head native411 and all five gates remain pending; the previous-head native result does not substitute for them.

## Canonical authority and actual CALL ownership

| Boundary | Owner and executed path | Bounded evidence |
|---|---|---|
| Source selection / execution context | `resolveCanonicalEdielPolicy`, retained inbound policy, inherited activated source rule profile/version/hash, verified tenant actor and ACK route/profile | Native source insert and real gateway; ACK row policy snapshot, company and source-operation identity |
| CALL-09 physical AST | canonical tokenizer/transaction parser | Own physical IDE remains the complete ACK identity and raw RFF target |
| CALL-11 national U execution | `runUtiltsRuntimeForMessage` → canonical UTILTS dispatcher → actual-value processor → source-bound persistence RPC | Genuine per-IDE dispositions; committed reservation, accepted series/contract; failed/rejected IDEs cannot reach sinks |
| CALL-12 ACK execution | `createUtiltsRuntimeAcks` → builder → `createCanonicalAckMessage` → real validator/writer → `finalizeUtiltsTransactionAck` | Separate durable ERR IDs and scoped final response, interruption recovery and immutable retry |
| CALL-13 durable business boundary | existing consumption binding/reservation and bound sink adapters | Native snapshots/spies; no new SQL, grant or tenant-authority semantics |

The table ties the bounded change to the actual consumers, not just the parser's CALL-09. CALL-11 is the frozen contract explicitly linking U-03 and ACK-08. Formal statuses remain partial. The active ACK gateway is exported from `core/kernel.ts`; the old `kernelLegacy.ts` ACK definition has no direct product importer and is not re-exported by that facade. Its unused duplicate body is not independently refactored in this correction.

## Holds and next action

Publish the substantive canonical-facade follow-up fast-forward fromd8eccdd6, then require its own native411/411 and five exact-new-head workflows before a final delivery receipt. The next source-backed U-02 S02 mandatory own-LOC172/QTY135 borrowing candidate has ordinary evidence but still needs native RED before product change. Formal whole-contract statuses remain unchanged. Historical203/505 issuer/originals/retention, positiveLOC175 owner/mandate/consumer/ACK and fullE035 stay blocked. Older Storage delete/before_witness cause stays unknown. #421 remains draft/unmerged, #310 untouched, traffic held. No staging, TGT/AGT, counterparty trial or real send.
