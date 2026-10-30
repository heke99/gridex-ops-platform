# FINDINGS – claude-track6, kampanj 20261029-3f1a8ab1, körning t6r1

Status: utkast från claude-track6 för integratörens granskning. Inga state- eller PASS-ändringar gjorda här. Filen lever i runs/t6r1/claude-track6/ och ersätter inget tidigare kvitto.

## Gemensamt för packeten
- Utförare: claude-track6 (model: claude (session_01UHTg8Hora3xtZg4oHMrcGi)). Datum: 2026-10-30 (UTC).
- baselineCommit 1c0c088cb4ed66d0dd8b3e34c9606019342a1a56. appCommit 6454d540b6978a9c25434b8c66bcd7a0e335c99c (main enligt uppdrag). 6454d540 är ancestor av origin/main (verifierat med git merge-base --is-ancestor); den inaktuella lokala grenen main saknar betydelse.
- Harness-RUN_DIR-commit: 220edef2f för CUSTODY01.03/.04-omkörningarna (bygg 7afacc78, endast harnessdiff); 84a3e6883 för FINDING-001 och tidigare CUSTODY-körningar, 4d67fa7c2 (CUSTODY01.02). git diff --name-only 6454d540..7afacc78 utanför scripts/simulation/track6 är tom, så appkoden är oförändrad. overlay: claude/sim-20261029-track6, appCodeChanged false.
- Miljö: environmentId t6-local-20261030. Lokal Supabase 127.0.0.1:54322, replay 1e0a29bc04cc168e135f86b7ab955805073a107b, fingerprint/schemaHash 5168f69b67b1e45168ef327ecf92efec6dc7bcd9dc2cf66f48f4ea96527c782c (partiell identitet). applied-migrations: 0 rader.
- Postgres: ghcr.io/supabase/postgres:17.6.1.155 (digest i evidence/image-digests.txt). Node v22.22.0, PG 17.6.
- clockModel: real UTC. executionScope: ISOLATED_NATIVE.
- Identitetsfiler (sha256): commits.json (rewritten after several runs; run identity attested per run by run-identity.json); replay-commit 53cc4193f0ea29eeefdf082994ea72f6afdd5ca8de12c0ae4d68895c31f5256f; fingerprint 2cb1ad4a6bec22c093013eed199518bf62083cdd3007d3345ce7015bb881e839; applied-migrations.tsv e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 (0 byte); evidence/image-digests.txt 95a0dd1376143260010f25dffa87afb2b94d5bc2234023d882e0d2a0f7e4cc22; evidence/greenmail-jar-hashes.txt e819bdaef3a4a085c6aad57f327a1f005e5546e7268fbcd807920514f3e1b02d.

## Fynd

