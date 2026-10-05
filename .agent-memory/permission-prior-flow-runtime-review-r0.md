# Independent completed-runtime review — prior permission flow

Candidate `03a7e651d73317230ba57810d2090e6aae1aacd2`; runtime `d9d0a93e0e24d68c8d21cb5ea1f34d21f61419f6`; full branch range `4e8b8588..03a7e651`. Reviewed the Task 2 brief and root's field-only interface clarification before implementation, then the approved source proposal, independent source review, author report, complete change inventory/diff, actual runtime and relevant callers/dependencies. Publication/CI/main acceptance remain root-owned.

| Review | Verdict |
| --- | --- |
| TASK/SPEC | REQUEST CHANGES — R-PF-1 |
| QUALITY | REQUEST CHANGES — R-PF-1 |
| TENANT | APPROVE for this bounded static ownership/query correction; no live RLS attestation |
| WHOLE-BRANCH | REQUEST CHANGES — R-PF-1 |

One confirmed medium-severity finding. No other blocking finding was established. The original cross-company raw-query defect, unchecked/substring authority and unsupported Boolean-false national40 inference are materially corrected in the reviewed manual path. Completion remains blocked by contradictory message chronology being accepted as prior evidence.

## R-PF-1 — Later message can qualify as the prior request or cancelled message

**Severity: MEDIUM. Confirmed.** Location: `lib/ediel/prodat/prodatPriorPermissionFlow.ts:74–83`, especially line76; related local scope check at44 and manual consumer `app/admin/ediel/actions.part-3.ts:397–434`.

Each source/candidate wire DTM137 is parsed and checked against its own receipt/dispatch timestamp. The candidate's receipt/dispatch is also bounded by the source's receipt. However, the assessor never compares the candidate's own message date with the source's own message date. Consequently an otherwise matching Z13 created after a Z14, or a Z15 created after its alleged cancellation, qualifies solely because both had arrived by the later source receipt. The result is sealed as `correlated`; the guard accepts it; the manual resolver records success and returns positive.

**Independent reproduction:** `/workspace/scratch/2a201d6d5897/prior-runtime-review-independent/chronology.test.ts`, configuration and JSON/log receipts in the same directory. Three focused capture/control tests were executed; all3 passed. These passes prove observed behavior, not conformance. The probe extracts the unchanged actual loader adapter/manual resolver and uses the real scoped loader, assessor, field validator and ACK builder. DB/auth/event persistence remain mocked. No application or existing test was edited.

1. Valid control: Z13 DTM137 is18Sep12:00 fixedUTC+1, sent19Sep00:01Z; Z14 DTM137 is19Sep12:00 fixedUTC+1, received20Sep00:00Z. Exact LI/parties/tenant/history yields positive as expected.
2. Contradiction: Z14 DTM137 is18Sep12:00 fixedUTC+1; Z13 DTM137 is19Sep12:00 fixedUTC+1, sent19Sep12:00Z; Z14 received20Sep00:00Z. The Z13 did not yet exist at the claimed Z14 message date. Actual result: positive, one permission event, one real ACK draft built.
3. Variant: Z15C DTM137 is18Sep12:00 fixedUTC+1; alleged prior Z15 DTM137 is19Sep12:00 fixedUTC+1 and received19Sep12:00Z; cancellation received20Sep00:00Z. Actual result: `correlated_cancellation`.

Run from repository root:

```sh
node node_modules/vitest/vitest.mjs run --config /workspace/scratch/2a201d6d5897/prior-runtime-review-independent/vitest.config.mjs --reporter=json --outputFile=<fresh-output-path>
```

For unchanged correction replay, a separate normative probe was then executed: `chronology-requirements.test.ts`, with `vitest.requirements.config.mjs` in the same scratch directory. It retains the positive control and requires internal review/no event/no draft for the two contradictions. Result: **1PASS/2RED**, command exit1, saved as `chronology-requirements-red.json` and `.log`. Original capture sources/assertions/receipts remain untouched. Run the command above with `vitest.requirements.config.mjs` and a fresh output path after correction; these requirement assertions must not be weakened.

| Preserved scratch file | SHA256 |
| --- | --- |
| chronology.test.ts | cc7b237d23ac6f4da5734567ee73d45eb8503d84071501ed26ac9c92c40d0428 |
| vitest.config.mjs | 19b1974c707daf653d27901aefe54ef917e40c7401f1e91f5476ecfe1ff6f402 |
| chronology.json | f0941c287d202368a31f52467bff758f531c5ad205027957d3fd80e48873b975 |
| chronology.log | 0c65d9b27e2f0c62e7296c5b34009c84590c24b18e60a97f925d5e5120d807af |
| chronology-requirements.test.ts | 9665578d980a40144574402d69dd71ecbde16982f4a117d2e118e566ad2cf842 |
| vitest.requirements.config.mjs | d13cb2d7b3a61db818570293cf2878060f64db0c0c952d4d6e67f2094e20f417 |
| chronology-requirements-red.json | cf63678e1a3e1e3e2e689a95b86d3e0d0e133efe3c89196050d68b3b1168205f |
| chronology-requirements-red.log | 178c55425d9643cfd90173390c0d04bb1e2699b07dc54c339e6db0e20cefe6f1 |

