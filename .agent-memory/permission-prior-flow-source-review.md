# Independent prior permission-flow source review

Candidate: `0fd41d86a32f0051785e01c4f1d010f18e2d4686`. Review range: `7ea935cf..0fd41d86`; runtime remains the accepted PR353 base `4e8b8588f9a6ff805ba433e542615ba6dd66fb98`. Reviewed task brief first, author report, complete change inventory/diff, source audit, archived probes and authoritative qualified-final receipts. This is approval of the finite source proposal, not implementation approval, runtime authorization, production conformance or permission-state acceptance.

| Review | Verdict |
| --- | --- |
| SOURCE/SPEC | APPROVE |
| ARCHITECTURE | APPROVE |
| TENANT | APPROVE |
| TASK/SPEC | APPROVE |
| QUALITY | APPROVE |

No blocking defect found in the actual bounded proposal. P-ACK-R1 remains HIGH/open in unchanged runtime. Root alone decides runtime authorization and the exact assertion exception below. PR310 remains paused/excluded; accepted PR352/353 work is not restarted. Main73/73/allOPS acceptance is root evidence, not a run performed by this reviewer.

## Review method and skill routing

Read AGENTS, memory README/current state/task/checkpoint/handover/blockers/active plan and relevant prior independent permission review; searched decisions/known failures. Applied code-review, source/spec comparison, false-positive challenge, verification-before-completion, mandatory Supabase security guidance and local Postgres/RLS guidance. Using-superpowers has a dispatched-agent exemption. Explicit one-reviewer/no-subdelegation instructions supersede skill fan-out. Supabase review is static against actual checked-in schema, service-role construction and query/ownership code; no platform API implementation, CLI operation, live DB query or current cloud-feature claim requires external access.

Skipped repository-wide scanners/supply-chain/SARIF, UI/browser/performance optimization, implementation/TDD, worktree/deployment and schema-authoring workflows: no such change is in this finite source-only task. No new production, test, schema, frozen source, memory or CI changes. Review artifacts use fresh task-specific paths. Existing probe receipts were read and hash-checked, not rerun or overwritten. No optional author-test replay or new behavioral probe was necessary: the remaining questions were resolved by original-source reading and direct source-to-consumer tracing.

Independently opened the original 140-page PDF at `/workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf`; verified SHA256 `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`. Read the original function/direction, field/reference and APERAK process sections (P13–17,22,73,75,78–79,85–87,90–93,137–140); independently rendered and inspected P33–35 diagrams. Read frozen CASE-Z15V/VH/C, ST-E07/08/10 and AT-P-01/02, AT-ACK-01/02. Derived audit text was not the sole source authority.

## Source/spec assessment

The proposed relation is supported and its authority is correctly limited:

- P13–14 distinguishes ESCO→DSO Z13/Z18 and DSO→ESCO Z14/Z15, own BGM function and own CCI/CAV subtype. Dispatch from cached code cannot override selected wire function. Existing selected-message/physical-object helpers provide the required boundary without a general parser redesign.
- P137–138 explicitly returns Z13 LI in Z14/Z14N. Z13 and Z14N omit object209; N also omits permission325/customer227. Matching N by its own exact case reference is sound; requiring positive-only fields would be a regression. Positive Z14 may return multiple objects for one request. The proposal expressly permits that and requires every physical response object to retain its identity.
- P139–140 supports Z15 response correlation with the same Z18 LI, permission/object/customer/grid and relevant end timestamp. P139's cancellation points to the cancelled Z15's LI and end timestamp with the same DSO→ESCO parties. A universal reverse-direction Z18 requirement would be incorrect. The proposal distinguishes these branches.
- P13/P34/P73/P75 and frozen V/VH/C processes do not make every Z15 a response to a local request. Old Z13 or positive Z14 observation is not proof of a currently valid scoped permission. The explicit `state_authority_unavailable` hold for otherwise unqualified unsolicited Z15 is an honest processing limitation; no state producer is invented or accepted.
- P78–79 separates LI, Z09, ANJ and namespace-qualified customer identity. Substring matching, case/punctuation folding, cached UUIDs, a sibling LIN or later UNH cannot replace an exact own reference. The proposed qualifier/agency-aware tuple respects those distinctions.
- P91–93 defines105 as inability to identify the object with its grid and prescribes Swedish text. Empty, unavailable or truncated local history does not establish that predicate. Removing only the unqualified Boolean-false inference is justified. Independently qualified national40 remains unaffected.