### 20261029-3f1a8ab1/claude-track6/001 – produktfel (första sommartidstimmen, leveransstartdag)
- Scenario: FINDING-001 (finding-001-start-hour). Datum 2026-10-30. Utförare claude-track6.
- Kategori: produktfel. State: styrkt (observerat och reproducerat i en körning; ej rättat, ej omtestat).
- Kommando: /home/user/sim-home/track6/runone.sh finding-001-start-hour. run-id 20261030T162723Z-f4b727, exit 1.
- Förutsättningar: syntetisk UTILTS E66, 24 timvärden per dygn, leveransstart 2026-09-30 (testtitlar), tidszon Stockholm.
- Förväntat (a): inläsningen avbryts inte, 24 rader, 22:00Z-timmen ej billable, öppet ärende.
- Faktiskt (a): DB kastar 23514 billing_gate_qualified_supply_source_required. 1/24 rader pending_match. TS-grinden bedömer eligible true. Testfel ordagrant: "AssertionError: expected 'billing_gate_qualified_supply_source_…' to be null" (finding-001-start-hour.test.ts:264:26).
- Testutfall (vitest): 5 passed, 2 failed. Båda fel gäller FINDING-001 a. Kontrollen b passerade: "E66 helt efter leveransstarten -- 24 rader, alla eligible/billable, ingen DB-vägran".
- Kontroll (b): E66 2026-10-01, 24 rader, alla eligible/billable, ingen DB-vägran.
- Rotorsak (kodläsning, ej bekräftad av rättning): lib/billing/meterValueBillingMatcher.ts:58,117,125; lib/billing/billingGate.ts:70-111, 286-296; DB-funktion i supabase/migrations/20261014103601_ops_api_atomic_bb0b_source_part_07.sql.
- Observerat vs hypotes: observerat är DB-vägran och 1/24 pending_match. Att TS-grinden och DB-funktionen är orsaken är hypotes.
- Bedömd påverkan: varje leveransstart under sommartid stoppar UTILTS-intaget för startdygnet (hela batchen avbryts i persistBillingGate, meterValueBillingMatcher.ts:58). Undviks första timmen blir underlaget ofullständigt (mätvärdeslucka 00–01 lokal tid → needs_review, observerat i DELIVERY01 körning 20261030T162009Z-f58e37). Vintertid opåverkad. Allvar: hög (fakturerings- och intagsblockerande), bedömt av T6; samordningen har vidarebefordrat förslag om rättning (a) per-värde blocked/pending före (b) juridiskt startögonblick.
- Öppet: om 22:00Z-instanten är juridiskt korrekt. Ej avgjort.
- Rättning: ingen. Omtest: ej.
- Evidens (sha256): runs/20261030T162723Z-f4b727/finding-001-start-hour/report.json 24af814c7b22ea58a06efa28591e310ef62a3f514fd5f354fde13d1cabe817bb; .../log.txt de05ba7d3b5d161da1dfda679f89e6639261ed3d62cc7e23a58bcd1894f2cc3f; .../vitest.json b5d4b5dec9c6e897776e5eb60d9425d4b8d56de38edb7061dbe7f6219d323040; evidence/t6r1-20261030T162723Z-finding-001-start-hour/report.json a50faf354d25778a3025fb0bcfcb4aefcc354bb7301ed19fa5b0ba8c88980db4; .../run.log 689bd68fd7181f6cf5239eac594c949a2aeee0bff16b96f91af34d8d30717dd4. Katalog: evidence/t6r1-20261030T162723Z-finding-001-start-hour.

### 20261029-3f1a8ab1/claude-track6/002 – testharness (produktrepo)
- Scenario: CUSTODY01.04-fixturen (scripts/ediel-invoice-file-retention-native.test.ts). Kategori: testharness. State: rättat-väntar-omtest. Omtest delvis grön, ej verifierad rättning.
- Före (evidence/fix002/before.log, sha256 55615459ad5ab983cab67e83649d93fbe413c4687f596a7e9bfcec86d72428b6): 3/3 fail. Ordagrant: `ERROR:  syntax error at or near ")"`. Felplats: scripts/helpers/ediel-invoice-file-retention-native-fixture.ts:17:2 (stray ")" i SQL-helper).
- Rättning: be062e718 "fix(test): remove stray paren in invoice-file retention native fixture SQL (T6/002)", 1 insertion, 1 deletion, scripts/helpers/ediel-invoice-file-retention-native-fixture.ts.
- Efter (evidence/fix002/after.log, sha256 0cff8c0f08208bcce4cf7157f8c876eacfc31a0a0eb759c01dc7fac0831f0bd3): 2 passed, 1 failed. Ordagrant: `AssertionError: expected 403 to be 200 // Object.is equality` (scripts/ediel-invoice-file-retention-native.test.ts:26:92).
- 403-analys (DB-logg + funktionskroppar, läsande): eget produktfel, registrerat som 003 nedan. Rad 26 nåddes aldrig före rättningen. Ej orsakat av 002.
- Leverans: PR #958 (head be062e71808fad55dc67359408e690bdf8312ee6). Granskning 1/2 (oberoende sim-reviewer): GODKÄND. Andra granskning ordnas av samordningen.
- Övriga evidensfiler: db-before.txt "before|23|138", db-mid.txt "mid|26|138", db-after.txt "after|32|138" (tolkning ej gjord). SHA256SUMS sha256 ce8cecc3c5bfbb2dc5b4ffbc7f73174fc946c5a6067bbe3275d1deb8563dc73e.
- Påverkan på CUSTODY01.04: enligt commit 0a9a0ef39 använder CUSTODY01.04 egen kopia av fixturen. 002 är inte belagt som orsak till 04-resultatet.

