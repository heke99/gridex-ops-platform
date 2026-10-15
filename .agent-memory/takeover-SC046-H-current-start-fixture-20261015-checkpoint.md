# H controlled agreement: current start fixture

Owner: codex-sc046-H-expiry-fixture-source-20261015.
Branch: codex/sc046-H-current-start-fixture-source-20261015.
Source: dc8448455e5f89f21258b9234291c61a05203c9b, tree 13b3ebd61064d5081438bc9823bcad83d3214464.
Scope: scripts/ediel-at-z03h-z04h-supplier-native.test.ts and scripts/helpers/nationalRescissionNative.ts, plus this new checkpoint.
Status: SOURCE_READY / ALL3_PAUSED for two other independent source reviewers. No genuine native execution or acceptance credit.

The controlled agreement case requires its requested supply start to remain in the future. Its shared fixture currently chooses 2026-10-15, which has passed. Introduce an optional stage date while preserving that historical default for all existing callers, and let only this controlled case use the existing futureNativeSupplyDate before contract and signed agreement bytes are created.

Preserve all 100 cases and assertions, actual current-clock checks, authorization and expired-role/reviewer negatives, exact signed bytes and physical DTM92 binding, 30-minute technical watches, confirmation, effective-event activation and replay/concurrency controls. Production code, SQL, workflows, GEN outputs and coverage remain outside this source change.

Verification will use actual-source finite fixture/date controls with declared external seed, SQL and calendar ports, targeted parsing/types/lint and complete source inverses. These establish source wiring only; genuine native and mandatory final-version CI remain with the existing delivery owner. No native/backend/GEN/CI run or original collection is performed here.

Delivered: stage(requestedStartDate='2026-10-15') forwards the optional date to the unchanged deferred H seed and preserves its grants and all old callers. Only the last controlled agreement case calls prospective(futureNativeSupplyDate()). The date is chosen before the contract, signed bytes, scope and DTM92 are generated. No production or global/native clock is changed.

Verification on these exact technical postimages:
- Finite actual-source controls: OLD 8 PASS / 2 assertion FAIL, then NEW 10 PASS / 0 FAIL / 0 SKIP. The failures distinguish ignored date override and the stale controlled-case initializer. Controls also cover Stockholm midnight, DST and year rollover, the untouched real clock, the old default and seed/SQL failure propagation.
- Targeted strict transitive TypeScript check uses the repository's actual allowJs=true configuration and exits 0. Targeted ESLint with --max-warnings 0 exits 0. Both source files parse without diagnostics; git diff --check passes.
- Full byte inverses allow exactly the helper parameter/property, the existing-helper import and one case initializer change. Complete reversed ASTs match. All existing expectation-rooted AST calls and named-case order match; the runtime suite's 100 case criteria are retained. Test/helper LF budgets remain 1800/215.
- Technical SHA256: native test f4186b159eb5767d2b8b8aab99edd371cd1f5413e99b840407aaacfed0a9b617; national helper 3f9435960ad37c657c653b6e4572df71e56389b9fe7dc7713566cab399031c10.

Limits and next step: these finite source controls do not prove the signed native path, downstream confirmation/activation or whole H/SC046 acceptance. The earlier failed ordinary job remains a failure. All three owned files are paused; two other exact source reviews precede any separately authorized technical-two intake and current ordinary CI by the existing delivery owner. No automatic branch adoption or new producer is authorized here.
