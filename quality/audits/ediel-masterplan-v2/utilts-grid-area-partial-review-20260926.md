# Differential review — #407 partial UTILTS guide rejection

## Verdict and scope

**Conditional until exact-head native replay and ordinary CI pass.** One high-impact attribution defect was found in the first corrective head and fixed before merge. No market activation is approved. This review covers the processor's new mixed-IDE consumption branch, its existing source-bound persistence and sinks, the guide projection, three mocked consumer controls, and the native mixed-source fixture. It does not certify all F3C, every UTILTS product, bilateral identity or E035 history.

| Severity | Open in this bounded change | Resolved before final head |
| --- | ---: | ---: |
| Critical | 0 | 0 |
| High | 0 | 1 |
| Medium | 0 | 0 |
| Low | 0 | 0 |

## Change and ownership

Base main `08e06301`; PR #407 first head `ab30398d`, corrective head `affac659` plus current request-scope guard. `processInboundUtiltsMessage` is called from inbound processing, operational bridge and admin actions. The original message belongs to tenant-scoped `ediel_messages`; the private SQL binding owns physical IDE dispositions, source bytes, immutable contracts and accepted series. `ingestBoundUtiltsMetering` and `createBoundUtiltsBilling` read only authority returned by the persistence adapter and perform their own source and tenant checks. The processor publishes the final per-IDE APERAK after those sinks. It does not close a whole data request on a mixed guide rejection.

The previous whole-message early return was introduced with the original runtime branch (`d8d54e78f`) and expanded for persistence failure (`650bdb211`). No existing security validation was removed. The new branch activates only when every error is an application finding with ACW reference to a rejected physical IDE, at least one distinct IDE is accepted, and structural, header and functional gates are clean. Every accepted sink input must have a returned SQL-bound contract. Malformed header, internal review, functional error and all-rejected sources retain the original stop.

## Finding resolved before publication

**High — mismatched request attribution for a valid sibling.** `linkInboundUtiltsMessageCanonically` can link a request from a message reference or first matching metering point while a second IDE has another point. Without an extra check, a valid sibling's metering contract could carry that unrelated `sourceRequestId`, and the billing context could create an underlay for the wrong request. A source with invalid IDE A and valid IDE B was the concrete entry path; the newly opened partial branch would have consumed B while the message-level request belonged to A.

The correction compares the accepted bound contract's request ID, tenant-owned customer and metering point, plus present site/grid owner, against the matched request; any discrepancy throws an internal scope conflict before meter, billing or ACK. The test `holds a positive sibling before ACK when its bound point and customer differ from the linked request` exercises the mismatch through the actual processor, matching and binding adapter. The native valid-sibling fixture checks the positive matched path on a clean SQL replay. A broader cross-request mapping audit for already accepted multi-IDE paths remains outside this criterion and market traffic stays gated.

## Adversarial and retry checks

An inbound counterparty can choose malformed LOC text and multiple IDEs but cannot choose the private persisted contract or tenant owner. A wrong-point message reference is held before positive ACK. An absent SQL receipt, altered source bytes, duplicate physical IDE, conflicting ACK finalization or changed stored contributor fails in the binding/sink layers. The new native case interrupts after real sink writes and before any ACK, then retries identical bytes and verifies one accepted series, one meter and one billing row, stable bound rows and distinct negative/positive APERAK. A rejected IDE never enters these sinks. The ordinary CI native replay, full E2E, browser and Ediel regressions must all pass on the final exact head.

## Limits and release decision

This code review does not establish a historic identity owner for field 203 or IDE number uniqueness, a positive LOC175 regulating-object sink, E035 complete historical coverage or retention, or permission for market transport. #310 remains paused. Treat the web deployment and this bounded rule as separate receipts; Ediel transmission and case automation remain off until their actor, source, transport and market-test gates are independently satisfied.
