# PR356 — independent completed-runtime review package

## Immutable review range and roles

Repository `heke99/gridex-ops-platform`; branch `codex/ediel-gas-identity-20260920`; draft PR356. Whole-branch base `561c53ad9ba413eeb4f37ab1b029b1a5ba26d320`; implementation/evidence candidate `ac53b020e430a2ffa87c09579180355055793393`, tree `1b8d93e9ecb05ce0cbd965ec6294057dccbec6b7`. At opening this was3commits/66changedfiles,0behind. Review the complete base-to-final-head PR, not HEAD~1. The continuation commit adds/archives only agent-memory documentation; verify that actual diff before relying on unchanged runtime.

The implementer was gas_identity_runtime in a prior session. This continuation coordinates publication and CI and does NOT supply its own independent approval. No native isolated SDD executor is exposed here. A separate existing CodeRabbit review may help fulfill the gate; its actual inspected scope, evidence and limitations must be recorded. No generic bot success, author self-review or prior source approval is automatically four runtime verdicts.

## Requirements first

Read `.agent-memory/gas-identity-task-brief.md` and `.agent-memory/gas-identity-review-brief.md` first. Then `.agent-memory/remaining-d-source-review.md`, `quality/audits/ediel-masterplan-v2/remaining-d-plan.md` Task3, `f3-remaining-d-qualification-20260920.md`, `f3-gas-identity-runtime-20260920.md`, and `gas-identity-runtime-20260920/task-3-report.md` under the same audit directory. Source/design was already independently qualified, not completed-runtime approval. Original source PDF hash83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95 and pages21/65/77/108–110/119/123 are referenced there; disclose inability to inspect originals instead of claiming it happened.

## Changed implementation and durable tests

- `lib/ediel/prodat/prodatGasReportingIdentity.ts` — new strict pure selector/copy/value owner; ac53 blob1f50e3e0574d853d459f80fcf3b0f4eca2ad817b.
- `lib/ediel/rulebook/prodatGasApplicabilityPolicy.ts` — existing R/O/U/X scope/condition/wire owner consumes supplied outgoing240 identity; ac53 blobada58ef86bc2f8ed05933ab686a971197e7f5fb9.
- `lib/ediel/prodat/prodatDependentConditionEngine.ts` — typed fact addition.
- `lib/ediel/prodat/prodatRegisterEvidence.ts` — copy/clear and non-null serialized new identity rejection.
- `__tests__/ediel-prodat-gas-identity.test.ts`, `__tests__/ediel-prodat-gas-identity-consumers.test.ts`, `__tests__/fixtures/prodat-gas-identity.ts` —54new controls; inspect actual consumer imports/mocks, not test names alone.
- `__tests__/ediel-prodat-gas-policy.test.ts` — only authorized independent TIM SERIES fixture facts; old assertions unchanged.

Inspect real canonical field validation, actual profile builder behavior, row/registry/preflight/send guards and SMTP boundary. No production SQL/tenant lookup is added; test sentinels are not live transport proof. Review the full PR inventory for unexpected source/schema/workflow/threshold changes, archive corruption or test discovery effects.

## Mandatory finite invariants

P77 actualTIMreportingseries versus SCHowninstallation. Explicit unknown/TIM/SCH; exact source/evidence revisions, own installation+agency/process+reason/LI and causal object/event key/revision where applicable. Reject malformed/duplicate/stale/cross-object input. Never infer from wire240, meter number, product/resolution, rootmarket, internalUUID or arbitraryJSON. Independently proven TIMmay equal installation.

Keep causal condition separate: Rmissing remains missing; suppliedR/O checks authoritative expected value; omittedO needs no artificial fact; Xprecedes lookup; Ublocks outgoing. SpecificZ06E optionality unchanged. Incominggray240 must gain no new rejection. Copy/clear must prevent stale reuse and serialization must not promote caller facts to persistedauthority.

Existing renderer has no240projection. Approved consumer evidence is actual Rmissing/Oomission/EL behavior plus genuine canonical suppliedTIM/SCH checks, NOT fabricated positive builder proof. No new producer/schema/marketcolumn/sourcepromotion/GASguide/roleactivation. Existing sends remain held before provider effects. Do not broaden the task into creating that missing capability.

## Verification discipline and required output

Inspect immutable `gas-identity-runtime-20260920/final-gates-01.json`, gate-source-manifest-01.json, gate-integrity-01.json and saved RED/GREEN/full/focused outputs. Saved author runtime153b7d5a and localcommitIDs can differ from published GitHubcommitIDs; compare actual blob hashes/tree, not labels. Author records15pass/4968full/117focused/45quality/818Ediel on Node24.19.0. That is not exactNode22CI; inspect CI separately. Preserve all original setup failures/RED receipts, not only successful history.

Do not automatically rerun broad old suites. A concrete suspected counterexample needs a narrow proof and opposing control, immutable unique output and explicit execution environment. Do not edit source/tests/thresholds/old audit receipts to obtain a green review. State severity, exact file/line, reproduction, impact, cause and bounded remedy for confirmed findings; distinguish false positives and unverified suspicions.

Return separate TASK/SPEC, QUALITY, TENANT-BOUNDARY and WHOLE-BRANCH verdicts with coverage/limitations and the exact reviewed head. Missing original-source or execution access must be explicit. No full-cell/count/masterplan/live claim; no review bypass. Root handles genuine findings and fresh exactCI.

## Release and accounting boundary

PR310 stays OPEN/DRAFT/PAUSED at e961135199f292b8210884f07de3b616a670161a. No liveDB/provider/market send/deploy/role changes or human messages. PR356 stays draft until required approvals and all applicable exact-headCI; guarded merge then fresh actual-main73/73+OPS before bounded acceptance. Counters98/110+10 remain; twelve-cell AT-P-01/02/03 protocol/persisted/live adjudication follows separately.

## Skill routing for this continuation

Read AGENTS and installed SDD workflow; apply executing-plans/differential review/spec-to-code/code-review/verification-before-completion to the existing finite task and evidence. Request separate review; do not call coordinator inspection independent SDD approval. TDD/systematic-debugging/fp-check activate only for a material suspected finding. Database/schema/Supabase, Next/React/UI, performance optimization, dependency/supply-chain changes and full-repository auditing are absent; do not execute those unrelated workflows or alter infrastructure. No local clone/test success is claimed: the container clone failed DNS, whereas connected GitHub read/write succeeds.
