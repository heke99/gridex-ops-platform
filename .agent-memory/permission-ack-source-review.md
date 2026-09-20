# Independent permission322/324 source and architecture review

Reviewed source candidate `2a49a63c9b8b713945609a5dbc2bd68eadaadb1d`, including the original `dc0acbe9..44c7024e` source package and the explicit P-ACK-R1 residual amendment. Review date: 2026-09-20. Runtime baseline: PR352/main `1892cf48e77d2c6cea99fdbb5d7507d51919956a`. Root-owned memory/publication commits made while this review ran are outside this source verdict.

| Verdict | Result | Scope |
| --- | --- | --- |
| SOURCE/SPEC | **APPROVE** | The bounded incoming322/324 contract, including the explicit E37/Z18 adjudication below. |
| ARCHITECTURE | **APPROVE** | One pure source owner, typed projection and finite consumer integration; implementation gates below remain mandatory. |
| TASK/SPEC | **APPROVE** | Source-only qualification fulfills the plan; no runtime implementation or closure claimed. |
| QUALITY | **APPROVE** | Evidence is recoverable, actual consumers reproduce the claimed defects, fixture limitations are disclosed, and source/runtime invariants are preserved. |

No blocking finding against this source proposal. These verdicts do not authorize runtime changes, assertion changes, live processing or production permission linkage. Root retains that authorization. Counts remain98/110 numeric and10/10 parents; PR310 remains paused/excluded; full F3/masterplan remains incomplete.

## Method and skill routing

Read repository AGENTS, active task/checkpoint and relevant memory/domain architecture, task plan, full source audit, evidence manifest, task report, existing consumers and probe archives. Applied local code-review, spec-to-code-compliance, false-positive challenge and verification-before-completion guidance; PDF skill used read-only. The using-superpowers dispatched-agent exemption applies. Explicit no-subdelegation takes precedence over spec-compliance's normal fan-out; this is the independent review, not the author's self-review. Architecture judgment follows the local most-capable-model requirement. No subagents were created.

Full quality-playbook/codebase-documentation generation, broad security/database audit, UI/performance/deployment workflows and implementation/TDD are not activated by this bounded source-only review. Differential review was used to establish scope and preserved files; no security-code delta exists. Prior typed identity/applicability/text units were inspected only as existing integration interfaces and were not reopened.

## Independent source adjudication

Fresh SHA256 of the full original140-page PDF at `/workspace/scratch/2a201d6d5897/prodat-original-source/PRODAT-26A-r3.pdf` is `83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95`. Fresh layout extraction and rendered inspection of P35,75,123 confirm the substantive discrepancy rather than relying on the audit's paraphrase. Read relevant numbered definitions, requiredness, subtype, ACK and register provisions, plus frozen masterplan and AT-P-01/02, AT-ACK-01/02.

* **E37 in incoming Z18 is accepted for field324.** P75 explicitly applies the shared segment to Z15 and Z18 and lists all five codes, including E37. P123's incoming field-control row is non-gray, includes E37, and gives no Z18 exclusion. P35's rendered Z18 diagram lists only B77–B80. The detailed segment definition plus the explicit receiving-control row provide the stronger basis for incoming validation. This is a narrow adjudication of inconsistent representations, not a claim that the diagram also lists E37 or that P15 establishes blanket precedence over diagrams. P15's actual precedence sentence concerns §2.2 versus appendix4. Frozen masterplan's field324 explanation is consistent with the five-code contract. E37/Z18 requires an explicit positive implementation oracle.
* **322:** P21 requires it in Z14 and Z15; P73 makes C889/7111 its scalar and permits A74 for positive Z14, A13/A76 for Z14N, A74/A75 for Z15. Z96 belongs to223; status cannot supply subtype. P139's Z15C A74/E37 example independently defeats the legacy A75-only interpretation.
* **324:** P21 requires it in Z15/Z18; P75 assigns C889/7111 and B77/B78/B79/B80/E37. Missing required scalar is41; a supplied disallowed scalar/qualified combination is42 (P91/103).
* **Unused and unknown:** P119 prohibits negative APERAK for supplied national X/inapplicable data. P73/75 mark the qualifier/agency and free-text components unused; metadata does not replace missing7111 and unused metadata alone does not invalidate a correct scalar. Unknown own223 does not establish a positive/N status combination. A code outside the entire322 set remains independently invalid, while a union-valid322 under unknown subtype gets no invented combination rejection or blanket permission hold. Existing223/506 processing remains independent.
* **Ownership and text:** P87/90/103–105 require own message/object references and errors for each affected object, with one APERAK per PRODAT message. P114 restricts multi-register reporting to Z04/Z06/Z10. P93–94/104 support numeric322/324 identity, exact field label/decoded wrong value, own227 fallback on missing209/226, and one70-character text component. Existing typed composition is an appropriate unchanged sink.

