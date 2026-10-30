# FINDINGS – claude-track6, kampanj 20261029-3f1a8ab1, körning t6r1

Status: utkast från claude-track6 för integratörens granskning. Inga state- eller PASS-ändringar gjorda här. Filen lever i runs/t6r1/claude-track6/ och ersätter inget tidigare kvitto.

## Gemensamt för packeten
- Utförare: claude-track6 (model: claude (session_01UHTg8Hora3xtZg4oHMrcGi)). Datum: 2026-10-30 (UTC).
- baselineCommit 1c0c088cb4ed66d0dd8b3e34c9606019342a1a56. appCommit 6454d540b6978a9c25434b8c66bcd7a0e335c99c (main enligt uppdrag). 6454d540 är ancestor av origin/main (verifierat med git merge-base --is-ancestor); den inaktuella lokala grenen main saknar betydelse.
- Harness-RUN_DIR-commit: 220edef2f för CUSTODY01.03/.04-omkörningarna (bygg 7afacc78, endast harnessdiff); 84a3e6883 för FINDING-001 och tidigare CUSTODY-körningar, 4d67fa7c2 (CUSTODY01.02). git diff --name-only 6454d540..7afacc78 utanför scripts/simulation/track6 är tom, så appkoden är oförändrad. overlay: claude/sim-20261029-track6, appCodeChanged false.
- Miljö: environmentId t6-local-20261030. Lokal Supabase 127.0.0.1:54322, replay 1e0a29bc04cc168e135f86b7ab955805073a107b, fingerprint/schemaHash 5168f69b67b1e45168ef327ecf92efec6dc7bcd9dc2cf66f48f4ea96527c782c (partiell identitet). applied-migrations: 0 rader.
- Postgres: ghcr.io/supabase/postgres:17.6.1.155 (digest i evidence/image-digests.txt). Node v22.22.0, PG 17.6.
- clockModel: real UTC. executionScope: ISOLATED_NATIVE.
- Identitetsfiler (sha256): commits.json 301b3821a4d19d31af96a45e2614ff596d08a21444e973c5fdda6f5012fc883b; replay-commit 53cc4193f0ea29eeefdf082994ea72f6afdd5ca8de12c0ae4d68895c31f5256f; fingerprint 2cb1ad4a6bec22c093013eed199518bf62083cdd3007d3345ce7015bb881e839; applied-migrations.tsv e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 (0 byte); evidence/image-digests.txt 95a0dd1376143260010f25dffa87afb2b94d5bc2234023d882e0d2a0f7e4cc22; evidence/greenmail-jar-hashes.txt e819bdaef3a4a085c6aad57f327a1f005e5546e7268fbcd807920514f3e1b02d.

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
- CUSTODY01.05 (senaste körningen 20261030T204203Z-764b04, 9/9 steg passed, exit 0): avvikelse från docs/backup-restore-checklist.md: pg_dump -Fc och pg_restore till ny databas på samma server (docker, host major 16, server major 17). Restore kördes med --no-owner --no-acl (scripts/simulation/track6/lib/custody/restore.ts:57-58): grants/ägare återställs inte, RLS-policyer/grants jämförs inte i denna körning. En omkörning med ACL/ägare bevarade och skydd jämförda pågår (uppgift från uppdraget, ej verifierad här). Ingen PITR eller nytt projekt. Storage-bytes ingår inte. pg_restore exit 1 med 3 plattformsfel accepterades. Historik: äldre körningar 161811, 162702, 164432, 203633 (se status.json previousRuns). Se status.json checklistDeviation.
- CUSTODY01.02: NOT_APPLICABLE, beslut från koordinering pending.

## Harness och miljö
- ECR och Docker Hub-gränser: images hämtade från ghcr.io (digests i evidence/image-digests.txt). GreenMail-jar greenmail-standalone-2.1.8.jar: sha256 332bfed79603101308927a951c4b56e89798edf614ed354a927ac9099e8ab4e4, sha1 c5debf724f179eb872c3a41f8ba395d97216b334 (= Maven Central enligt greenmail-jar-hashes.txt).
- Harnessfel rättade: CRLF vs LF i custody01-01 (033af0d86); stale triggernamn, egen kopia av fakturafil-fixturen utan stray ")" och plattformsobjekt klassade (0a9a0ef39); warnings som fel (enligt uppdraget, ingen commit-referens). Triggers omdöpta i harness; 05 jämför 1704=1704 i återställd databas.
- FINDING-001-scenariot tillkom i 84a3e6883.

## Varaktigheter (report.json, ms)
- CUSTODY01.02: totalt 339 (vitest). Steg 2.83, 153.67, 177.54, 0.36.
- CUSTODY01.03: setup 10983.93; (a) 405.77; (b) 49.70; (c) 169.26; append-only 566.47; vitest 12181.
- CUSTODY01.04: setup 11967.18; negativt 1948.24; positivt 2683.98; låsta objekt 166.77; vitest 16770.
- CUSTODY01.05 (20261030T204203Z-764b04, källa runs/20261030T204203Z-764b04/custody01-05/report.json, steps[].durationMs): pg_dump-steg 4540.55 (observation 3419); pg_restore-steg 17229.58 (observation 17149); compare 579.96; consistency 832.29; triggers 92.79; health 957.23; främmande körning startsteg 1127.37; vitest tests 26.26 s (log.txt, Duration 26.66 s). Health: maxMs 39, p95Ms 11 (health-samples.json, 63 prov). Warm/cold ej angivet. Historik (äldre körning, utan run-id i tidigare text): pg_dump 3212.80, pg_restore 15124.63, vitest 20420.

## Öppna observationer (ej klassificerade, inga fynd)
- CUSTODY01.03 setup-logg: "ediel_message_inbound_email_tenant_mismatch" (23514) vid skapande av inbound ediel_message. Mailbox companyId null. Ej klassificerat: produktfel eller fixtureartefakt.
- CUSTODY01.03 inbound-cron: failedJobs 1, errorsByMailbox "Okänt pollingfel.".
- CUSTODY01.05 health (20261030T204203Z-764b04): 63 prov, samtliga HTTP 503 (health-samples.json; observations.json health_informational.statuses [503]). 503 är avsiktligt före all DB-åtkomst (app/api/internal/system/health/route.ts:41-43) och informativt: säger inget om DB-hälsa. Runnern räknar failures=0. Historik: 49 prov i äldre körning. OBS: uppdraget angav 88 prov; evidensen visar 63 och det är angivet här.
- CUSTODY01.02 schema: runnern rapporterar kolumnen public.ediel_certificate_directory_cache.diagnostics. Motiveringen nämner den inte.
- CUSTODY01.05 (20261030T204203Z-764b04): empty_custody_tables_count 36 (observations.json; compare.emptyCustodyTables 36). Deras jämförelse är 0=0. Historik: 38 i äldre körning.
- CUSTODY01.05 (20261030T204203Z-764b04): främmande körning 171/171 ok, 0 fel, maxOpMs 66, överlapp 27 mot dump och 132 mot restore (foreign_summary). Konsistenskontroller: 10 block identiska, 0 rader på båda sidor. Detta visar att frågorna körs mot det återställda schemat, inte innehållet. Drift (trigger-matad, exkluderad från exakt jämförelse, bounds): gridex_correction_process.facts 1347 ≤ 1357 ≤ 1409 (matad av capture_v1 från främmande körningen) och public.customer_operation_tasks 189 ≤ 193 ≤ 220. Ej verifierat: ägare, grants och RLS-policyer (se rad om --no-owner --no-acl ovan).

## Avfärdade misstankar
- Inga i denna packet.
