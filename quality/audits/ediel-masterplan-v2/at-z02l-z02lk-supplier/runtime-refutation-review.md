# Z02L / Z02LK bounded runtime-refutation review

**APPROVE the bounded component/refutation packet for retained source-owner review. Actual result: 54 unique cases, 50 PASS / 4 FAIL / 0 errors / 0 skips. Neither supplier acceptance row is approved.** This review parses the supplied complete JUnit/log and reads actual consumers; it does not rerun tests, DB/native, typecheck or lint.

Scope: claim #530 comment5995184621, base `fff486f822001d35970f163507b10e17c3692f58`, tree `82fec813af9a2184259e419a0adbaf4563c2ffe8`. Only this new review file is written. Test writer, implementation owners and #503 canonical/native ownership are retained. Frozen literals and the original-PDF/HB citation limit are recorded in [source-facit-review.md](source-facit-review.md), SHA256 `35c0ce0c046707b9a9108a7aaff239060569f52e873674f39b0fea7b4d771d54`.

## Current exact packet and reached assertions

| Input | SHA256 |
| --- | --- |
| `__tests__/ediel-at-z02l-z02lk-supplier-profile.test.ts` (280 lines) | `b2278560af93c1779c3630daa2b47e2a89886d7688f08906b0b9647e1ef8149e` |
| `current-junit.xml` | `01975646ecf1fb7c68d70b1d02fad82150b84518c5965506c8bbf8a5d33cafaa` |
| `current-run.log` | `16316eaec06d14adde7c71cb28bb11e33caf65657225134476b56b34a2b1c783` |
| `input-preservation.json` | `5b227f561702de305a8a364b6f0c7311bf779f05ca5e7a6a3f08bc555d89356d` |
| `lib/onboarding/inboundEdielLinking.ts` | `b323a5027388b4d99c2687860415443f218c7289921adfbbe8e23888c70df8ee` |
| `lib/ediel/flows/inboundBusinessStateMachineLegacy.ts` | `1d3e51de42176234867d4e1546447c36eae44222e8d0ae04bed6e2db36f5d3be` |
| `lib/ediel/flows/inboundProcessing.ts` | `8ea6ffc72ff5d2bcfab1e89979afd4f35f1d103ce09247578a5cf34c99f502b2` |

Both physical inbound controls pass the actual syntax validator, national field consumer, parser, DDQ/Z02 policy and lifecycle projection with Z22/L and Z23/LK. Ten missing-field cases reach the intended 314/226/260/227/233 diagnostics. The actual outbound outer-entry skip passes. Eight role cases reach the actual JavaScript tenant resolver's supplier/legal/transport comparison (`tenant/resolveInboundTenant.ts:482–490`) with declared identity DTO IO. These controls validate their separately invoked boundaries; accepted inbound outer processing is not executed.

The unique-own-LI, absent/ambiguous/foreign-only candidate, five incomplete proof gates, blocked/needs-review, authorization-port refusal and worker failure controls use the actual linker and unchanged fakeSupabase equality/count/update implementation. Worker result, authorization, identity and table IO remain explicitly synthetic. The added `abortSignal` adapter is a no-op transport port, and the empty settings/profile tables supply declared lookup IO. No mock implements Z02 correlation or market verification. The fake helper's unsupported `or` semantics are not used by these physical-LI fixtures.

All four failures are the two ordinary seam tests at lines257–280, each parameterized for L and LK. A held linker first returns `applied:false` and preserves the prior snapshot; a completed declared atomic-result control first returns `applied:true,targetId:own.request` and preserves the declared source snapshot. Each then invokes the actual business-state facade with the statically mapped null request argument and cached own request hint. Assertions at lines264/277 fail after that consumer replaces `verified_payload` with only `{businessState:'grid_owner_information_received',sourceEdielMessageId:own.message}`. The replacement is observable in the real consumer against synthetic table IO; it is not an injected test side effect.

The source mechanism is concrete: `inboundProcessing.ts:659–681` calls the linker, then uses only `customerInfoRequestId`/`requestId` aliases rather than `targetId`, without conditioning this call on `applied`; `inboundBusinessStateMachineLegacy.ts:243–253` falls back to the cached hint and performs the replacement. This statically links the seam to the caller, but does not prove runtime reachability through accepted outer admission. **The trailing request-status, verified-event and no-business-write assertions after the failed equalities are not reached and receive no credit.** No supply-start, cross-tenant exploit, native atomic storage or full-pipeline conclusion follows from these four failures.

