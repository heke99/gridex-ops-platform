# PR334 review repair — market evidence is not process permission

Status IMPLEMENTED_NOT_VERIFIED pending new-head ordinary CI and independent review. Published predecessor1766697092dbec29f812adba6d590f9d9411513f/tree3bf6bb1e23afbdcb1033234469338d43a95daa9c was not accepted despite all four ordinary workflows passing: substantive static review5734941292 found an EL-reference classification error.

## Source-verified repair

Frozen P26.A p16 field311 lists both23-DDQ-PRODAT and23-DGI-PRODAT as EL references. The separate frozen CASE-Z06E/F/G-SUPPLIER contracts all require23-DDQ-PRODAT. The review's market-classification finding is confirmed, but treating DGI as an authorized Z06 process would widen the source contract incorrectly.

The market resolver now recognizes both exact EL references in an authoritative first UNB or a genuinely detached fragment. Gas, missing, malformed, duplicate and late UNB remain non-authoritative. Canonical process validation, source profiles, send overrides and every other runtime file are unchanged in this follow-up. New negative controls prove Z06 still rejects DGI with canonical_ediel_application_reference_not_allowed while the separate EL classification succeeds.

The original169-case matrix replaces only the erroneous DGI market-negative value with a wrong-family23-DDQ-UTILTS value. New28-case source/variant tests explicitly cover both EL references, all3subtypes/UNA alphabets, direct/canonical field guards, detached/full-message boundaries and retained process rejection. The ordinary existing subtype test glob includes the new file; no workflow change in this follow-up.

## Fresh execution

Before the repair the new28-case suite was12failed/16passed; all28pass after it. Product169 +review28 +catalog8 =205targeted cases pass. Complete application suite2791/2791 in240files, retained standalone source913/913, all3TypeScript projects, source integrity33files/121rules/231contracts, RBAC/mechanical/45quality tests and unchanged size/performance budgets pass. No source assertions or acceptance thresholds removed.

Coverage/unchanged ratchet: statements34.40%,branches27.30%,functions41.24%,lines35.79%. Local lint exits0 with100warnings:99existing source warnings plus one unused-eslint-disable warning in generated, untracked coverage/lcov-report/block-navigation.js. No source lint suppression or new source warning was added. Ordinary clean-checkout CI must still establish build/browser/replay and all applicable gates.

Tested code tree9741ef3dec4d083b24695629781d5d724ffafb24 differs from the previous published tree only in the market resolver and two tests. Final metadata adds this audit and updates active memory; the earlier qualification audit and archived history remain unchanged. JSON companion records exact blobs/source/log hashes. The original PDF is still not recovered/rehashed/visually inspected; frozen projections remain the explicit source basis.

## Acceptance and next work

The new native commit must use actual predecessor17666970, not synthetic archive ancestry. Repeat all four ordinary workflows and substantive independent review on its exact SHA. Fresh refs/checks/threads and expected-head merge only after acceptance. Seven accepted predecessors +onecandidate +102other numericD =110;10parent-group occurrences remain unaccepted. After acceptance continue the coherent Z06/Z09 E/UD parent/child unit in333.

PR310 remains paused/excluded. Issue332 full-main70/73 blockers remain open and unwaived. No SQL/grant/generatedtype/dependency/source/otherworkflow changes, liveDB/storage/market sends or explicit deployment/settings change. Existing automatic Git deployment may follow an authorized main merge. Fullmasterplan/F3-F7/liveTGT/production release remain incomplete.