The two exact proposed old-assertion exceptions are source-justified: `ediel-prodat-energy-product-consumers.test.ts:49–53` literal INVALID must become42/322 with exact text and warning retained; lines54–57 source-valid Z14N/A76 must lose its322 rejection, with matched synthetic context and ignored false506 preserved. This approves their rationale only; root must authorize the changes. Unknown-subtype/Z18 preservation, metadata-only missing7111→41, valid scalar with unused metadata, and the regression script's missing-field41 assertions must remain unchanged.

## Actual-code and evidence findings

The proposal's P-ACK-1 through P-ACK-5 are confirmed baseline defects, not newly introduced changes. Their medium protocol severity and stated limits are appropriate.

| Finding | Independently read code and reproduced behavior |
| --- | --- |
| P-ACK-1 | `testing/prodatPermissionEngine.ts:434–547` normalizes and validates only first line; invalid Z14 X99 becomes41, valid Z14N A76 is rejected, missing Z14 status passes. `decisionEngine.ts:222–258` and `ruleProfileSelector.ts:194–225` have separate narrowed/status-derived logic. Reviewer actual manual→real ACK builder produced41 for X99 while canonical accepted. |
| P-ACK-2 | Z18 helper returns handled-positive; direct only checks324 presence; generic canonical fields lack code validation. Fresh canonical/manual E37 control accepted, and actual system replay accepted X99/324. Persisted inbound replay confirms the invalid-code approval survives response-plan persistence/reload and draft construction. |
| P-ACK-3 | Second independent Z15 object's X99/324 is missed by manual/direct/canonical. Fresh three-alphabet tests prove tokenizer preserves `X:+?'` while manual and rendered A905 contain only X. Overlong324 writes warning first and then preflight rejects84-character text, with no mocked kernel persistence. Distinct M/M2, D/D2 UNH replay retains manual first-message41 but confirms direct donor leakage. |
| P-ACK-4 | `aperakErrorRuleRegistry.ts:967–980,1084+,1508+` creates permission issues from selected testData, bypasses generic inspection, inserts issue before selecting rule, then detail before return. Reviewer scenario against valid wire wrote two records and returned invented41/324. Additional actual-registry test supplied a synthetic DB rule and obtained42/324 with `CUSTOM Z99`, proving DB override authority. |
| P-ACK-5 | `rulebook/canonicalPolicyFieldValidator.ts:51–102` leaves322/324 in generic incoming matrix ownership. Correct Z13 plus unused322/324 causes canonical rejection while manual stays positive. Actual inbound replay preserves the negative result through response selection. |

`actions.part-3.ts:449–505` performs506 guard, TGT resolution, prior lookup, permission validation, then event/return before registry. The proposed placement before event/positive result is therefore necessary; changing registry alone cannot fix manual handling. The caller at596–613 can fall back to submitted errors when backend errors are null, which remains an explicit integration preservation case.

`system-tests/actions.part-2.ts:409–494` uses registry errors before classification/permission-positive fallback. It must receive the same qualified field errors and stop on unready/internal selected-field disposition before that fallback. `core/runtimeDecision.ts:144+` already accepts typed issues; `flows/inboundProcessing.ts:261+,317+,489–510` persists/reloads plans and restricts internal-review delivery to qualified errors. No replacement ACK architecture is needed.

## Architecture approval and implementation gates

The owner must accept actual UNA and selected-message raw segments, return physical-object assessments and typed issues/disposition, and avoid DB/testData/history dependencies. Unique own BGM selects function; own223 selects applicable Z14 combination. Cached code may only be an explicitly headerless fallback, never authority over complete wire. Every independent LIN is assessed; later UNH/header/later CAV cannot donate a value or reference. Existing `prodatRegisterMessageSegments` and physical group indexes support this without broad parser changes.

Canonical integration must exclude exactly incoming322/324 from competing generic validation and add the shared owner; outgoing/source matrices stay untouched. Manual, direct, registry and system routes must preserve the same typed projection, including references/evidence. This is a coherent two-field migration through existing interfaces.

Required implementation-review checks, not additional scope:

1. Readiness precedes permission qualification events and registry issue/detail writes. Internal identity/text failure must prevent success and keep independently ready national errors/local evidence. Do not truncate values or erase a known error to make text fit.
2. Only the322/324 scenario/rule mapping paths lose national authority. Configurable rules, selected-positive labels and cached metadata cannot override these wire diagnostics; unrelated registry mappings stay intact.
3. Preserve physical occurrence identity in registry persistence. `insertValidationIssue` at1330+ upserts by message/rule/field-path/coalesced object/coalesced LI, **not sourceOrder**. Merely storing sourceOrder cannot distinguish two physical occurrences with equal business references. Use the existing field-path/identity representation to keep owning occurrences distinct, or explicitly preserve them in typed evidence; test the actual write payloads and returned errors. No schema change is needed or authorized. This is a concrete implementation guard, not evidence that the unimplemented proposal has already lost occurrences.
4. Ambiguous duplicate pair/header placement must not silently pick a value or manufacture national42. Qualify what can be qualified, retain ordered evidence, and use internal disposition for unqualified identity/structure. Unknown223 alone remains distinct from that internal error.
5. Use real consumers for complete controls and one-variable failures, including E37/Z18, Z15C, both bad LINs, missing ownLI/227 fallback, three alphabets, subsequent distinct UNH, registry overrides and persisted response reload. Assert selected322/324 results separately from acknowledged unrelated negatives.

## Residual separation and false-positive limits

**P-ACK-R1 remains HIGH and open.** Independently read `actions.part-3.ts:214–293`: prior candidates have no company/party/direction filter, use cached code and first-line/cached identifiers, and substring-match an entire candidate payload. Fresh boundary replay produced positive from a synthetic other-company unrelated substring candidate; empty candidates produced40/105; unavailable lookup produced no event/draft; cached Z04 bypassed lookup. Caller authorization of the current source message does not scope this separate candidate query. No live exposure, state grant or market send is proven.322/324 validation can be separated because wire field truth requires none of this context, but this migration must neither accept nor expand that lookup's authority. It blocks safe production permission-linkage claims until a separate bounded correction is qualified and verified.

Generic209 checks in `prodat/prodatBusinessRules.ts:12–14` reject source-valid Z13/Z14N, and lines16–17 require261 for Z18. Registry object-identification likewise affects Z14N. These remain excluded and visible. Reviewer E37/Z18 control's direct result is a negative41 with **null fieldCode** and agreement-reference text; this is not a324 failure. Do not insert source-forbidden fields into controls or remove unrelated negatives merely to report green workflows. Selected field correctness is independently testable; full F3/workflow acceptance is not granted.

## Fresh verification and limitations

All reviewer execution used synthetic fixtures and mocked DB/provider/kernel boundaries. Actual consumer function bodies were AST-extracted unchanged where application imports require that harness; permission, direct, registry, canonical, projection and renderer modules are real. No live calls or mutations occurred. Reviewer probes are in unique scratch directory `/workspace/scratch/2a201d6d5897/permission-independent-review-20260920`; no archived writer ran against original destinations.

| Check | Fresh result |
| --- | --- |
| Original PDF SHA256 | Exact expected hash. |
| Immutable artifact hashes |22/22 match. |
| Input implementation/source hashes |32/32 match. |
| `node scripts/check-ediel-masterplan-v2.cjs` | PASS:33 original files,121 rules,231 contracts; no application conformance claim. |
| Runtime/source/test delta from accepted main to candidate | No changes in `lib`, `app`, `__tests__`, `scripts`, frozen masterplan. Source delta adds only24 audit/evidence/archive files. |
| Reviewer independent actual-consumer assertions (`vitest-v2.config.mjs`) |3/3 PASS,9 observations. |
| Reviewer DB override and three-alphabet punctuation assertions (`vitest-override.config.mjs`) |1/1 PASS,4 observations. |
| Safely relocated boundary/inbound archive replay (`vitest-replay.config.mjs`) |27/27 capture tests PASS;8 system rows,4 prior-context rows,6 boundary observations and13 persisted inbound records inspected. Capture PASS does not mean source conformance. |
| Source diff whitespace | Exactly six immutable log blank-at-EOF warnings, as disclosed; not rewritten. |

Reviewer v1 had2/3 PASS because its assertion incorrectly expected the unrelated Z18 agreement error to have fieldCode261. Actual code maps that generic error to null. Original reviewer v1 probe/result/log are retained; v2 corrects only that reviewer expectation and adds the previously unreached unknown-subtype preservation observation. This was a reviewer assertion defect, not a source-author or runtime regression.

The author's20 literal conformance oracles remain7PASS/13RED historical evidence and were read rather than relabeled green. Original fixture-error disclosures are accurate: first missing group.columns, non-normative metadata42 flags, reused initial UNH/BGM IDs, and the misnamed missing322 boundary row are not used as contrary normative authority. Full project tests/CI were not rerun for a source-only review. Root's accepted PR352 main73+OPS receipts are attributed to root, not this review.

Recommended next action: root may authorize the bounded implementation and exactly the two source-justified old-assertion changes, while retaining every residual and implementation gate above. Subsequent runtime approval requires independent review of actual code and actual-consumer evidence.
