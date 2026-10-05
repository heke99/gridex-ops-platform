# E035 input handoff: canonical observations in the actual UTILTS pipeline

Base: accepted PR361/main d7078ac5497c4345491e64491000ca35108915c8. Status: SOURCE_DESIGN_AND_TEST_FIRST. User requested the next code step and reviewed green merge. This increment also saves PR361's actual-main receipt, replacing the unfinished separate documentation delivery; the empty pr361-acceptance branch is not another active workstream.

## Root evidence and corrected reconnaissance

PR361 supplies physical observations at parseCanonicalEdifactAst, but parseInboundUtilts -> parseUtiltsRuntimeFacts -> normalizeUtiltsRuntimePayload does not forward them. Source: utilts.ts blob236ff235, utiltsEngine.part-1.ts blob26d85216, facade utiltsEngine.ts blob1f2a5098, parseUtilts.ts blob681600fa and actual flows/utiltsDataRequest.part-2.ts blobd864d0f8. The processor writes runtime.facts and normalizedPayload into existing diagnostic JSON, so connecting at the lower public parser reaches drafts, both runtime passes and existing persistence calls without changing business decisions.

Read-only reconnaissance5758517088 supports the missing handoff, not a qualified expected inventory. Its labels 'complete provenance' and 'actual dated structure producer' are NOT adopted: ediel_messages stores source candidates but status/timestamps do not prove complete valid-time register authority; meteringValueStorage.insert is an output writer, not an independent expected-state loader; current metering_points and UTILTS-derived readings cannot establish received historical complete physical registers. No universal absence claim or new national interpretation is made. The original E035 source limitations in the PR361 source plan remain.

## Finite proposed implementation

In existing lib/ediel/utilts.ts, add a documented optional typed utiltsObservedTransactions property to ParsedUtiltsMessage. Actual parseInboundUtilts always creates the array from original rawPayload using the already accepted parseCanonicalEdifactAst, flattening actual UTILTS message projections while preserving messageIndex/transactionIndex/observationIndex. Expose the SAME array at the typed return and parsedPayload.utiltsObservedTransactions. No second decoder, reconstructed rawSegments or cached parsed_payload source. Foreign/no-UNH input yields no observed transactions despite old metadata/family labels.

The existing spreads forward this field through buildInboundUtiltsMessageInput, parseUtiltsRuntimeFacts, normalizeUtiltsRuntimePayload, parseUtilts and public runtime; the real inbound processor already passes fresh runtime diagnostics to updateEdielMessageStatus and createEdielMessageEvent. No changes to those validators/processors are proposed unless the actual tests prove the handoff is lost. Optional typing preserves existing handmade fact contracts; this does not authorize callers' JSON as source. Existing rawSegments, all legacy scalar/transaction/energy projections, selected guide, ACK, disposition, permissions, ingest/persistence decisions and outbound builder are unchanged. No expected-source flag, completeness claim, E61/E62 or meter inheritance is added.

## Test-first and acceptance

New tests use actual parser/draft/public runtime and actual inbound processor, mocking only its I/O/matching boundaries (never the runtime). Literal identities and vectors cover three UNA alphabets, duplicates, empty/malformed identities, header/late references, multiple families/messages, trailer boundaries, whitespace/release handling and actual dangling-release rejection. Runtime tests cover both guide dates, both environments, forged prior diagnostics, immutable source input and unchanged E19 behavior/energy-only normalized transactions. Processor tests inspect fresh status/event persistence arguments, not a claim of real database commit or live ACK transport.

Publish tests first, observe meaningful missing-handoff RED with all5080 old cases unchanged, and obtain independent SOURCE/DESIGN/oracle approval before implementation. Then require exact-head ordinary CI, completed independent TASK/SPEC/QUALITY/TENANT-BOUNDARY/WHOLE-PR review, expected-head guarded merge and actual resulting mainfull73/73 plus OPS. Inspect the actual resulting artifacts and record a durable acceptance comment/receipt. No workflow, threshold, fixture-source or existing assertion weakening.

## Routing and remaining work

Relevant workflow: executing-plans, source/caller tracing and direct false-positive qualification, TDD, differential review, requesting/receiving review, verification-before-completion and branch completion. Property invariants are exercised across three alphabets and repeated identities. No React/Next API, UI, schema, RLS, infrastructure, broad security audit or performance-remediation work is activated; existing full CI remains required. Local artifact inspection is not local full-suite execution.

After this handoff: qualify or implement the genuine received dated register-structure source/loader, then source-qualified comparison and guide-first operational outcomes. E035, F3C-02/04/05/06/07 and later masterplan criteria remain incomplete. D110/110+parents10/10 retained. PR310 stays OPEN/DRAFT/PAUSED e961135199f292b8210884f07de3b616a670161a untouched; PR362 closed unmerged. No live DB, providers, market communications, settings or explicit deployment actions.
