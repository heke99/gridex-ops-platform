# FINDINGS – claude-track6, kampanj 20261029-3f1a8ab1, körning t6r1

Status: utkast från claude-track6 för integratörens granskning. Inga state- eller PASS-ändringar gjorda här. Filen lever i runs/t6r1/claude-track6/ och ersätter inget tidigare kvitto.

## Gemensamt för packeten
- Utförare: claude-track6 (model: claude (session_01UHTg8Hora3xtZg4oHMrcGi)). Datum: 2026-10-30 (UTC).
- baselineCommit 1c0c088cb4ed66d0dd8b3e34c9606019342a1a56. appCommit 6454d540b6978a9c25434b8c66bcd7a0e335c99c (main enligt uppdrag). Lokal main är 0535e618f; 6454d540 är inte ancestor av den (rc=1). Faktisk remote-main är inte verifierad här.
- Harnessbygge 7afacc78 (commits.json). Harness-RUN_DIR-commit: 84a3e6883 (FINDING-001, CUSTODY01.03/.04/.05), 4d67fa7c2 (CUSTODY01.02). git diff --name-only 6454d540..7afacc78 utanför scripts/simulation/track6 är tom, så appkoden är oförändrad. overlay: claude/sim-20261029-track6, appCodeChanged false.
- Miljö: environmentId t6-local-20261030. Lokal Supabase 127.0.0.1:54322, replay 1e0a29bc04cc168e135f86b7ab955805073a107b, fingerprint/schemaHash 5168f69b67b1e45168ef327ecf92efec6dc7bcd9dc2cf66f48f4ea96527c782c (partiell identitet). applied-migrations: 0 rader.
- Postgres: ghcr.io/supabase/postgres:17.6.1.155 (digest i evidence/image-digests.txt). Node-version: saknas i kvitton (MISSING).
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
- Rotorsak: `ediel_read_invoice_file_source_v1` väljer op via `permission_v1(c,actor,'ediel.retention.read')` (supabase/migrations/20261001071000_ediel_invoice_file_copy_class_retention.sql:107); `permission_v1`:s `retention_keys` (20261001000710_…sql:13) saknar `ediel.retention.read` → op blir `ediel.retention.review` → actor_v1 nekar. `invoice_file_actor_v1` har redan en read-gren som aldrig nås.
- Rättning: kräver migration (RÄTTAD-VÄNTAR-GEN); ägarskap och version väntar på samordningens beslut.

## Ersättningssteg och avvikelser (sammanfattning)
- CUSTODY01.03: ERSATTNINGSSTEG motor med aktör (runIntakeWithActor). Se status.json replacementSteps.
- CUSTODY01.04: ERSATTNINGSSTEG route i testprocess med mockad klient. Se status.json replacementSteps.
- CUSTODY01.05: avvikelse från docs/backup-restore-checklist.md: pg_dump -Fc och pg_restore till ny databas på samma server (docker, host major 16, server major 17). Ingen PITR eller nytt projekt. Storage-bytes ingår inte. pg_restore exit 1 med 3 plattformsfel accepterades. Se status.json checklistDeviation.
- CUSTODY01.02: NOT_APPLICABLE, beslut från koordinering pending.

## Harness och miljö
- ECR och Docker Hub-gränser: images hämtade från ghcr.io (digests i evidence/image-digests.txt). GreenMail-jar greenmail-standalone-2.1.8.jar: sha256 332bfed79603101308927a951c4b56e89798edf614ed354a927ac9099e8ab4e4, sha1 c5debf724f179eb872c3a41f8ba395d97216b334 (= Maven Central enligt greenmail-jar-hashes.txt).
- Harnessfel rättade: CRLF vs LF i custody01-01 (033af0d86); stale triggernamn, egen kopia av fakturafil-fixturen utan stray ")" och plattformsobjekt klassade (0a9a0ef39); warnings som fel (enligt uppdraget, ingen commit-referens). Triggers omdöpta i harness; 05 jämför 1704=1704 i återställd databas.
- FINDING-001-scenariot tillkom i 84a3e6883.

## Varaktigheter (report.json, ms)
- CUSTODY01.02: totalt 339 (vitest). Steg 2.83, 153.67, 177.54, 0.36.
- CUSTODY01.03: setup 10983.93; (a) 405.77; (b) 49.70; (c) 169.26; append-only 566.47; vitest 12181.
- CUSTODY01.04: setup 11967.18; negativt 1948.24; positivt 2683.98; låsta objekt 166.77; vitest 16770.
- CUSTODY01.05: pg_dump-steg 3212.80 (observation 2159); pg_restore-steg 15124.63 (observation 15051); compare 628.66; triggers 101.77; health 862.85; vitest 20420. Health över 49 prov: max 49 ms, p95 9 ms (runnerns beräkning, urvalsmetod ej beskriven). Warm/cold ej angivet.

## Öppna observationer (ej klassificerade, inga fynd)
- CUSTODY01.03 setup-logg: "ediel_message_inbound_email_tenant_mismatch" (23514) vid skapande av inbound ediel_message. Mailbox companyId null. Ej klassificerat: produktfel eller fixtureartefakt.
- CUSTODY01.03 inbound-cron: failedJobs 1, errorsByMailbox "Okänt pollingfel.".
- CUSTODY01.05 health: samtliga 49 prov HTTP 503. Runnern räknar failures=0. Betydelsen är OSÄKER och ej utredd.
- CUSTODY01.02 schema: runnern rapporterar kolumnen public.ediel_certificate_directory_cache.diagnostics. Motiveringen nämner den inte.
- CUSTODY01.05: 38 custodytabeller hade 0 rader i källan. Deras jämförelse är 0=0.

## Avfärdade misstankar
- Inga i denna packet.
