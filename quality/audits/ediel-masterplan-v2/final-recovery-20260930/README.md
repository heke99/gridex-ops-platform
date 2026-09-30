# Avgränsat rättelsepaket och fortsättning — 2026-09-30

Detta paket rättar återfunna runtime- och verifieringsfel på den isolerade kandidaten. Det avslutar inte masterplan v2. Fortsättningsuppdraget omfattar hela F0–F7 och alla 352 ursprungliga ID:n; läs NEXTCHAT.md.

## Ägarskap och utgångspunkt

Kandidaten isolerades från lokal bas `860feb10644a2b0c89452a4aff65359fc2187724`, tree `4631fa302f32d89960a1401e619c7da1e2ed6874`, till `codex/ediel-final-recovery-20260930`. Åtta befintliga ändringar säkrades byte- och hashkontrollerat före egen implementation. Andra aktiva arbetsrötter, deras commits, opublicerade ändringar och PR-refar #421/#423 har inte skrivits över. Ingen force-push, merge, produktionsmigration eller extern kommunikation utfördes.

`verification.json` anger fryst runtimecommit/tree, faktisk verifiering och senare separat dokumentpublicering. Paketets publika artefaktbranch har annan runtime-bas; dess gröna status får inte tillskrivas koden i den medföljande runtime-bundlen.

## Ändringar

- Fullständiga typade source-/permission-fixtures, bevarad strukturell predecessor-data och tenantbundna operativa uppslag.
- S02:s egna obligatoriska LOC172/209 och QTY135/515 i båda guiderna. NULL för planerad energi kräver egen föreskriven status; noll är separat. Negativ ERC42 använder eget felaktigt mottaget innehåll, och tom LOC239 ger ingen ogiltig tom ERC42-dubblett.
- Lossless parsergrind accepterar canonical original-token consumer och förbjuder dubbel avkodning. VM-harness får verkliga rena XML/objektjämförelsefunktioner och behåller hårda externa I/O-gränser.
- Fresh ACK konsumerar skyddad låst originalkälla och objektbunden source-kvalificering före write. Altererat original och saknad source-basis blockeras.
- Redan accepterat transportkvitto återläses och projektion repareras utan andra SMTP-anrop. Det beständiga kvittots tid återanvänds; saknad tid blir fail-closed. Business expectation binds före provider/prepare och registreras efter faktisk observation.
- PRODAT legacy-mätarfel projiceras från egna fysiska fält. Reader-/processor-/RPC-fixtures använder aktuella named witnesses och bevarar tenant-/resurs-/raw-/hash-assertions.
- Z04 native-fixture använder fysiska ACK-payloads och separat committad, autentiskt validerad syntaxfacet före skyddad technical capture. Framåtmigration `20260930213117` återställer endast CONTRL:s tillåtna tomma application namespace, normaliserar tom application och vägrar saknad fysisk family.

## Evidensgränser

Embedded PostgreSQL-verifieringen laddar de aktuella verkliga SQL-ägarna i en privat PGlite-databas. Den använder utvalda autentiska DDL/ägare och en inbyggd SHA256-ersättning för pgcrypto; ovidkommande FK/policies utelämnas. Det är avgränsat funktionsbevis, inte tomdatabas-/uppgraderingsreplay, PostgREST/RLS eller Supabase-native godkännande.

Den riktiga Z04 psql-fixturen committar endast tydligt markerad syntetisk source-/aktörssetup och den riktiga syntaxfaceten i en disposable lokal CI-stack. Den beständiga syntetiska setupen finns kvar till stackens borttagning; ACK/outbox/bevistransaktionen rullas tillbaka. Den fasta loopback-handoffvägen har inte exekverats här, eftersom Docker, psql och Supabase CLI saknas.

Oupplösta UNH-guidefall ger strukturerad oförseglad diagnos och säker hold. Ingen nationell ACK eller beständig marknadseffekt kvalificeras av dessa diagnostiska prov.

## Kvarstående interna grindar

1. Integrera #421-ägarens senare käll-/aktörs-/runtimearbete. ACK-dubblettsökning i denna bas ligger före skyddad originalkontroll och saknar tenant-/miljöfilter; replay måste få aktuella behörighets- och originalbevis.
2. Verklig fresh transport behöver skyddad `sourceRulePackEvidence` respektive `technicalSyntaxAckEvidence` i binding till aktuell native prepare/enter. Befintliga SQL-grindar vägrar därför dessa ofullständiga portar före SMTP; våra transportdoubles kvalificerar inte native fresh send.
3. Blandad PRODAT partial-orchestration saknar eget outcome för ett obehandlat syskonobjekt. Verklig ACK-validator blockerar ofullständig BGM34. Paketet bevisar safe hold och giltig one-object negativ ACK/retry; hela mixed-object-funktionen återstår att implementera utan påhittad success.
4. Kör autentisk clean replay, upgrade, psql-producerhandoff, native/PostgREST/RLS och generera typer/schema/fingerprint från exakt samma slutkandidat. Typmanifestet är genuint stale och har inte handändrats.
5. Integrera opublicerad `codephase-20260930/FINAL_TEST_PHASE.md` genom dess nuvarande ägare. Frys sammansatt runtime/DB/UI/API; avsluta build, browser, säkerhet, kontraktsparitet och exakt-head CI innan helkriterieacceptans.