### 20261029-3f1a8ab1/claude-track6/003 – produktfel (läsbehörig nekas fakturafilens källa)
- Upptäckt: 2026-10-30 i efter-körningen för 002 (evidence/fix002/after.log). Kategori: produktfel, behörighet (överstrikt nekande, inget läckage). State: styrkt (DB-logg), ej rättat.
- Faktiskt: readonly-användare med ediel.retention.read + ediel.retention.invoice_copy_evidence får 403 på `source`-läsning; DB-logg `ediel_retention_current_actor_forbidden` (actor_v1 rad 11 ← invoice_file_actor_v1 rad 2 ← ediel_read_invoice_file_source_v1 rad 2).
- Rotorsak (omdiagnostiserad live): `ediel.retention.read` finns inte i `permission_v1`:s `retention_keys` (20261001000710_…sql) → op faller till `gridex_actor_has_company_permission`, som exkluderar arkiverade bolag. Detta är avsiktligt enligt F-RET-01 (20261003150100_ediel_archived_finance_invoice_retention_read.sql), där arkiverade läsmedlemmar ska kunna läsa. Samma mönster i varianter: `ediel_read_invoice_file_source_v1` (20261001071000_ediel_invoice_file_copy_class_retention.sql:106, anropar `permission_v1(c,actor,'ediel.retention.read')` vid :107), `ediel_invoice_file_retention_basis_v1` (samma fil, :98), `ediel_finance_copy_retention_basis_v1` (20261001070000_ediel_finance_copy_class_retention.sql).
- Rättning: godkänd migration 20261030131200 (GEN-slot 15), ännu ej skriven (ingen fil i supabase/migrations). Ej rättad.