## Historical attempts remain distinct

| Supplied artifact | Actual complete suite result | Classification |
| --- | --- | --- |
| `first-junit.xml` / `first-run.log` | 44 unique; 38 PASS / 6 FAIL, zero errors/skips | Two invalid physical fixture controls, four snapshot replacement failures. National-field contrasts lacked a qualified valid baseline. |
| `corrected-control-junit.xml` / `corrected-control-run.log` | 44 unique; 38 PASS / 6 FAIL, zero errors/skips | Wire controls repaired; two misplaced outbound pure-lifecycle oracles, four snapshot failures. Pure projection is not the outer direction gate. |
| `qualified-control-junit.xml` / `qualified-control-run.log` | 54 unique; 42 PASS / 12 FAIL, zero errors/skips | Eight role cases aborted on an undeclared settings table, four snapshot failures. This historical filename is not a qualification verdict. |
| `current-junit.xml` / `current-run.log` | 54 unique; 50 PASS / 4 FAIL, zero errors/skips | Valid controls; only the four bounded snapshot refutations remain. |

The first digest receipt records `b42cccdd8bc0a47f8adcb8de5ade3f231c89024d4ccca1d92da3e8f80eadad50`; exact first source bytes were not independently recovered and are not claimed to equal current bytes. The targeted physical diagnostic run is a two-selected-case probe with 42 skips, not a full-suite pass. Fixture syntax, misplaced lifecycle oracle and undeclared lookup failures are test-packet errors, separate from the retained four consumer refutations.

## Limits and handoff conditions

This is a valid bounded red reproduction for the retained source owner. It leaves accepted outer admission/ledger routing, real own-Z01/party/object/grid/LI authority, private atomic receipt and persistence, persisted supplier identity/RLS, physical CONTRL/applicable APERAK generation and custody, separate guarded Z03 readiness, transport and authentic native/current-main composition unqualified. Only five selected missing fields are tested; all remaining R/D conditions, D229 context, later/multiple registers and replay are outside this packet. A declared job receipt is not proof that the native core ran. Whole rows and coverage remain unapproved pending owner repair and source-owned integration evidence.

Review commands: read-only `sha256sum`, `rg`, numbered source reads, and Python `xml.etree.ElementTree` parsing of every supplied testcase (including duplicate-name/error/skip checks). No test/DB/native execution. Empty typecheck/lint logs alone do not establish successful exit status; their execution qualification is separate. Relevant source hashes above are local-base receipts, not independently refreshed remote-main parity or native evidence.

## Final documentation and current-input follow-up

Read README, checkpoint, result qualification, verification receipt and `current-main-adoption.json`. Their mechanism/counterargument language retains the direct-consumer boundary and excludes accepted-flow/native/exploit/whole-row conclusions. The writer reports final scoped typecheck and lint both exited0 at the frozen `b2278560` test; this is an explicit execution-status report, not an inference from empty logs, and was not rerun by this reviewer.

Read-only `git show` comparison independently confirms all23 recorded source/fixture/spec hashes and package/lock equal both historical proof main `683b3e60b67f71293cd44c14d591f877474f0f88` and adopted HEAD/main `3dff03dd8bb8c251b1613d35ce6fc7e66e6ee686`. Coverage equals adopted main and differs from historical main; foreign coverage is preserved, not rewritten by this lane. This supersedes the initial local-only hash limitation for exactly these checked inputs, without claiming native or whole current-main qualification. Adoption receipt SHA256: `2de887084782852188697c3e370092836913ea620eb7e716433be83790d1685c`.

Minor documentation follow-up sent to writer: mark README/checkpoint's coverage-equality-to683 statement historical and point to adopted-main custody; update checkpoint's older peer-only-source-review sentence to include this authorized review. These freshness changes do not affect frozen test bytes or the 50PASS/4FAIL verdict. No additional packet blocker found. The source-owner handoff remains a bounded red reproduction; no source repair, accepted outer-flow or canonical/native claim is approved.

README freshness correction subsequently inspected (SHA256 `c076a57d6b96316ec973ffea9247990761d201e8b9a05ee4158f3bea29561e2f`):683 is now explicitly the execution proof and3dff the later preserved adoption. The writer will mirror that qualification and authorized two-review-file scope in the checkpoint. Current test remains `b2278560`; both coverage rows independently read as `NOT_EXECUTED` with empty evidence. Final bounded packet approval is unchanged.
