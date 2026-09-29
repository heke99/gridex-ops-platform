# U-02 S02 mandatory physical scope — test-first candidate

Status: **ordinary-confirmed; native unproved**. Baseline product and last fully verified draft head: `dc1c9baef6b9146a38d3c3aefddb66949fd7ee92`; main `53bf989b0ad402bb2ce151c186eea31f1ec9cf03`. Root owns writes; reviewer is read-only. No product/SQL/type/schema/grant change in this probe.

## Sources and exact requirements

Recovered original U SHA256 `0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be` and UE SHA256 `a2f2018077b253bb012ef0255c6dc98dcfffeb65b9e707af5ca131838990a92a` match `source_manifest.json`. Both originals §3.7 pp51–52 require each repeated S02 SG5/IDE24 to own LOC172; each observation owns SEQ and planned QTY135. Swedish running footer says25-A-5 while the uploaded filename/frozen source is25-A-4; that discrepancy is retained, not silently relabelled.

| ID | Physical source requirement | Probe |
| --- | --- | --- |
| UF-planning-505-51 | Required own SG5/IDE24 transaction ID | Full S02-OWN/S02-SIBLING IDs, both orders, no anonymous substitute |
| UF-planning-209-51 | S02 required SG5/LOC172 | Remove own point only; sibling retains a different valid point |
| UF-planning-514-52 | Observation SEQ starts at1 | Preserve own SEQ1 so missing QTY isolates field515 |
| UF-planning-515-52 | Required SG11/QTY135 planned volume | Remove own quantity only; sibling retains quantity222 |
| CALL-09 | No first-hit general authority | Actual physical parser/own fields rather than global LOC/QTY |
| CALL-11 | Shared policy and staged per-IDE outcomes | Public canonical S02 nonbilling dispatcher and retained policy |
| CALL-12 | Original family, disposition and correlation | Real APERAK312/313, full ACW IDE, final reservation-to-ACK linkage |
| CALL-13 | Validated plan and DB guards | Real service RPC, source/raw/membership/tenant binding and atomic rollback |

Fixture constraints verified in UE pp40/50–52/69–72/93: `23-DDQ-S02-S`, BGM S02/SVK260, MKS planning E04, reason Z01/SVK260, monthly DTM324/354, latest-update DTM368, legal header MS/MR and DDQ. No register, actual QTY136/220, transaction NAD, CCI/CAV, PIA or LOC175. Fresh source BGM and UNB/UNZ IDs; identical retry reuses stored bytes.

## Reproduction and refutation

`npx vitest run __tests__/ediel-utilts-s02-required-scope.test.ts --reporter=dot`: **2 PASS /6 FAIL /8 total** on unchanged dc1c9bae product code. All six missing-point/quantity/both cases, both IDE orders, returned accepted/positive_aperak rather than the required own guide-negative. The two clean controls preserved distinct own points111/222 quantities and empty nonbilling consumption observations. Actual structure qualifier returned no internal hold. The ordinary RED file stays local until the corrective commit so native delivery isolates the durable boundary.

Independent read-only review/probe on dc1c9bae verified exact source hashes/columns, canonical runtime, qualifier, preparation and payload. All eight combinations accepted; the defective own payload retained null point and/or empty quantities. `profiles.ts`/legacy validation global fallback does not justify those missing physical fields. Latest bound SQL skips S02 identity checks when observations are empty; `persist_series_v1` currently permits forecast series with no own quantity. These traces identify risk, not native persistence proof.

Business impact if native confirms: a malformed own forecast may acquire durable accepted reservation, series and positive APERAK using sibling validation context. Important severity, bounded to own required fields and nonbilling data; no actual metering/billing authority is inferred.

## Native oracle

15 new cases in `scripts/ediel-utilts-s02-required-native.test.ts`, explicitly included in the mandatory owned-local config. Plain inbound source insertion executes the real family/date evidence trigger; no prefilled profile. Isolated legal tenant actors54350–54367 and real local ACK profiles; public facade, canonical dispatcher, persistence, validator/gateway/writer/finalizer stay real. Only final metering/billing/completion writes are observed.

- Two clean consumer controls: distinct forecast points/values111/222, two actual positive APERAKs, correct finalized reservations and nonbilling contracts, no actual consumption, full row/byte/timestamp retry equality.
- Six defective consumer controls: consume first, then require own negative APERAK/ERC41/field209 and/or515 with no own series/value/contract or positive ACK; clean sibling persists222 and separate positive ACK. No UTILTS_ERR. Retry compares full receipts, reservations, ACKs, series/values/contracts and outbox.
- One clean direct service control: actual prepared forecasts persist and retry unchanged without emitted ACK.
- Six direct malformed batches: deliberately attempted accepted dispositions with actual own fields and observations[]. Run both identical attempts, require specific physical point/quantity refusal and zero receipt/reservation/series/value/contract/ACK/outbox for the entire batch, including the valid sibling.

Native426/426 is an eventual gate, **not executed yet**. Local Docker/psql unavailable. If clean setup fails, diagnose it before claiming the risk confirmed; if native RED confirms it, make the smallest shared guide/prewrite forward correction and verify its own exact head. No synthetic actual observations, live route or historical mandate.

## Skill routing and verification

Existing using-superpowers/codex-tools routing, writing/executing-plans, systematic-debugging, TDD/writing-good-tests, spec-to-code-compliance, fp-check, differential/code review, requesting-code-review, verification-before-completion and Supabase/native SQL review apply. Original recovery/PDF read applied library/PDF skills. Property-based testing is conditional on parser invariants beyond these finite source clauses; receiving-code-review applies to feedback. UI/Next/React/performance/dependencies/auth changes and repository-wide audit are absent; worktree isolation is unnecessary with one writer. No new role/grant/RLS or deployed capability is introduced.

Scripts/tests TypeScript and scoped lint PASS; ordinary RED above is expected. Independent review corrected the actual FTX+AAO field oracle and raw direct-RPC boundary before publication. Frozen121/231 integrity, memory git-state and diff check PASS. Independent reviewer APPROVES bounded test-only setup, no outstanding Critical/Important after both oracle corrections. The complete masterplan reconciliation remains dated to0b6ea32a; wider U-02/U-03/U-14/ACK-03/ACK-08 and AT rows stay partial/unclosed.

## Previous package final receipt and continuing blocks

ERR final dc1c9bae: Ediel36641978972, browser36641978974, FullE2E36641978957, tenant36641979472, OPS36641978949 SUCCESS; verify109656114876/quality109656115294/replay109656115263 SUCCESS, native411/411, case/browser/tenant/parity/types/schema PASS. Types SHA25636e989375ef5313e506a04f7d6e79b4058316ed0f39eb7d9530658fa1cbbed6d; unchanged schema c66e9457de217943904622927f60618c5fa0af1546376906df52bf7e360a7924. PR description carries final receipt; older pending memory is superseded here in this substantive test/evidence commit. Zero review threads/reviews, clean baseline/no unpushed.

Historical203/505 issuer/history/retention, positiveLOC175 registry/legal actor/mandate/separate consumer/final ACK-retry owner and fullE035 remain blocked. Older Storage delete/before_witness cause unknown. Draft#421 unmerged; #310 untouched; traffic held. No staging/TGT/AGT/counterparty trial or real send.
