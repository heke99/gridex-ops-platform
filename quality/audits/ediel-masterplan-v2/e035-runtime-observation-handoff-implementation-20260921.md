# PR363 — real UTILTS observation handoff

Status: IMPLEMENTED_NOT_VERIFIED. Candidate parent45bb5dc08dbccbb3c8d78b1a31492fe6a6f3e139; fetch actual child head before acceptance. Accepted runtime main remainsd7078ac5497c4345491e64491000ca35108915c8/PR361. Its actual-main receipt is saved in this delivery.

## Qualification and meaningful RED

Independent SOURCE/DESIGN/oracle review5758689949 on45bb approved the retained handoff plan. Root directly read ordinary OPS35586336942 quality106290453213 through cleanup2026-09-21T10:02:56Z, Node22.23.2:322files320PASS2FAIL,5102tests5083PASS19FAIL. All5080 old cases pass; new runtime/parser/draft18 has15 missing-handoff failures and3 dangling-release controlsPASS; actual processor4 fails at missing fresh runtime observations in status persistence arguments. Allfailures are actual property assertions, not import/type/setup. Scripts/tests typing, mechanical andquality45PASS. Durable RED/root authorization5758756950. No corrected GREEN is inferred.

## Actual bounded code

lib/ediel/utilts.ts adds imports of the existing canonical AST and its transaction type, a documented optional utiltsObservedTransactions onParsedUtiltsMessage, derivation from ORIGINAL rawPayload's actual UTILTS message projections, and the SAME array in typed return andparsedPayload. Physical message/transaction/observation indices remain intact when collecting message projections. Foreign/no-UNH or absent wire produces[]; no cachedJSON, reconstructedrawSegments, inferredmetadata or tenant labels supply observations.

Existing spreads connect inbounddraft, parseUtiltsRuntimeFacts, normalizeUtiltsRuntimePayload, publicparseUtilts and runtime, then actualprocessor status/event diagnostic persistence arguments. Existing validators/dispositions/energy normalization/ACK/ingestion use their unchanged inputs. No expectedinventory, meterinheritance, valid-time/completeness/authority bit, E61/E62 classification, guide-order or database commit guarantee. The processor tests execute the real processor and both realruntime passes with externalI/O/matching mocked: evidence of callpayloads only, not a liveDBtransaction or market send.

All22 published handoff controls and5080 prior tests are unchanged. Optional typing preserves existing handmade facts; it does not make arbitrary callers' JSON trustworthy. No existing projection, builder, tokenizer, schema, policy, workflow, threshold or source-original change. Independent exact-head TASK/SPEC/QUALITY/TENANT-BOUNDARY/WHOLE-PR review and ordinaryCI precede expected-head guardedmerge; actual resultingmainfull73/OPS plus inspected artifact binding/rows/JUnit follow.

## Remaining / routing

Genuine received dated structural-source/loader qualification and operational E035 comparison remain open; received observations cannot be their own expectedinventory. Keep fullE035/F3/masterplanNOT_COMPLETE, D110/110+parents10/10accepted, PR310OPEN/DRAFT/PAUSED e961135199f292b8210884f07de3b616a670161a untouched,362closedunmerged. Empty pr361-acceptance branch is superseded by this combineddelivery, not separateactivework.

Workflow applied: executing-plans, direct source/caller and false-positive qualification, test-first actualRED, differential review, requesting/receiving independentreview, verification-before-completion. Source provenance limitations remain in retained361/363plans. No localrepositorysuite claim; onlyCIartifactinspection locally. No unrelatedUI/schema/security/infrastructure/performance-remediation change orliveoperations.
