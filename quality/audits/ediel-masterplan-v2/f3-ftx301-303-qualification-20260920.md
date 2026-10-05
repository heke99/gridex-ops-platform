# F3C-02: FTX301/303 source, consumer trace and bounded oracle

Date: 2026-09-20. Parent checkpoint: 51ab3dbf40d4d6e0c8ffb85757f56541dc69ea64. Accepted runtime: main352fd8ee9129697b55c1d3796fb99ed04ca0d6f5. Status: ORIGINAL_SOURCE_QUALIFIED; DESIGN_AND_ORACLE_REVIEW_PENDING; no new runtime change or confirmed executed defect.

## Skill routing and isolation

Activated: executing-plans / writing-plans for the existing finite F3C-02 step; spec-to-code-compliance and differential/code review for source-to-consumer mapping; fp-check for distinguishing static leads from observed defects; requesting-code-review and verification-before-completion. Conditional: systematic-debugging, test-driven-development and generated boundary tests after oracle approval; finishing-a-development-branch only after ordinary exact-head CI and independent review. Broad repository acquisition, database/RLS migrations, UI, performance and supply-chain work are not triggered by this two-field qualification. No parallel mutation agent, hook install or provider access.

The local source archive is the prior PR358 source artifact10612997870, ZIP SHA2564250a1ab155721650a59a132bac7a285fb1a2fc390fce586dc4a1fd1efecc0b6 and TAR SHA256dd370af0c493a4c7a2eae6f16b0134372a45ea8aa2d3fffeb1aa2bf09c069bd6, both freshly recomputed. It contains treebdbd28bc52fb282bddf1c56d6bf8845acb88d7ad (87f53 source). It is NOT the current documentation checkpoint. The subsequent92d31ff change is test-wrapper-only and51ab is memory/inventory-only; the inspected runtime files are unchanged. No current-head execution is claimed from that archive. A new exact source artifact/tree must bind any later execution evidence. Git metadata and node_modules are absent locally. Native real-module tests, not a fake Vitest runner, are the planned isolated local route; ordinary CI remains mandatory.

## Original-source identity and inspection provenance

Authority P: PRODAT26.A / APERAK16.B revision3, document dated2026-06-30,140pages. Existing frozen manifest digest83c2f1d2915851d2e670731f6ab404ef06c9b9def282afbafdfa0eda836a6e95 and public document https://www.ediel.se/Portal/Document/3338.

Root inspected original uploaded page images44 and53 and subsequently16/18/121 through File Library, plus extracted original119 and115/116 context. This is not a root byte download: local DNS and web PDF access failed. Independent CodeRabbit source review5752810321 (request5752799242 in PR358) fetched the original URL, reports3,083,488bytes/140pages and a freshly computed matching SHA256, inspected15-18/44/53/114-122, and returned source PASS. Byte verification is explicitly attributed to that review. No frozen source was edited. The initial request called the multi-register overlay Appendix1; the verified source places it in Appendix2, as recorded below.

## Source decisions

S1. P p16/44:301 is optional for all13 base functions; headerFTX with4451=AAI, C108 required when the segment exists, first4440 mandatory and four more optional, each an..70. P p18/53:303 is optional forZ01,Z02,Z03,Z04,Z05,Z06,Z08,Z10 and unused forZ09,Z13,Z14,Z15,Z18; own SG8FTX with4451=ACB and the same five literal components.4453,C107 and3453 are X in the segment tables.

S2. The recommendation against routine free text is NOT a prohibition. Omission of301/303 is valid. Do not invent a required field or force an optional text producer/UI into currently text-free outbound builders.

S3. P p15 gives chapter2.2 precedence over conflicting Appendix4 conditions and applies the base table to the first register. Appendix2 p114-116 permits multi-register grouping forZ04/Z06/Z10. For later registers, the listed local values apply; other common data is taken from the first register and later common duplicates are ignored by the recipient.303 is not added to the mandatory later-register list. Preserve original raw data; never borrow common text from another object, agency or message.

S4. P Appendix4 p119: gray fields need not be checked; extra X or false-D information must not cause negative APERAK even if inspected content is incorrect.301/303 rows atp120/121 have no field-specific condition;303 is visibly gray in root's originalp121 image. No new301/303 national error mapping is established. Separate outbound construction conformance from incoming business validation and from full UNSM/CONTRL grammar. Existing syntax/envelope checks and unrelated required-field errors remain enabled.

## Actual consumer trace and falsified assumptions

T1. prodat26AFieldMatrix.ts owns the74 numeric identities and13-code base vectors.301 is header,303 defaults to first-register scope. Both descriptors currently say segmentPathFTX. Frozen prodat_fields.json gives AAI/ACB/C108 locators. Identity/base usage equality is already accepted as inventory only.

T2. fieldMatrix.ts fieldRulePresent/validateFieldMatrixPayload call prodatRegisterRuleScopes. prodatRegisterGroups.ts actually bounds303 to each first/standalone/invalid-chain LIN scope inside the first selected PRODAT message. Therefore a claim that all303 callers inherently mix objects is FALSE. Header scope returns null from this helper;301 falls back to the incoming raw list. fieldRulePresentInScope has no FTX owner; pathPresence only checks the tag. Optional FTX does not enter the specialized document/date/party value checks. These are static qualification leads, not behavioral RED.

