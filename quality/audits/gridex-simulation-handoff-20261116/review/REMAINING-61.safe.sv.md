# Återstående 61 – läsande gruppering under väntan

Status är oförändrad: **43 FULL / 1 GAP / 61 ofullständiga**. Av de 61 har 16 partiella körbevis, 36 saknar mappat fullständigt casekvitto med återstående förutsättningar och 9 saknar originalunderlag. Det betyder inte att de 36 aldrig har körts.

| Kluster | Antal | Exakta ID |
|---|---:|---|
| underlay_invoice_export | 22 | BILLNEG01.01, BILLNEG01.02, BILLNEG01.03, BILLNEG01.04, BILLNEG01.05, DELIVERY01.03, DELIVERY01.05, MAIN03.01, MAIN03.02, MAIN03.03, MAIN03.04, MAIN03.05, MAIN04.01, MAIN04.02, MAIN04.03, MAIN04.04, MAIN04.05, MAIN05.01, MAIN05.02, MAIN05.03, MAIN05.04, UI01.03 |
| catalog_site_contract | 8 | SITE01.01, SITE01.03, TERM01.05, TERM03.01, TERM03.02, TERM03.03, TERM03.04, TERM03.05 |
| resolution | 1 | TERM02.04 |
| ediel_original_cohort | 6 | EDIEL01.01, EDIEL01.02, EDIEL01.03, EDIEL01.04, EDIEL01.05, EDIEL01.06 |
| ediel_source_semantics | 4 | EDIEL02.01, EDIEL02.02, EDIEL02.03, EDIEL02.04 |
| selected_four_and_retry | 6 | EDIEL02.05, EDIEL03.01, EDIEL03.02, EDIEL03.03, EDIEL03.04, EDIEL03.05 |
| retained_source_custody | 4 | CUSTODY01.01, CUSTODY01.02, CUSTODY01.03, CUSTODY01.04 |
| external_normative | 9 | MAIN06.01, MAIN06.02, MAIN06.03, QA02.01, QA02.02, QA02.03, QA02.04, QA02.05, TERM02.08 |
| final_epoch_gates | 1 | QA01.04 |

Primärklustren delar upp de 61 exakt en gång. Blockerarklasserna i JSON överlappar: ny funktionell fixture, saknat original/normativt facit, runtime/auth/samma staging samt ny UI-bas efter merge. De ska inte summeras. Ny fixture kan ge verkligt funktionsbevis utan att uppfylla ett ursprungsfall som kräver de gamla 28 källorna, 1809,51-facit, officiellt schema eller externt kvitto.

Efter väntan: bind först den andra agentens faktiska merge och nya UI-/källepoch. Kör därefter det redan valda fyrfallet, sedan köåterhämtning/SLA och source-dedupe/rättelse med samma kvalificerade normalflöde där oraklet tillåter. Nästa större vertikal är positiv import → giltig supply/pris → underlag → prepare/approve → export, replay, custody och leverans/UI. Publicerbart katalog-/avtalsunderlag krävs före site/TERM. Slutgrindarna binds sist till slutcommit.

Parallellt kan oberoende käll-/orakelgranskning, insamling av saknade original och kvalificering av den mergade UI-basen göras. Endast en producent får mutera delad staging/runtime/Auth; inga dubbla körproducenter. Den tidigare Mac-matrisen 20/85 finns inte som källdata här och har varken adderats till eller ersatt 43/61.

Fyndregistret är blandat och dess antal är inte antal öppna produktbuggar. Resurs-/restore-/harnessfynd ska inte räknas som caseutfall. Exakta per-ID-orakel, minsta nästa åtgärd och ledgerns begränsningar finns i JSON.