Internal review is not a new national response. P85–87 still requires per-object ACK treatment and prompt responses, including the 30-minute requirement; the proposal does not claim a holding queue is protocol compliance or full F3 completion. A mixed message cannot be declared wholly successful from one correlated LIN. Retaining independently ready322/324 diagnostics while stopping the unsafe manual event/draft is acceptable bounded remediation. This must remain an explicitly disclosed limitation at runtime acceptance.

## Architecture and tenant assessment

Read actual `actions.part-3.ts:212–293,449–509`, all three manual callsites at604/743/979, `actions.part-1.ts:1014–1036`, `prodatPermissionEngine.ts:429–458`, the separate candidate helper, parser/reference/party/selected-field owners, `orchestrator.ts:96–141`, ACK kernel, event writer, tenant identity/execution-context/resolver code and separate Z15 lifecycle.

| Boundary | Independent conclusion |
| --- | --- |
| Source access | Existing action RBAC and company authorization are real. They authorize the source only; platform-admin access to an ownerless source supplies no correlation owner. |
| Candidate query | Uses the service-role client. Actual filters are PRODAT, cached code shortlist, status exclusions, insertion cutoff and optional environment, then50 rows. It omits company/direction/party/market and projects away scope columns. RLS policy presence cannot repair this privileged read. |
| Schema | Actual `ediel_messages` has nullable company FK, environment, direction, family/code, application_reference, sender/receiver, raw payload, timestamps and snapshots. There is no generic tenant_id or message market column. Internal customer/object UUID links are not wire identities. |
| Tenant versus actor | Canonical identity code explicitly separates legal actor from transport agent and requires representation evidence. Company ownership, NAD legal counterparties, UNB transport parties, environment and electricity market must agree under validated scope. A logged-in user, mailbox or shared transport ID cannot select the tenant. |
| Historical provenance | The existing identity resolver evaluates activeAtNow. Stored JSON and present-day identity alone are not historical authority. The proposal correctly holds missing/contradictory historical scope instead of quietly substituting today’s mapping. |
| Query correction | Scope at the database before raw retrieval, then independently verify selected wire and returned scope. Cache columns may narrow; they may not certify function/reference/party truth. Finite paging with explicit incomplete status is coherent without a schema change. |
| Typed relation | Source payload hash, company/environment, selected UNH/LIN, own tuple, candidate occurrence and verified provenance bind the result. Missing/mismatched evidence must fail before the event; replacing the Boolean with an unchecked tag would not satisfy this design. |
| Side effects | The event writer attributes events to the authorized source company; unsafe candidate influence occurs before the ACK kernel. Kernel company/rule/route protections limit demonstrated send impact but do not repair the prior success decision/event. |
| State | Z15 lifecycle uses company-scoped metering_permissions independently; it does not consume this Boolean. Table existence and message links do not prove a qualified current-state authority. Leave that lifecycle unchanged in this unit. |

The small scoped-loader/pure-per-occurrence-assessor composition belongs in the existing manual resolution path. Independent selected322/324 assessment stays in its accepted owner. Non-consuming Z13/Z18 behavior, other direct/canonical/system paths and separate test-only matching helper are accurately identified. Wiring the legacy “safer” helper into runtime would retain unqualified normalization/reference pooling and is correctly rejected.

Implementation-review obligations are already in proposal A1–A9, not additional source blockers: enforce finite verified transport pairs and historical relation evidence; test represented legal≠transport positive and unavailable-relation controls; validate actual dispatch provenance against repository send/status code; bind/revalidate typed evidence rather than accepting a caller-authored success structure; preserve exact source-function selection and all physical occurrences; stop all three manual entrypoints before permission event/draft on internal results. If a trustworthy state or historical mapping producer is unavailable, hold internally—do not expand this unit to invent one.

## Findings verification and false-positive challenge