### 20261029-3f1a8ab1/claude-track6/004 – produktfel (styrkt; BLOCKED: finance-samordning)
- Scenario: DELIVERY01 (generate-underlay), körning 20261030T163703Z-9c7deb, exit 1. Kategori: produktfel. State: styrkt (app.log och kodläsning), ej rättat i denna packet.
- Faktiskt: DELIVERY01 setup C1 (log.txt): `generate-underlay misslyckades: HTTP 500 efter 4902 ms med 24 värden: {"error":"Fakturaunderlaget kunde inte skapas.","code":"billing_underlay_generate_failed","trace_id":"cff801d9-a8f0-4f7f-90a3-fe5555d9d14f"}`. App-logg (sim-home/track6/logs/app.log): `[billing-underlay-generate] failed` traceId cff801d9-a8f0-4f7f-90a3-fe5555d9d14f, code '23514', error 'billing_underlay_supply_contract_price_basis_required'. Samma kod och fel för traceId 0ac53cb7-5ee6-4c0e-992c-37a2d4e14891, 9ed7607d-0ee2-4551-85c7-55a1d754dbfb och ccd3239d-8032-4a4f-83b8-da1d3993e08f (4 av 4 loggade fel i app.log).
- Rotorsak (kodläsning): DB-funktionen `gridex_store_billing_underlay` i supabase/migrations/20260930175405_ediel_billing_qualified_exact_source_basis.sql (funktionshuvud rad 228) kräver `price.snapshot_json IS DISTINCT FROM p_underlay->'pricing_snapshot'` (rad 260) och kastar `billing_underlay_supply_contract_price_basis_required` ERRCODE 23514 (rad 266). lib/billing/underlayEngine.ts `snapshotPayload` (rad 438–478) lägger till contract_price_snapshot_id, pricing_model, base_price_components och price_components utöver snapshot_json; ready-vägen skickar detta som `pricing_snapshot: snapshotJson` (rad 1322, `validated_at: ready ? now : null`). JSON:en skiljer sig därför från lagrad snapshot_json. Snapshot-källan är supabase/migrations/20260818165847_canonical_online_signature_v1.sql rad 187 (`'source','signature_prepare'`).
- Ej verifierat här: live-radnummer 38 i funktionskroppen (orkestratorns uppgift; ingen DB-åtkomst i denna session), att alla 31 snapshots kommer från signature_prepare, och att varje ready-underlag faller.
- Testgap: scripts/qualified-underlay-pricing-snapshot-sql-regression.mjs:99 anropar `gridex_store_billing_underlay` med `pricing_snapshot:{price:'original'}`, inte den snapshot som underlayEngine producerar. Regressionen fångar därför inte felet.
- Fix (finance): 946c56630 "fix(billing): a ready underlay stores the contract price snapshot's exact JSON, as the store requires (F8-B1)" ändrar lib/billing/underlayEngine.ts (4 +/-) och lägger till __tests__/reality-f8b1-ready-underlay-exact-price-snapshot.test.ts (84 rader). 946c56630 är ancestor av c400f695 (verifierat med git merge-base i denna repo). Att fixen är på main är ej verifierat.
- Bedömd påverkan: ready-fakturaunderlag skapas inte (HTTP 500). Allvar: hög (faktureringsblockerande), bedömning av claude-track6.
- Rättning i denna packet: ingen. Omtest: ej. Blockerad: finance-samordning.
- Evidens (sha256): runs/20261030T163703Z-9c7deb/delivery01/report.json 6feee29c44174404598dc7632a00453fcf8d3585d28caec6671b48b5756a456a; runs/20261030T163703Z-9c7deb/delivery01/log.txt b99e0e8cd4bdec0b7ffaf5f54b7e8d3e932b261f152df6533d7b7499c7432578; sim-home/track6/logs/app.log 65e4eebdde484c157911e3f3e50cfceff32656d7bf38f55e2b336e191abff054 (innehåll ej kopierat).

## Ersättningssteg och avvikelser (sammanfattning)
- CUSTODY01.03: ERSATTNINGSSTEG motor med aktör (runIntakeWithActor). Se status.json replacementSteps.
- CUSTODY01.04: ERSATTNINGSSTEG route i testprocess med mockad klient. Se status.json replacementSteps.
- CUSTODY01.05 (senaste körningen 20261030T205347Z-978720, 9/9 steg passed, vitest 9/9, exit 0; state PARTIAL, proposedState PASS, granskning väntar): pg_dump -Fc via docker exec (host major 16, server major 17) och pg_restore till ny databas på samma server som supabase_admin utan --no-owner/--no-acl (lib/custody/restore.ts:3, :52); pg_restore status 0, 0 felrader; ägare/ACL/RLS/triggers jämförda (protections-diffs.json diffs {}). Avvikelser kvar: lokal restore i stället för PITR, docker exec-verktyg, storage-bytes ingår inte, främmande tenant skapad via SQL-fixture. Se status.json checklistDeviation.
- CUSTODY01.02: NOT_APPLICABLE, beslut från koordinering pending.

## Harness och miljö
- ECR och Docker Hub-gränser: images hämtade från ghcr.io (digests i evidence/image-digests.txt). GreenMail-jar greenmail-standalone-2.1.8.jar: sha256 332bfed79603101308927a951c4b56e89798edf614ed354a927ac9099e8ab4e4, sha1 c5debf724f179eb872c3a41f8ba395d97216b334 (= Maven Central enligt greenmail-jar-hashes.txt).
- Harnessfel rättade: CRLF vs LF i custody01-01 (033af0d86); stale triggernamn, egen kopia av fakturafil-fixturen utan stray ")" och plattformsobjekt klassade (0a9a0ef39); warnings som fel (enligt uppdraget, ingen commit-referens). Triggers omdöpta i harness; 05 jämför 1704=1704 i återställd databas.
- FINDING-001-scenariot tillkom i 84a3e6883.