**Source and requirement:** original PRODAT26A-r3 P43 defines137 as the message date, format203 with minute precision; P137–138 returns the Z13 case reference in its Z14 response; P139–140 links the Z15 response to the Z18 request and Z15C to the Z15 it cancels. P14 calls for original/cancellation ordering. Approved proposal part4 expressly distinguishes insertion time from market chronology; parts2/5 require an actual prior request/cancellation relation. Independently opened these original PDF pages; SHA256 matches `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`.

**Impact/root cause:** false prior qualification can authorize the manual positive decision/event/draft for internally contradictory history. No cross-tenant read, grant mutation, production exploit or actual send is demonstrated. The comparison currently establishes arrival-before-arrival, not noncontradictory original-before-response chronology.

**Minimal correction:** inside the existing pure relation assessor, reject contradictory candidate/source own-message chronology as internal review before issuing correlated authority. Preserve national203 minute precision and equal-minute cases. Distinguish wire-message chronology from transport timestamps: do not blindly require a cancellation target's local receipt to precede cancellation generation, because delayed/reordered delivery is possible; likewise do not invent a national error or a general new timestamp policy. Retain the existing dispatch evidence requirement. Add source-shaped Z13/Z14, Z18/Z15 and priorZ15/Z15C controls for earlier, equal-minute and demonstrably later own dates, plus an actual manual pre-event/pre-draft negative. The original author owns changes; existing assertions retain their authorization boundaries.

**False-positive challenge:** the reproduction moves the *candidate's own wire message date* a full day later, not merely its receipt or resend timestamp. Minute rounding, ordinary transport delay and later receipt do not explain the contradiction. All ownership, verified temporal identity, LI and tuple checks pass. Canonical route/rule-pack persistence checks might prevent a later actual send but do not repair the already-emitted success event or positive result. Source-valid unknown subtype behavior is unrelated to this finding.

## A1–A9 and complete path assessment

| Group | Independent assessment |
| --- | --- |
| A1 ownership | Source action uses write/send RBAC and company authorization. Ownerless source cannot become correlation authority even for platform admin. Metadata reads have company/environment predicates; raw-message reads add those predicates before projection. Candidate scope is rechecked after retrieval. |
| A2 historical scope | Actual profile/identifier/role/relation/platform-identifier columns exist in checked-in schema/types. Both own-message date and receipt/dispatch constrain historical records; missing/expired/ambiguous mappings hold. Explicit own legal≠transport representation works via company relation and verified agent identity. Remote represented counterparties without an adapter remain held and are disclosed. No present-day resolver substitution. |
| A3 exact identity | Selected PRODAT UNH and own BGM1001 drive correlation, independent of cached source code. Existing tokenizer preserves UNA decoding. Own LI, physical LIN, customer composite namespace and candidate wire/scope checks replace substring/cache UUID donors. Later UNH and sibling objects do not donate values. Z14N and Z13 omit positive-only identities legitimately. |
| A4 occurrences | Every physical source object is assessed. A single request may support several response objects without consuming it. Duplicate qualifying candidate objects/messages and contradictory matching tuples hold. One matched sibling cannot qualify the whole message. |
| A5 process | Z14→Z13, Z15 response→Z18 exact tuple/mode and Z15C→same-directionZ15 are implemented. No universal Z18 requirement or historicalZ14→current-state inference. Own end-date format is retained. **R-PF-1 prevents approval of complete prior relation qualification.** |
| A6 evidence/completeness | Status+actual sent timestamp excludes draft/prepared/queued. Existing transport/outbox code supports the dispatch adapter; receipt supports same-direction incoming target. Ordered created_at/id pages are bounded50×4 per needed process, with search_incomplete on cap. Null/error/empty history stays internal. **The cross-message own-date comparison is missing.** |
| A7 fields | Accepted322/324 owner/readiness code is unchanged. Field assessment precedes prior lookup; manual internal errors retain it. Only the explicitly authorized energy false-context40 assertion changes meaning. Other existing edits adapt fixtures/interfaces, preserving field assertions. Standalone validator is field-only under root's clarification. |
| A8 consumers/binding | All three actual manual actions call the guarded resolver before permission event, draft creation/replacement or send progression. Null, TGT/submitted positives and unchecked caller objects cannot qualify. Private WeakMap plus source and serialized-evidence hashes reject replay, clone and mutable-tag promotion. Issuance is in-process assessment, not a rehydratable permission state. |
| A9 packaging | No schema, frozen source, codec, grouping, lifecycle, workflow, script, dependency, threshold or baseline changes. Full range includes root memory/source receipts as well as the bounded runtime; they are not confused with new executable behavior. Prior receipt integrity and final runtime hashes independently checked below. PR310 excluded;98/110+10 acceptance counts unchanged. |