T3. canonicalEdielPolicy.ts resolves source-controlled family/guide/direction/subtype and projects canonicalProdat26AFieldRules. canonicalPolicyFieldValidator.ts sends301/303 through baseRules and validateFieldMatrixPayload; it has no FTX-specific incoming exception. Its parse mode disables legacy dependent requirements, not forbidden-field checks. validator.ts canonicalValidation invokes this owner after policy resolution; sourceBoundProdatInput uses the actual wire and rejects ambiguous outbound message scope. The registry variant invokes the same canonical validation before rule-pack evidence I/O. fieldRuleRegistry.ts does not make mutable DB values authoritative over PRODAT source rules.

T4. core/runtimeDecision.ts also invokes validateCanonicalPolicyFields and projectProdatDiagnostics. The latter only emits national errors from valid typed source diagnostics; unqualified failures become internal_review. flows/inboundProcessing.ts uses that retained response plan, and internal-review delivery filters through isQualifiedProdatApplicationError before buildAperakDraft. The finite oracle must exercise actual runtime decision and actual P-APERAK draft, not infer an external response from a helper issue.

T5. core/messageBuilder/payloadPreflight.ts reparses actual wire and invokes the same rulebook validator. Its PRODAT segment profile in segmentSchema.ts contains no dedicated FTX component limit. validateProdat.ts checks envelope, register/date/party and required tags but has no FTX-specific validator. Full grammar is not proved by any of those omissions. Any outbound gap must be witnessed at a real preflight/send boundary including normal and metadata-error/intentional-invalid paths; do not rely on only a new helper test.

T6. prodat/parser.ts has no named free-text output but DOES preserve rawPayload and each line's original rawSegments. Absence of an optional named property is NOT established data loss. render/registers.ts preserves suppliedFTX ordering on the first register and does not duplicate common data to later registers. profileRenderer/buildProdat have no optional free-text input producer; omission is valid underS2. Test actual preservation/round-trip behavior rather than invent a product feature.

T7. prodatOwnedFailure.ts chooses allFTX tokens in its input for either field; prodatFieldDiagnostic.ts first restricts that input to the actual header or exact own object/register. Thus generic evidence code alone does NOT prove cross-tenant/cross-object leakage. Keep typed-source/error qualification strict. If a new outbound formatting guard is needed, use a local non-national diagnostic rather than manufacturing ERC42/301 or42/303 solely from an internal parser error.

## Proposed independent oracle (review before execution/remediation)

O1. Literal source controls: qualified AAI before firstLIN is301 only; qualified ACB in its own firstLIN is303 only; neither wrong qualifier nor another object/message supplies a missing field. Include absence, empty leading component, optional component gaps,5vs6 components,70vs71 decoded characters and released component/element/release/terminator characters. Wrongly placed and unknown-qualifier FTX must not masquerade as either field.

O2. Actual parsing/register rendering: two independent objects, valid same-object register1/2, reversed/invalid chain, identical text or distinct sentinel text, different agency and extraUNH. Original rawPayload and rawSegments remain byte-identical. Shared semantic data may come only from the same valid object's first register. Existing text-free builders remain valid. No new mandatory text or fabricated default values.

O3. Actual incoming canonical and registry-bound decision path: extra303 in a function where it is unused must not alone manufacture negative APERAK or internal review;301/303 content must not gain invented Appendix4 checks. Verify real responsePlan/buildAperakDraft, retained source identity and independent required-field opposing control. Existing envelope/syntax failures still fail in their current owner. Malformed/ambiguous message ownership is not accepted by filtering arbitrary errors.

O4. Actual outbound paths: a correctly scoped supplied optional text remains usable, whereas malformed/unknown/misplaced text or a locally forbidden303 is blocked without transport/DB/provider effects. Keep local send-conformance separate from incoming source error selection. Exercise stale/missing metadata and intentional-invalid labels so a new guard cannot be bypassed. Apply new constraints only after a real witness shows the existing owner lacks them and independent review confirms this scope.

O5. Real modules only: native node --experimental-vm-modules --test, TypeScript stripping without changing production source semantics; synthetic boundaries only at external DB/provider calls, which fail on any attempted effect. No production-owner mocks, no fake Vitest success, no setup/import failures counted asRED. Preserve meaningful before/after results and exact source identity. Ordinary Vitest wrapper must require positive test count, all executed tests passed, zero fail/skip/cancel/todo.

## Conditional implementation boundary

No runtime fix is authorized by this document alone. Following source/design/oracle approval, run and retain meaningfulRED. Candidate minimal design is a single release-aware FTX scope/field reader reused for presence and local outbound checks; retain the existing register owner and its isolation. Canonical incoming processing should not turn unusedFTX into a national rejection. Do not add a second policy engine, mutate frozen registers, reclassify syntax generically, infer errors from strings, rewrite queued raw payloads, change schema/RLS/roles or weaken unknown-guide/send gates. Exact files and actual defects must be recorded afterRED; then focusedGREEN, independent runtime/tenant/whole-PR review, ordinary exact-head CI and guarded merge/main acceptance.

Next action: independent DESIGN/ORACLE review of this exact record, especially the S4 incoming versus outbound boundary and the real opposing consumers. PR358 and D110/110+10/10 remain accepted. FullF3/masterplan NOT_COMPLETE; PR310 stays OPEN/DRAFT/PAUSED ate9611351. No live or explicit deployment actions.
