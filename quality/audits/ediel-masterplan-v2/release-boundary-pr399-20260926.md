# Ediel v2 release boundary after PR #399 — 2026-09-26

This is a code/deployment checkpoint, not a market traffic authorization or a whole-phase certificate. PR #310 remains paused. No staging, TGT/AGT, counterparty trial or real market send was performed.

## Accepted bounded criterion

The actual ACK gateway selects a tenant `communication_routes.route_scope='ediel_ack'`, while the prior persisted CHECK excluded that value. PR #399 adds only that CHECK member. A clean empty-database replay on exact PR head `d7c3762f6e4a190e61a2464d65402a557714653b` (OPS run `36261652141`, retry native job `108459647312`) passed 344/344 native tests in six files, including real inbound mixed Z04 → central decision → tenant/legal actor/profile → positive CONTRL and negative APERAK with first physical-object FTX213/RFF → two queued outbox rows → same-original retry identity and no case/switch/supply write. Schema fingerprint `27b18060dd20cfc525fcd832876980b1ff3d6a4602ddbb27fba33c7d35d5fece` and authentic generated contracts matched. OPS verify/quality, tenant, Ediel, browser and full E2E were green on that same head. Squash main `5f554f1ab2cb2043c9482b7c85d7975b86baba04` was verified against remote main; Vercel production `dpl_6cHLqratq28QYGeG6euUHo7xfimu` became READY for exactly that SHA.

The preceding head `70ee7ddc` had three intermittent E035 document-reference Storage-mutation tests fail with `invalid_document_observation_time`; first stage lacked timestamps. The diagnostic head's first replay failed before tests on Docker registry `toomanyrequests: Data limit exceeded`; one targeted retry passed. Thus the E035 time failure is observed but its ordering cause remains **unresolved**; do not equate the later passing matrix with a fix. The new failure-only test diagnostic retains attempt/observation/database timestamps for a future occurrence. No E035 positive authority, completeness or retention claim follows.

## Production boundary

| Surface | Current decision | Required before market activation |
| --- | --- | --- |
| Existing web application code | Deployed on Vercel production at the verified main SHA. This proves build/deployment only. | Continue ordinary operational monitoring and independently check live schema/configuration before using newly deployed database behavior. |
| Synthetic `ediel_ack` route capability | CHECK supports a configured tenant route; no route, legal mandate, grant or send permission was created by #399. Test profile is `test` and no transport worker sent anything. | Verify the actual production tenant/legal actor, received source profile, eligible route/profile, live migration/schema, durable ACK/outbox, retry and transport fence for the particular capability. |
| UTILTS 203 duplicate/ERC42; positive E66 LOC+175; E035 structural/correction authority | Remain fail-closed or unactivated. Durable historical identity scope, distinct regulating-object sink, dated structure/completeness/retention respectively remain unproven. | Resolve each owner's source and native consumer/SQL acceptance. Never infer approval from the Z04 ACK example. |
| Outbound market traffic, bilateral or formal acceptance | No-go in this code round. A READY web deployment is not Ediel approval. | Applicable actor mandate, counterpart agreement, exact source profile, security/transport and ACK evidence, plus the capability-specific staging/TGT/AGT/counterparty evidence when those formal gates apply. No automatic send on deployment. |

## Counted denominator and reconciliation limits

The frozen machine-readable registers currently contain **121 rule cards**, all with `implementation_status='Ej verifierad'`, and **231 planned acceptance contracts**, all with `execution_status='Inte körd mot systemet'`. This was verified by grouping the repository JSON after #399. Those strings are historical specification-workbook states, not a negation of subsequent PR/CI receipts. There is no maintained one-to-one mapping from all later receipts to all 121/231 IDs; therefore the number of individually accepted or remaining rule cards/contracts cannot honestly be subtracted from these denominators yet.

| Counted source unit | Denominator and register state | Later evidence boundary |
| --- | --- | --- |
| Rules by ID family | AC 10, AI 5, DB 6, EN 10, ES 11, GO 8, IM 5, OP 5, P- 17, TE 14, TR 11, U- 19 = **121**; all 121 frozen statuses unverified. | Select individual rule IDs, source/owner/consumer and accepted receipt before changing their status. |
| Acceptance contracts by layer | Integration/E2E 72; planned message/role 38; planned rule-behavior 121 = **231**; all 231 frozen statuses not run against system. | Later targeted native and CI tests are not automatically these 231 named executions. A contract-ID-to-test/PR ledger is required. |
| PRODAT D cells/dependent parents | 110/110 numeric D conditions and 10/10 dependent-parent occurrences have bounded accepted receipts. | These are a different denominator, not 120 accepted rule cards or all F3. |
| F0–F7 whole-phase closure | Eight named phase gates; **0/8 certified as whole phases** by available criterion receipts. | F3 has five separately open reconciliation groups F3C-02/04/05/06/07, with accepted subcriteria; F0/F1/F2 and F4/F5/F6/F7 retain capability-specific source, rights, routing, business, data and release gates. No percentage is inferred. |
| G01–G07 | Seven evidence gates in the frozen plan, not globally certified. | Apply per affected capability; G06 full UNSM versioned grammar remains incomplete and PR #310-dependent parity stays paused. |

First code-independent blockers: UTILTS field203's tenant/legal-actor-bound immutable document identity and historical duplicate/ERC42 scope; positive LOC+175's separate regulating-object identity and sink; E035 dated E61/E62 structure, pre-epoch `complete:false`, retention/deletion and the intermittent observation-time cause. Continue other source-backed F3C-02/04/05/06/07 and F1/F2/F4–F6 criteria independently rather than waiting on one external owner. No whole masterplan approval is asserted.
