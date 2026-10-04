# Findings register — PR #426 rule review (2026-10-03)

| ID | Regel | Allvar | Status | Bevis / åtgärd |
|---|---|---|---|---|
| F-TEN-01 | TEN-01 | medel | ✅ rättad a7ad87a9 | central outbound execution context |
| F-TEN-02 | TEN-01 | låg | ✅ rättad a7ad87a9 | ingen tenantlös global aktör |
| F-TEN-03 | TEN-02 | medel | ✅ rättad a7ad87a9 | rollbundna aktörsprofiler |
| F-TEN-04 | TEN-06 | medel | ✅ rättad 2c78bede | juridisk mottagare endast DO/MR |
| F-U-04 | U-04 | hög | ✅ rättad 102fe9b1 (migr. 20261003150200, omnumrerad från 150000) | sen äldre version tränger ej undan nyare |
| F-U-14 | U-14 | hög | ✅ rättad 102fe9b1 (migr. 20261003150200, omnumrerad från 150000) | received-ERR-dispatcher återställd |
| F-SRC-01 | (källregister) | hög | ✅ rättad 161b9bae (migr. 20261003150300) | validering av kvarhållen källhistorik efter operativ radering gav no_data_found; läser nu hash-bundna bytes ur gridex_received_sources.sources |
| F-OPS-02 | OPS-02 | medel | ✅ rättad 2026-10-04 (#507), OPS-02 VERIFIED | kundkort och arbetskö styrs av `readEdielProcessNextActions` (orsak, tidsgrund, ansvar, blockerare, tillåtna åtgärder) och hålls när beslut saknas; begärandetabellens badge påstår inte längre väntan. fp-check: `automation.part-2.ts:248` och `actions.part-1.ts:185` (`normalizeSimpleRequestStatus`) registrerar status vid själva utskicket och används för jobbets livscykel/idempotens, inte för nästa steg = FALSKLARM; `pendingCustomerInfoRequests` (page.part-4) är oanvänd |
| F-ENV-01 | ENV-01 | medel | öppen — ägs av #504 (Codex) | UNOC-repertoar för alla utgående segment |
| F-GOV-03 | GOV-03 | låg | FALSKLARM (fp-check 2026-10-04) | härledningen i validator.ts:315 är bara förval; på kvalificerad sändning styr originalets fysiska familj (`sourceBoundAckCanonicalPolicy`) och fel profil ger `ACK_APERAK_PROFILE_INVALID`; utan original stoppas sändning. Bevisat i `ediel-gov-03-aperak-source-family.test.ts` |
| U-1 | TEN-04 | — | ej avgjord | verify-RPC kräver inget mandat för ombudsroute |
| U-2 | TEN-09 | låg | ej avgjord | end_assignment LIMIT 1 |
| TR-09/E6 | TR-09 | medel | ✅ löst 2026-10-04 (ägarbeslut), TR-09 VERIFIED | S/MIME krävs för alla familjer i produktion; klartext endast via journalfört, avgränsat undantag (fail closed) i TS-sändväg, preflight och `stage_v1` (migr. 20261004180000). Bevisat i `ediel-tr-09-*.test.ts` |
| ENV-02, ENV-03, IMP-04, DB-01 | — | — | CONTRADICTED i granskning, fp-check återstår | se batch-7 |
| PGLITE-CI | alla | medel | ✅ delvis | PGlite-regressioner kördes inte i CI; 0.3.14 nu devDependency, U-04/U-14 körs via test-ediel-wrapper |

Falsklarm (fp-check): D4, D5, D6, D8, D9, D11–D15 (TEN), A1–A3 (ACK), C1–C2 (P/U), E1, E2, E4, E5, E7 (TR/OPS/AI), G3–G5 (ENV/GOV).

## Webbläsarfel (CI clean-migration-replay) — rotorsaker och rättningar 2026-10-03
| ID | Allvar | Rotorsak | Rättning |
|---|---|---|---|
| F-UI-01 | medel | `<select>`/`<textarea>`/`<input>` inuti `<label>`: alternativtext eller ifyllt värde blev del av det tillgängliga namnet (a11y + exakta etikettsökningar föll) | explicit `aria-label` på 115 kontroller i app/retention, app/admin/ediel, components/admin/ediel |
| F-UI-02 | låg | gallringsytan svämmade över vid 375px/200% zoom (selects med långa alternativ, gridkolumner) | `.retention-workspace`-regler i globals.css |
| F-UI-03 | medel | ekonomiska kopior/processjournaler visade förra läsningens fil medan ny läsning pågick | dölj resultat under `pending` |
| F-RET-01 | medel | arkiverat bolags läsanvändare nekades läsa beslutsfiler för ekonomiska kopior/fakturafiler (fel läsvägsval, variant av tidigare kundposträttning) | migration 20261003150100 |
| F-RCS-01 | medel | kundändring köad från UI hittade aldrig nätägarens route (inget route-ID, grid_owner null) | flödet härleder egen aktiv nätägare från juridisk mottagare; unit-test |
| FIX-01 | — | webbläsarförberedelser förlitade sig på att native-sviten seedat behörighetskatalogen | katalogsetup i alla browser-native-konfigurationer |
| FIX-02 | — | nätregistrets webbläsarfixtur hårdkodade registerversion 2 som redan använts | versionsräknaren tilldelar |
| FIX-03 | — | ärendets läsanvändare saknade customers.read men specen förväntade kundlänk | fixturen ger customers.read (ingen skrivrätt) |
Lokalt (full replay + dev-server): alla 8 tidigare röda specar gröna: customer-record 3/3, decision-evidence 3/3, finance 3/3, message-content 3/3, process-journal 3/3, network-registry 2/2, requested-change 3/3, case 3/3.

## SQL-regressionskedjan (manual-inbound-tenant-graph) — 2026-10-03/04
Kedjan stoppade tidigare vid F-SRC-01 och dolde sex föråldrade regressioner. Uppdaterade till grenens kontrakt utan försvagning:
register-validation (evidensform version+snapshot), source-object-decisions (+exakt FK-TRUNCATE-avslag), z04-ack-durable
(grammatik, produktionsägarens validering, V2-portar, owner witness, källa utan fält 213), utilts-committed-retry
(UNB-testindikator, exekveringsaktör, ägarfacet, issuer-registrering), source-validation-concurrency, source-object-concurrency.
CI-workflowen namnger nu varje felflagga med radnummer. #426 helt grön på f32e40b5.

Godkännandekandidater 2026-10-04: se `candidates-2026-10-04.md` (inga godkända; luckor per effekt listade).
