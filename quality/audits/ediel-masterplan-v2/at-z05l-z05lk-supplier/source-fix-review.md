# Z05 operational task scope — independent differential review

**APPROVE this bounded app repair.** Exact source SHA256 `8e810fd5caca5ea235207795d0fd1a7cc19b943a680faae32cc6e2a78d11aa43`; unchanged new test `2a076859c7ef7abea5d7aebfa68bd20e28817a97b4668db3cd9bc97b8e8729f4`. Comparison baseline is historical RED checkpoint `d8d2a6c19c4c04d73b46465e14cd3d90642513c1`, Legacy source `1d3e51de42176234867d4e1546447c36eae44222e8d0ae04bed6e2db36f5d3be`. No Critical/Important defect remains in this exact repair scope. Whole AT-Z05L/LK, accepted outer/native persistence, physical ACK and new-head CI remain unapproved / unexecuted here.

Prior-edit scope: parent's explicit #530 comment5996702321 and coordinator #503 comment5996704425 cover only Legacy291–294 and two old finite fixture adaptations. Earlier complete board/path/patch audit is preserved in `runtime-refutation-review.md` SHA `a50d2079bb3bf0a9aff3027cdafdac214776c44f25c7d2309cb02eaac476e269`: same-file historical #421/#422/#423/#424 and disjoint own Z02#593 are disclosed; their unrelated assertions/hunks and retained source/native/ACK/admission/capture ownership are preserved. This review changes only its own new file.

## Exact differential and effect

Independently reconstructed the current source from `git show d8d2a6c1:lib/ediel/flows/inboundBusinessStateMachineLegacy.ts`, replacing exactly the nested `input.message.customer_id ? cachedCustomer/Point : endingPeriodScopes(...)` expression with `await endingPeriodScopes(companyId, sourceResult.periods)`. Reconstruction equals every current byte. No other executable slice, source/refusal branch, native RPC argument, lifecycle, period writer, idempotency guard or task creation/event behavior changed.

After a declared genuine end result, every Legacy final-work task now selects customer/point through the existing endingPeriodScopes helper: only returned ending/ended IDs, exact company filter, nonnull customer row. Cached message customer/point cannot bypass lookup; absent or foreign-only rows create no case; lookup errors propagate rather than silently using cache. Native refused/error, outbound, C/regulated/start and idempotent behavior retain their previous guards. Actual native core still determines legal end/date, supply period/history/version and authority; this app repair creates no new writer/producer or release gate.

The two existing fixture files reconstruct exactly with only (1) identity fluent `in:()=>q`, and (2) beforeEach supplyRows changed from[] to `{id:'supply',customer_id:'customer',metering_point_id:'point'}`. All original assertion bytes, test titles/tags, authentic-wire and native-RPC argument checks, result/error/hold ports and other cases remain unchanged. This fills an already declared finite table transport now visited by the repaired app; it does not implement another resolver or pretend a native SQL read occurred.

| Exact changed input | Before SHA256 | After SHA256 |
| --- | --- | --- |
| Legacy source | `1d3e51de42176234867d4e1546447c36eae44222e8d0ae04bed6e2db36f5d3be` | `8e810fd5caca5ea235207795d0fd1a7cc19b943a680faae32cc6e2a78d11aa43` |
| ediel-closure-legacy-case.test.ts | `e8c7e5ea2e4d46d68253bad5aada4d83febfafb16fd2433ff06a14e5f6404344` | `b14215a0d9a5023dd524f1f7897474019be5976242f52dd384819a4a41b910af` |
| ediel-bilateral-prodat-supply-consumer.test.ts | `8eff977a75575f5d1165c673eb646b82515774a90fc2cd498b8aafd53f34e9d4` | `f2103c81c6da36fc55c796f5ebffb4fd64b0ddde3777699fdc647a3f705f4bed` |

## Actual saved verification

Independently parsed the repaired XML to **89 unique PASS /0 FAIL /0 ERROR /0 SKIP**, six files: unchanged own40 plus49 existing closure11, bilateral4, supply-market, receipt-followup and lifecycle cases. The log agrees; repaired-result-qualification binds the exact source/test to actual exit0, also expressly confirmed by parent. All six ordinary cached-customer/point and missing/foreign contrasts now pass, including their previously unreached trailing side-effect assertions. No assertions were suppressed, inverted, deleted, expected-to-fail or skipped. Historical corrected40/34/6 and first40/24/16 artifacts remain separate and unchanged.

Parent directly confirms pinned Node22 final TypeScript session31380 exited0 and scoped four-file ESLint session14779 exited0 with no warnings. Saved logs are empty; their empty bytes alone are not used to infer success. The component tsconfig extends tsconfig.tests and selects the owned test/dependencies: this is scoped type qualification, not a new all-project compiler/native claim. This reviewer performed no reruns.

| Receipt | SHA256 |
| --- | --- |
| repaired-junit.xml | `a9bb753969107c5157f949d3177d95b7318dfc752ea8a59b65c783f691999df6` |
| repaired-run.log | `ebce443caa4f10ca98af3002b8d0b7f7e88c383cb41a3b0beb405f2eb1079b0b` |
| repaired-result-qualification.json | `d8cdc9988a14dee40610cb06b1de510d88a092a4d9f79abe84b3359527535b39` |
| typecheck-repaired.log / lint-repaired.log, each | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Independent byte comparison to d8 also confirms unchanged inboundProcessing `8ea6ffc7…`, source adapter `584e5195…`, receipt adapter `01e00f9e…`, receipt SQL `faec77f0…`, shared fakeSupabase `d6da2118…`, shared physical fixture `118a13c2…`, frozen acceptance `e9aa623c…` and coverage `011e3393d8c51bc39c3d43f7154d360b1c50a9abdf0772f762362b7e35f54294`. No ordinary/native gate, SQL role/schema/config or coverage promotion is in this repair.

## Retained limits

The frozen full literals and original-P/HB custody remain in unchanged source-facit-review SHA `0b2dc2f8c09032d40957700bfb3b00be9d251da5f4a7480f204a9caa6e76c022`. This qualifies affected-period customer/point task selection at the real app consumer with finite ports, not the whole final-value/billing/end-history contract. Missing/foreign applied states and duplicate UUID fake rows retain the reachability limits from the historical runtime review; real FKs, RLS, transactions and source ownership were not executed.

Site/switch cache use and null-period-point fallback were not injected/asserted by this six-case refutation and remain unchanged. Actual receipt-based task projection occurs earlier in the fullyApplied one-object outer path; possible Legacy/receipt duplicate-task interaction and accepted linker/refresh reachability require retained-owner proof. No nationwide LK-midnight rule, new business reply, billing readiness, grant revival, source-role/correlation authorization, numerical timer, physical ACK or native/current-main acceptance is inferred. Exact future published head must satisfy its actual ordinary CI and current-main composition gates.

Read-only checks: three-file Git diff; exact byte reconstruction from baseline Git blobs; SHA256 of reviewed inputs/receipts; complete XML testcase/name/failure/error/skip parsing; saved log/qualification/config inspection; selected protected input equality. Only this new reserved review was written; earlier RED/facit reviews remain immutable history.
