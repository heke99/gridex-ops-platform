# Masterplan v2 reconciliation — 2026-09-29

Review head `0b6ea32ad7e284fc3eca30e827b16aab64614a31`, draft #421; main `53bf989b`. All **121 rule IDs + 231 acceptance IDs** reconcile exactly. All **346 unique code/test paths** exist and have a current-head SHA256 in the companion JSON. **105 rows** cite files changed since the old main baseline; **95** since the old audit head. These rows need semantic revalidation, not a copied green verdict.

Formal ledger is unchanged: rules 114 NOT_VERIFIED / 7 PARTIAL; contracts 224 NOT_EXECUTED / 7 PARTIAL. Historical 2026-09-27 implementation verdicts remain explicitly inherited in every row. Reference existence and CI407/407 do not establish formal acceptance or a whole-system completion percentage.

## Five bounded fresh reviews

| Requirement | Current bounded finding | Next proof |
|---|---|---|
| U-02 / AT-U-02 / CALL-09 | S02 borrows sibling point/quantity in validation; own RPC payload remains null/empty and accepted. | Native direct atomic refusal, actual consumer and positive/negative/retry. |
| U-03 / SC-045 | Guide-before-function works. Direct reprocessing skips full UNT syntax; header313 gets transaction-level BGM-as-ACW. | Native direct consumer syntax refusal; separate header scope test. |
| U-14 / SC-054 / CALL-13 | Canonical storage ordering holds. Received-source manual positive APERAK can reach mocked transport with no storage-authority call. | Native manual gateway storage refusal. Actual transport not exercised. |
| ACK-03 / SC-045 / U p109 A505 | Header negative ACW is BGM; empty physical IDE becomes synthetic transaction-1; generic positive also falls back to BGM. | Native physical reference, header/message scope, positive and transaction-negative controls. |
| ACK-08 / SC-044 / CALL-09 | ERR wrong process type blocks actual gateway; qualified same-code distinct IDEs share one ACK. Independent refutation confirmed both. | **Active:** ordinary RED first, real native consumer/gateway, mixed ACKs and interruption/retry. |

Each row in the JSON includes exact inherited/formal status, source, code/tests, changed references, linked IDs, canonical callsite owner, fresh review if any and next action. The five reviews are bounded; linked contracts are not silently promoted to a newly verified result.

## Execution strategy and holds

Complete one source-backed defect with test-first native proof and exact-head gates, then take the next listed candidate. Reuse verified unchanged evidence. Formal 121/231 closure requires individual expected/prohibited behavior and its real consumer evidence, not blanket retesting. External issuer/originals/retention, positive LOC175 and full E035 blockers are unchanged; owners must supply authentic evidence and policy before those packages can close. Older Storage cause is still unknown.

No merge, staging, TGT/AGT, counterparty trial or real transmission. #310 untouched; traffic held.