## Migration och kompatibilitet

En ny CREATE OR REPLACE-framåtmigration med registrerad checksum; historisk `20260930192030` är byteoförändrad. Ingen produktion kördes och ingen data-backfill behövs för funktionsrättningen. Existerande funktionsägare/ACL, P-APERAK-regler, tenant- och kollisionsgrindar behålls. Produktionsrollback ska vid behov göras som en separat granskad kompensationsmigration; skriv inte om historiken och återinför inte den kända namespace-regressionen.

## Fortsättning

Använd NEXTCHAT.md som komplett implementationsprompt. Återanvänd verifierade paket, jämför alltid mot senare kod och respektera ensam ägare. T01–T55/U01–U20 och #418/#422 är ett separat bevarat tenantservice-initiativ; #310 förblir pausad. Originalregister och acceptansstatusar är oförändrade.

## Fryst kod och faktiskt slutresultat

Runtimecommit `ed3f5159ba52a81ff7cdf877bf3302205540b0b8`, tree `90db37a96248771520b62e522b2a717e9a4a4334`: 66 ägda filer, 1 901 tillagda och 325 borttagna rader. Alla 66 SHA256-värden i source-files.json kontrollerades efter slutkörningen. Inga runtimefiler ändrades efter frysningen.

| Kvitto | Faktiskt resultat |
|---|---|
| Full unit | 7 176/7 176; 481 testfiler; 0 fail/skip; exit0 |
| Quality | 45/45; exit0 |
| Node-prov | 1 179/1 179 körningar; 12 exekveringar, inkl tre TZ; exit0 |
| App/test/script TypeScript | Samtliga exit0, seriellt |
| Lint | 56 ändrade TS-filer exit0; hela repots lint ej körd |
| Ändrade CJS/MJS | Syntax exit0; CJS omfattas inte av repo-ESLint |
| Embedded SQL | Namespace69 och durableACK19 PASS; båda exit0 |
| Integrity/mekanisk/migration/service-role | PASS; 713 migrationer/617 versionsgrupper |
| Genererade typer | Exit1: genuint stale, väntar autentisk replay |
| Build/browser/full native/exakt runtime-head CI | Ej körda här; kvarstående slutgrindar |

De två CJS-harnessarnas tvingade lint ger samma 16 fel och 2 varningar som historisk bas; det är ingen ny lintregression och inte ett lintgodkännande. En parallell app-typkontroll kraschade tidigare med137; den seriella slutkörningen passerade. Diagnostiska äldre röd-kvitton bevaras i evidensarkivet.

## Portabel återstart

`recovery.patch.gz.b64` innehåller endast rättelsecommiten och kräver kompatibel aktuell bas. `portable/manifest.json` beskriver en full verifierad Git-bundle med kod och dess ännu opublicerade föregångare; endast den redan publicerade main-commiten53bf är prerequisite. Bundlen skapades före dokument/minnescommiten, så dess head är exakt den testade koden. Importera den till en egen gren utan att flytta #421/#423 eller en annan ägares branch.

Läs manifestets parts i ordning, kontrollera varje delhash, sammanfoga base64-text och avkoda. Kontrollera decoded bundle SHA256, kör `git bundle verify`, och importera med `git fetch <bundlepath> refs/heads/codex/ediel-final-recovery-20260930:refs/heads/<egen-importgren>`. Jämför därefter runtimecommit/tree med verification.json. Cherry-picka rättelsen till aktuell isolerad integrationskandidat efter ägar- och konfliktkontroll; bundlens senare bas får inte ersätta ännu nyare ändringar.

`evidence-files.json` anger samma procedur för gzip/tar-evidensarkivet, samt varenda logs bytes/hash. Arkivet bevarar 76 kvitton utan att göra gamla resultat till färska. PR421/423:s senaste observerade604e-/0b8c-heads ändrades inte av detta paket. #422 hade under arbetet gått vidare till4b7888a; den bevarades.

Patch och exakt Git-importkvitto är losslessly kodade för att undvika att formatpatchens obligatoriska tomma kontextrader/flutrad eller originalkvittots blanksteg ger dokumentdiff-fel. Avkoda patchens base64, dekomprimera gzip och kontrollera decoded SHA256 före `git apply --check`. Ett separat tempindex bevisar att patchen applicerad på860feb ger exakt90db37a9. Historiskt råpaketac5da75b är oförändrat.