These are verified existing-runtime findings, not new defects introduced by this source-only commit.

| Finding | Severity / sources | Reproduction/proof and minimal correction |
| --- | --- | --- |
| PF-1 / P-ACK-R1 | HIGH; actions.part-3 query and manual event path; service.ts; source access and schema/RLS boundaries | Qualified wrong-company row survives actual extracted filters and changes manual positive/event/draft-boundary result. Direct source trace confirms no intervening scope check. Add required company/environment/process/party/market DB predicates before raw read, then verify candidate scope/wire. |
| PF-2 | MEDIUM; same resolver; parser/selected-field boundary; P78,137–140 | Isolated N controls remove the shared-customer confound: prefix/FTX/case/cache donors approve; exact released LI fails; cached sourceZ04 skips query; first LIN controls the message; distinct duplicate candidates choose first. Replace raw inclusion/Boolean with exact selected-own, typed per-occurrence correlation and ambiguity/internal handling. |
| PF-3 | MEDIUM; resolver priorCodes/cap and engine false-context branch; P91–93,139 | Empty/null/capped history becomes40/105; Z15C priorZ15 is excluded. Query exception already stops with attached fields. Remove only unsupported national inference; add finite process selection and distinguish unavailable/incomplete/unmatched/state-unavailable. |

False-positive limits upheld: existing environment/code/status filters do work; the report does not claim their absence. Missing cached source parties can block the later draft after the success event. Error paths already stop. Synthetic kernel calls are not stored or delivered messages. Five canonical controls establish payload acceptance, not tenant representation or a grant. No production data exposure, arbitrary attacker injection, cross-tenant grant mutation or live exploit was proven; HIGH rather than a new critical exploitation claim is appropriate. No new blocking or nonblocking proposal finding is needed.

## Exact assertion-exception opinion

Recommend root authorize exactly the semantic change in `__tests__/ediel-prodat-energy-product-consumers.test.ts:46–49`, `valid506 preserves independent unmatched-context40/105 and warning event`. Its `{hasMatchingPriorPermissionFlow:false, matchReason:'synthetic unmatched context'}` proves no national object-identification failure. It should require internal review, no permission event and no draft progression, with independent field evidence retained. This is not a blanket40/105 waiver and does not authorize dropping unrelated national-error tests.

Boolean-true fixture adapters in permission-ack-consumers, energy-product-consumers and permission-ack tests may construct explicit source-bound synthetic correlated evidence to preserve existing outcomes. Those are interface adaptations, not semantic exceptions. Keep positive controls, unknown-subtype field behavior, Z18, source-valid N, ready322/324, selected-field policies and unavailable-history diagnostics. No frozen contract or schema exception is justified. Root must adjudicate; this review changes no existing test.

## Quality and fresh integrity evidence

Fresh independent check recorded at `.superpowers/sdd/permission-prior-flow-plan/source-review-integrity.json`:

- 19/19 artifact hashes,38/38 inspected-input hashes and33/33 preserved prior-receipt hashes match; no mismatch.
- Extracted prior/manual/orchestrator source hashes match actual unchanged files.
- Protected `app/lib/supabase/__tests__/docs/scripts/.github` delta from7ea935cf to candidate is empty.
- Qualified-final JSON independently counted69 tests,54 passed,15 deliberate failed assertions and55 observations. Those are author execution receipts, not freshly rerun reviewer tests. The report correctly distinguishes capture PASS from conformance.
- Original final and qualified-final bytes are separately preserved. UNB party/test-flag correction and earlier plain-error/cached-sender/FTX fixture defects are disclosed. The authoritative qualification receipt is unambiguous.

Reviewed the complete range's root-owned memory/paused-evidence changes separately from the20-file source-author commit; none is mistaken for runtime changes or reviewer execution. Raw source evidence, filters/projections, selected complete controls and limits are recoverable. No optional test expansion was required after the concrete source and provenance questions were resolved.

Root may now authorize the bounded implementation and the single specified semantic assertion exception. Implementation remains subject to A1–A9, independent runtime source/spec/architecture/tenant review and root-owned exact gates/publication. No historical acceptance count changes, full F3 claim or PR310 work follows from this source approval.
