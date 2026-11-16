# Verifierade vägar, död kod och rättningar

Uppdatering 2026-11-16. Detta är sessionsunderlag; ingen ny produktkod, push eller Main-adoption ingår. Daterade rapporters scenariotal ersätter inte aktuell ledger.

| Flöde | Rätt väg och faktisk verifiering | Begränsning |
| --- | --- | --- |
| Webhook | Normal behörighetsändring → `gridex_set_contract_channel_permission` → publication-trigger → event/outbox → scoped subscription → TLS-leverans. EVENT01.01/.03/.04 har fullständigt oberoende originalverdict. | En `200` räcker inte: native-ID, fysisk POST, HMAC, återspelning och felstatus kontrollerades. |
| Två tenants | Normal `grantCompanyUserAccess` → canonical tenant-access RPC → accepterat medlemskap. Därefter full `provisionTenantWebsiteIntegration` för redan aktiv TEST-tenant C. | Ingen påhittad prenumeration, inget SQL-satt accepted_at eller aktivering förbi readiness. C:s baseline tas efter normal provisionering. Slutbedömning EVENT01.05 finns separat. |
| Felaktig EDIEL | Normal MIME/IMAP-poll → eget mejl och köjobb → normal köhanterare → varaktigt `processor_failed`/parserfel. EDIEL02.06 är fullständigt PASS. | Direkt parseraction ensam bevisar inte det varaktiga kökvittot. Ingen attribution eller faktureringskälla fabriceras. |
| EDIEL-arkiv före SMTP | Normal `archiveTransportRawMime` → verklig Storage-upload → download/byte- och hashkontroll → normal payloadpost → SMTP. | Egen Storage/REST/databas förbereds. Källgodkännande är ännu inte faktisk runtime- eller SMTP-verifiering. |
| Fakturafil | `/admin/billing/invoice-files/[fileId]` med exportbehörighet och aktuell tenant. | Legacy `/admin/billing/export-center/[runId]/download` är fortfarande en levande barnrutt. `runId` är inte `fileId`. |
| Fakturagraf | `invoiceReviewPrepare` → `gridex_create_invoice_review_draft_v1` → `gridex_create_invoice_export_graph_v1`. | En oanropad TS-wrapper gör inte en native-RPC död. Positiv fullkedja och historiska facit återstår. |
| Retention | `customerRecordClasses.call` → submit/review/begin retention-RPC. | Lyckad kundradering är inte bevis för radering av en låst originalkälla enligt retentionpolicy. |

## Död kod

Det tidigare exakta underlaget innehåller 33 identifierade deklarationer: 24 borttagna i den lokala granskade källkompositionen och 9 behållna. Det är inte ett nytt runtime- eller Main-resultat. En separat dashboard-skrivare har eget underlag och summeras inte automatiskt till 25 borttagna. 187 statiskt onådda kandidater är inte bevisat döda; dynamiska RPC-anrop, ramverksrutter, cron och externa anrop måste avföras innan borttagning.

[Detaljerad daterad väginventering](/tmp/gridex-correct-routes-deadcode-repo-20261114/quality/audits/gridex-correct-routes-deadcode-20261114/REPORT.sv.md) och dess JSON innehåller medlemskap och källhänvisningar. Rapportens gamla kundraderingsstatus och scenariotal är historik; senare verifiering finns i sessionsregistret.

## Nya fel i testverktyget

Två fel från EVENT01.05 är dokumenterade i [FINDINGS.safe.json](/workspace/gridex-root-session-20261112/FINDINGS.safe.json): fel ärvt target-state och slutkontroll som väntade en header-array medan mottagaren sparade `{rawHeaders:[...]}`. Target-felet rättades före Auth. Headerfelet bevaras med faktisk caller exit 1; originalets fullständiga wirebevis granskades separat utan ny leverans. Rättningen ska stödja det exakta mottagarformatet och avvisa ofullständiga headers.

Registret skiljer produktfel, harnessfel och felaktiga auditkrav. Dessa kategorier ska inte redovisas som samma antal öppna produktbuggar. För varje rättning gäller bevisad rotorsak, avgränsad ändring och riktad regression; inga tenant-, käll-, RLS- eller idempotensguider försvagas.

C6-identiteter: `issueControlledTestReceiverIdentity` → `issue_controlled_test_receiver_identity_v1` returnerar `actorId` för den skapade produkt-/marknadsaktören. Utfärdande användare verifieras separat genom `registration.issued_by` mot genuin `getUser`. Fälten får inte likställas i testets kvittens. Workerns V3 rättar den sammanblandningen före Auth.


2026-11-16 källgranskning: 213 bokstavliga RPC-anrop/199 namn i billing+Ediel jämförda med sparad faktisk3443-katalog. Inga nya felaktiga normala faktureringsnamn. AI_LIST/ai_list i generisk registerEdielFile når versionRegistry.ts:141/163 och två saknade legacyRPC:er före senare AI-hantering. Detta är en källkandidat med medelhög relevans för avsedd AI-väg, inte en körd AI-regression eller generell outage. Välj tidigt uttryckligt avvisande eller tekniska AI-versionens normala ägare efter avsiktskontroll; installera inte gamla RPC:er blint. Native invoiceReview→exportGraph är nåbar SQL-väg; UTILTS gamla refusal-ABI behålls. Död kod33=24lokaltborttagna/9behållna och187onådda oförändrat. Underlag /tmp/gridex-normal-rpc-readonly-review-20261116/FOCUSED-NORMAL-RPC-AND-REACHABILITY.safe.json