## Varaktigheter (report.json, ms)
- CUSTODY01.02: totalt 339 (vitest). Steg 2.83, 153.67, 177.54, 0.36.
- CUSTODY01.03: setup 10983.93; (a) 405.77; (b) 49.70; (c) 169.26; append-only 566.47; vitest 12181.
- CUSTODY01.04: setup 11967.18; negativt 1948.24; positivt 2683.98; låsta objekt 166.77; vitest 16770.
- CUSTODY01.05 (20261030T205347Z-978720, report.json steps[].durationMs; observations.json): pg_dump-steg 3778.71 (observation 2691); pg_restore-steg 13659.53 (observation 13527); per tabell 520.37; consistency 698.92; skydd/triggers 1063.03; health 854.2; främmande körning startsteg 1067.58; vitest 22.68 s (log.txt).

## Öppna observationer (ej klassificerade, inga fynd)
- CUSTODY01.03 setup-logg: "ediel_message_inbound_email_tenant_mismatch" (23514) vid skapande av inbound ediel_message. Mailbox companyId null. Ej klassificerat: produktfel eller fixtureartefakt.
- CUSTODY01.03 inbound-cron: failedJobs 1, errorsByMailbox "Okänt pollingfel.".
- CUSTODY01.05 health (20261030T205347Z-978720): 54 prov, samtliga HTTP 503, max 36 ms, p95 5 ms (health-samples.json; observations.json health_informational). 503 är avsiktligt före all DB-åtkomst (app/api/internal/system/health/route.ts:41-43) och säger inget om DB-hälsa. Runnern räknar failures=0.
- CUSTODY01.02 schema: runnern rapporterar kolumnen public.ediel_certificate_directory_cache.diagnostics. Motiveringen nämner den inte.
- CUSTODY01.05 (20261030T205347Z-978720): empty_custody_tables_count 36 (observations.json; compare.emptyCustodyTables 36). Deras jämförelse är 0=0 utan innehållsbevis.
- CUSTODY01.05 (20261030T205347Z-978720): främmande körning 143/143 ok, 0 fel, maxOpMs 85, p95 14, overlapDump 21, overlapRestore 109 (foreign_summary). Konsistenskontroller: 10 block identiska, 0 rader på båda sidor; visar att frågorna körs mot det återställda schemat, inte innehållet. Drift (trigger-matad, exkluderad från exakt jämförelse, bounds): gridex_correction_process.facts 2303 ≤ 2311 ≤ 2355 och public.customer_operation_tasks 646 ≤ 649 ≤ 672.
- CUSTODY01.05 migrationsstatus: applied-migrations.tsv var tom vid körningens slut (finishedAtUtc 2026-10-30T20:54:10Z, enligt uppdraget); migration 20261030131200 registrerades 2026-10-30T20:54:26Z efter körningen (evidence/fix003/applied-migrations.tsv, sha256 aaf66a43ea96a9bdab289087a4af73d422e9929d79f714049ba1e86f4a844697).

## Avfärdade misstankar
- Inga i denna packet.