Traced source action ownership→manual resolver→field readiness→historical metadata→scoped raw query→physical assessor→binding guard→permission event/decision→ACK builder/orchestrator/kernel. The event writer derives company from the source parent. The canonical kernel separately requires company, rule pack, route and duplicate checks. Separate lifecycle updates, direct/canonical/system field consumers and the older test-only matching helper remain outside this new history integration, as authorized. No new state/grant producer exists.

## Tenant/security matrix

| Surface | Ownership/authority result |
| --- | --- |
| Source selection | Existing company authorization; admin ownerless access supplies no historical owner. |
| Tenant configuration | company_id+environment filters on all four metadata tables; real actor role/validity evidence checked. |
| Shared actor metadata | Finite exact transport IDs, EdielId type, verification and time validity; no tenant message payloads selected here. |
| Raw candidate messages | company/environment/direction/family/process/application/verified sender-receiver pair before raw retrieval; no unscoped fallback. |
| Source/candidate relation | Company, environment, own legal/transport identities, market, exact occurrence and tuple verified; chronology defect is same-tenant semantic qualification. |
| Events/drafts | Correct source-company attribution remains; internal outcomes stop before effects, except R-PF-1 incorrectly issues success authority. |
| Privileged client/RLS | Existing service-role client retained. Application predicates are essential; policy presence does not replace them. No RLS/grant/function/view/storage/API-key change. Live policy execution was not performed. |

## Verification and integrity

Fresh reviewer commands: targeted3-test chronology probe; original-PDF hash/pages; `git diff --name-only d9d0a93e..03a7e651 -- app lib` (empty); protected schema/scripts/workflow/dependency/config range diff (empty); manifest/input/artifact/log hashes; all106 prior receipt hashes compared with actual base blobs. Results:

- 28/28 final manifest input hashes and58/58 artifact hashes match current files.
- All15 recorded final-gate log hashes match; all recorded exit codes are0. These comprise13 required gates plus diffcheck and packaged quality.
- All106 preserved prior receipts match both their ledger and base58674ab6 bytes.
- Parsed author receipts: full4787 passed/0failed, focused212 passed/0failed, quality45 passed/0failed. National40 refinement has1 passed/83 skipped,0failed; it is correctly described as one targeted pass, not84 executed.
- Final runtime has no app/lib delta after the full test runtime commit. Local author gates used Node24. Exact Node22 CI remains root's separate gate.

No optional author-suite rerun was performed. Author full/focused/script/quality/type/lint/tenant/performance receipts are evidence reviewed, not executions claimed by this reviewer. The independent probe deliberately uses only the concrete unresolved chronology risk and preserves all original receipts.

## Skills, exclusions and limitations

Applied local code-review/differential/spec-to-code/false-positive/verification guidance and quality-playbook evidence principles; mandatory Supabase security checklist and local Postgres/RLS guidance; read Gridex tenant guidance for company/actor/environment separation. Using-superpowers dispatched-agent exemption applies. Explicit single-reviewer scope overrides fan-out; no subdelegation. Skipped broad repository scanners/SARIF/dependency analysis, UI/browser/E2E, migrations, deployment and optimization: no such change or execution was authorized for this finite review. No current Supabase API implementation, CLI operation or live cloud-feature claim required external access; actual checked-in schema and callsites were the authority.

This is bounded source/runtime review, not production protocol certification. Probes mock DB, auth, event persistence and external effects; no live DB/storage/provider/market call or human message occurred. No live RLS/grant/tenant configuration, delivery, production concurrency or market eligibility was verified. Unlinked/spontaneousZ15, unavailable historical mapping and unsupported remote representation remain disclosed internal holds and are not full prompt-ACK compliance. Full F3, separate state authority and other canonical/direct/system prior-free paths remain unaccepted by this unit.

Only this review report and fresh scratch probe/evidence were created. No application, existing test, schema, source artifact, memory, CI or prior receipt was changed; no commit was made. Root should route R-PF-1 to the original author and retain independent review plus exact CI/main gates after correction.
