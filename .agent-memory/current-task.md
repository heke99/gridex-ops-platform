# Active task — F3 TaskA / E011 source and consumer qualification

Status: IN_PROGRESS. PR357 publication, independent review, guarded merge and actual-main73/73 plus allOPS are DONE. D110/110 and parents10/10 are DONE. Do not redo either.

Read quality/audits/ediel-masterplan-v2/f3-phase-closure-plan-20260920.md (reviewed atf3dcf649) and f3-phase-closure-plan-review.md. Independent plan review5751554605 gave allfourPASS and retained execution entry gates.

TaskA: obtain and inspect applicable full T24.A revision6 sections2.1/4.2 with actual hash/page evidence; map source applicability and exceptions to the existing canonicalAckEngine/facade, shared envelope and every separate PRODAT serializer path, final preflight and expectation/monitoring consumers. Deliver the plan's source/consumer/oracle record and get its independent TaskA approval before new runtime edits. The source manifest's old hash is not fresh proof. Confirmed static omission5751514908 is not an executed RED test.

Correct rule locator: ENV-04/AT-ENV-04=0031; ENV-05/AT-ENV-05=0035. Do not infer0031 from BGM/AB or add a duplicate family matrix. Do not change incoming rejection semantics without source support. Preserve CONTRL no-loop, test/prod, references, counters and escaping. Meaningful durable RED through real qualified builders precedes implementation; use the approved plan's exact gate order.

FullF3 remains open beyond the D counter. Other criteria stay queued for evidence reconciliation, not assumed bugs. PR310 stays paused at e9611351, no writes/imports/restarts. No live DB/provider/market/role/settings/explicit deployment work. No new runtime authorization is recorded yet.