## CUSTODY01.01 – overlay-körning 20261030T211803Z-36bbd8 (state PARTIAL, ej PASS)
- Packet: runs/t6r1/claude-track6/CUSTODY01.01/status.json. Miljö: SIM_HOME /home/user/sim-home/track6-overlay, RUN_DIR /root/sim-run/track6-overlay2, appCommit da20086f5 (= origin/main 614b1926 + track6-harness + donorhunkar i lib/inbound-mail/edielInboundProcessor.ts). run-identity.json: changedPathsOutsideSimulationAndQuality ["lib/inbound-mail/edielInboundProcessor.ts"], appCodeEqualsBase false. Overlay ej mergad.
- Donorhunkar d74cf9942→560e3c597 och 7d8fefb51→da20086f5 från finance c400f695; processordiff sha256 22007380fe86b7e49cf65ab1d7852c10eac7363d0e123882d7ab2640532f8a55 (63 rader). Rapporterat av orkestratorn, ej omräknat här.
- Ny ren replay: replay-commit da20086f5, fingerprint/schemaHash 5168f69b67b1e45168ef327ecf92efec6dc7bcd9dc2cf66f48f4ea96527c782c (innehåll i fingerprint-filen), replay-at 1793394878, applied-migrations.tsv 0 byte.
- Resultat: vitest 8/8, steps 8/8 passed, exit 0 (report.json steps[].status).
  - HTTP-cron (normal ingång): after mails 25, edielMessages 25 av 28.
  - Ersättningssteg med aktör: poll fetched 28, stored 3, deduped 25, errorsByMailbox "Okänt pollingfel." (klass track4/6). Reason "HTTP-cron gav 25 av 28 ediel_messages".
  - 28 ediel_messages med raw_payload sha256 == manifest .edi (steg 6 passed); body_sha_mismatches []; stored_body_final_crlf_trimmed 28 av 28.
  - tenant_mismatch i log.txt: 0 rader.
  - Nedströms: contracts, supply_periods, billing_underlays, customer_invoices, underlay_bindings, normalized_metering_values = 0 före och efter; generate-underlay 2026-10 ger sourceRows 0, underlays 0.
- Öppen observation, ej avgjord: orkestratorn uppger 56 ediel_messages för tenanten. report.json anger edielMessagesAfter 28 och cron-after edielMessages 25; 56 är inte verifierat här. Eventuellt inkluderas genererade utgående kvitton (ej verifierat).
- Oracle CUSTODY01.01 (all-systems-scenarios.safe.json rad 544, commit 27862b90, sha256 96518c184c240dafa5890df8f6b375b0730acd90f0e97d8f39063fb68c329df3): "Alla28 fakturakällor återfinns via frysta referenser". Orkestratorns brief skrev "Alla 28"; orakelfilen saknar mellanslag. Ej nått: kedjan till låst faktura.
- Varför inte PASS: (a) overlay ej mergad (track4/4-donor); (b) 3 av 28 endast via ersättningssteg, cron-batch 25 plus generiskt pollingfel; (c) kedjan till låst faktura blockerad på main av track6/004 (ready underlag avvisas 23514) och track1/010 (underlag timeout vid 2688 värden, orkestratorns uppgift); (d) ingen supply-/contract-fixture för tenant 16712.
- Nästa åtgärd: efter merge av track4/4-donor, 004 och track1/010 köra om med supply-fixture och full kedja till låst faktura. Ingen körning gjord här.
- Huvudvarianten (main 6454d540), originalfelkvitto, superseded av CRLF-orakelfixarna 033af0d86 och 6d4603141 (båda finns i repo):
  - 20261030T161714Z-952f60: exit 1, vitest 5/8. log.txt: 28 rader "ediel_message_inbound_email_tenant_mismatch" (code 23514). Cron before/after mails 0, edielMessages 0. Ersättningssteg: "28 mail lagrade: expected +0 to be 28". Ingen ediel_message skapad.
  - 20261030T162427Z-bd6f92: exit 1, vitest 5/8. body_sha_mismatches 56 poster (CRLF-klass, t.ex. "inbound/e66-001.eml: body sha256 41c8c211… != manifest a4b612a6…"). Cron before mails 28, after mails 28, edielMessages 0. log.txt: 0 tenant_mismatch-rader.
  - Obs: orkestratorns brief säger att 952f60-cron lagrade mail men skapade 0 ediel_messages. report.json visar 0 mails för 952f60. Den beskrivningen gäller i stället 162427Z (ej verifierad tolkning av mails-räknaren).
