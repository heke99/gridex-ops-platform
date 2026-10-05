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
| F-DB-01 | DB-01 | låg | ✅ steg 1 rättat 2026-10-04 (ägarbeslut: fasa ut); DB-01 PARTIAL | `ediel_party_addresses` skrevs av adminformuläret men lästes inte av routing; skrivningen och den döda resolvern borttagna. Kvar: avvecklingsmigration; `ediel_parties` vs `platform_market_actors` ej granskad |
| U-1 | TEN-04 | — | ej avgjord | verify-RPC kräver inget mandat för ombudsroute |
| U-2 | TEN-09 | låg | ej avgjord | end_assignment LIMIT 1 |
| TR-09/E6 | TR-09 | medel | ej avgjord | kräver källa T §3.1 |
| ENV-02, DB-01 | — | — | CONTRADICTED i granskning, fp-check återstår | se batch-7 |
| F-IMP-04 | IMP-04 | medel | ✅ rättad 2026-10-04 | `buildUtiltsOutboundDraft` hittade på subadress `UTILTS` i UNB när ingen var registrerad; nu bevaras tomt/exakt registrerat värde |
| F-ENV-03 | ENV-03 | låg | ✅ rättad 2026-10-04 | handskrivna UNT-räknare i `testing/selftest.ts` (fel vid valfria ADR/CCI/QTY) och PRODAT-provet i `inbound-mail/smokeTests.ts` (UNT+7 för 6 segment); nu beräknade. Riktiga producenten/kodeken beräknade redan korrekt (asserterat) |
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


## Historisk DB-01/DB-02-granskning i #520 — 2026-10-04

Följande två originalrader är bevarade från [Claude-head `77749a55`](https://github.com/heke99/gridex-ops-platform/blob/77749a5551ff9ce01b4bf0f3bcdcb13e67a73508/quality/audits/ediel-masterplan-v2/pr426-rule-review/FINDINGS.md). De beskriver granskningen den 4 oktober, inte dagens godkännandestatus. Registret ovan och inkommande main-texter är bevarade; den ursprungliga daterade handover-raden finns en gång.

| ID | Regel | Allvar | Historisk status | Ursprungligt bevis / åtgärd |
|---|---|---|---|---|
| F-DB-01 | DB-01 | medel | BEKRÄFTAD (fp-check 2026-10-04), öppen | tre aktivt skrivna ruttauktoriteter: `communication_routes` (primär, lib/ediel/core/routeRegistry.ts m.fl.), `platform_actor_routes` (lib/energy/gridOwnerRequests.ts:137, lib/ediel/certificates/actorCertificateRefresh.ts:453) och `ediel_party_addresses` (skrivs av app/admin/ediel/actors/actions.ts:720-740). `resolveEdielPartyRoute` (lib/ediel/partyRegistry.ts:153) saknar anropare = död läsväg, men tabellen underhålls fortfarande. Condition (identifiera auktoritet före nytt) är processkrav utan kodgrind. Kräver contract-plan (backfill→validate→contract) i egen serie, inte en liten PR |
| F-DB-02 | DB-02 | medel | BEKRÄFTAD lucka (fp-check 2026-10-04), öppen | ca 13 sammansatta `(company_id, x)`-FK mot ~1080 UUID-only `references public.x(id)` i migrationerna; inga `EXCLUDE USING`-constraints för aktiva perioder; överlappande tenantprofiler fångas bara i efterhand av auditorn (20260827134553 EDIEL-006, kind audit). Regeln gäller alla tenantägda relationer och kan inte bevisas generellt; behöver inventering + per-tabell-PR:er |

### Senare kvalificering — 2026-10-05

F-DB-02:s breda slutsats från antalet sammansatta FK:er och avsaknad av `EXCLUDE USING` är inte belägg för att alla UUID-relationer saknar skydd. DB-02/AT-DB-02 kräver faktisk tenant+parent-kontroll, unik idempotens, tillämpliga datum-/aktörsrelationer och constraints/RPC som stoppar korskoppling och motstridiga aktiva perioder. De granskade källkedjorna har tenant-parent-triggers för mätserier/värden och rutter, sammansatta kund-/tjänstereferenser samt verkliga RPC-kontroller av ägd parent, kommandoreplay, aktör och period. Detta är kvalificering av namngivna effekter, inte ett generellt säkerhetsbesked för varje tabell eller UUID.

Den konkreta luckan för överlappande aktiva tenantprofiler är åtgärdad i #535 genom `20261004223219_ediel_tenant_profile_interval_guard.sql`: kontroll av datumordning, låst förkontroll av äldre rader och partiell GiST-exkludering per bolag/miljö/marknad med halvöppna intervall. [Oberoende whole DB-02/AT-DB-02 APPROVE](https://github.com/heke99/gridex-ops-platform/pull/535#issuecomment-6000893135) gäller exakt head `2fb524ff6f3413861a9c21142d867074d6f1906c`, tree `cd635c8ecee32e943943b16bca2e8c3955835fb7`. Den återanvänder källkvalificerade regressionsbevis och sex verkliga PostgreSQL-fall med 6 PASS / 0 FAIL / 0 SKIP vid producent-head `6a14022e`, inklusive konkurrerande commit/rollback och två äldre-data-stopp. Den äldre 5 PASS / 1 FAIL-körningen kvarstår som historisk RED.

[Separat capture-only-kvalificering](https://github.com/heke99/gridex-ops-platform/pull/535#issuecomment-6000652647) styrker käll-/output-/manifestkedjan. Capture-statusarna är fortsatt NOT_RUN; den körningen är inte nya beteendetester. Native-jobbet stoppade efter assertions vid dåvarande schemajämförelse. Ingen grön CI på import-head, generell tabellinventering eller produktionsauktoritet påstås. Denna dokumentationsintegration ändrar ingen täckningsrad: vid main `8d990374` är DB-02 NOT_VERIFIED och AT-DB-02 NOT_EXECUTED tills den tekniska ändringen faktiskt integreras och dess slutkontroller godkänns.

F-DB-01 hanteras av sin separata ägare. Den senare statusen ovan, DB-01 PARTIAL och kvarvarande avvecklings-/auktoritetsgranskning gäller framför den historiska originalraden; #520 tillför ingen ny DB-01-implementation eller godkännande.