- T3-ursprung: import commit 01d97c27ec73544f6c303936fadf4cb73a5e25dc (finns i repo), manifestSha256 d2e0f795d68d07c8362309c1e412d88357b28c4a00ed1b7eaa7840e47dd2594d, 56 filer (28 par .eml/.edi) enligt report.json. "184/184 verifierade" är orkestratorns uppgift, ej verifierad här. Kohort B producerad med ej mergad #949 (beroende).
- Smoke-körningen 20261030T211758Z-0e8acf (scenario smoke, exit 0) är inte del av utfallet.

## DELIVERY01 – BLOCKED av finance-samordning (004), ej PASS
- Packets: runs/t6r1/claude-track6/DELIVERY01.01 … DELIVERY01.05/status.json. Alla state BLOCKED, executionScope ISOLATED_NATIVE (attempted).
- Körningar (report.json, exit 1 i alla): 20261030T161447Z-a24101 (summer-DST-gate: billing_gate_qualified_supply_source_required i setup C1–C4, relaterad till 001); 20261030T162009Z-f58e37 (gap/needs_review: DELIVERY01.04 C4 "blocker code in underlay row", status pending); 20261030T163400Z-c673e2 (UTILTS_MESSAGE_DATE_INVALID "Ogiltigt meddelandedatum", DTM+137 framtida datum, harnessfix); 20261030T163703Z-9c7deb (setup C1–C4 nådde generate-underlay, HTTP 500 billing_underlay_generate_failed, 4 av 4; nuvarande blockerare 004).
- Blocker 004: 946c56630 är ancestor av c400f695 men inte av origin/main (614b1926d), verifierat med git merge-base. "adopted by T4" gäller T4:s overlay, inte main.
- Scenariofil scripts/simulation/track6/scenarios/delivery01.test.ts finns i repo och i RUN_DIR. "Redo att köras om efter 004-merge" är orkestratorns påstående; ej kört här.
- Harnesshistorik: c673e2 (DTM+137 framtida datum) klassas enligt brief som harnessfel och är rättad i harnessen (commit ej angiven). Gap/needs_review i f58e37 och a24101-gatefelet är observationer, ej klassade här; a24101 kopplas till 001.
- Obekräftad kandidat (ej fynd) DELIVERY01.03: lib/billing/nordfinInvoiceXml.ts:79 skriver `el('Delivery', row.email ? 'EMAIL' : 'PRINT')`. Om en e-postadress finns skrivs EMAIL, även om fakturan är markerad som papper. Ej runtime-bekräftad. Enum i lib/pricing/commercialModel.ts:56-61 och DB-check i supabase/migrations/20260729200000_contract_commercial_selection_completion.sql:181 innehåller paper.
- Obekräftad kandidat (ej fynd) DELIVERY01.04: readiness-koderna emitteras i lib/billing/billingReadiness.ts:194, :210, :268 och nås via evaluateBillingMonthInvoiceReadiness (lib/billing/invoiceReadiness.ts:299). Enda anropare i git grep på 614b1926 är lib/integrations/billing/invoiceExportCore.ts:53. Nordfin prepare→approve→file-vägen anropar den inte. Ej runtime-bekräftad. Orkestratorns referens "endast i invoiceReadiness.ts:299" är inte helt korrekt, eftersom koderna emitteras i billingReadiness.ts.
- Notering till 004 (ändrar inte 004-texten): sha256 för sim-home/track6/logs/app.log är nu 92f4d8dfc88bab1da3db244d2167e71008c996504851ef30e24e1c3aa9f5a66d. 004-evidensen anger 65e4eebdde484c157911e3f3e50cfceff32656d7bf38f55e2b336e191abff054. Loggen är muterbar; hashen behöver omräknas i nästa 004-uppdatering.
- DELIVERY01.05 kodgenomgång (ingen normal ändringsväg efter godkännande) är orkestratorns uppgift, ej verifierad här.
