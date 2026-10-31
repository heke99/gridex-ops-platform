Aktuell tilldelning enligt delegerat beslut6506143437: Claude T1/T2/T3/T4/T6/T7 (89 ID), Codex T5 (16 ID). GEN-producent: session_01UHTg8KVQcYJS5fqdU3XihA, med egen autentiserad ALL-target-ACK före write. T4 betyder Faktura, samtidighet och fil (13 ID); finance-grenen används endast som referens. Originalfilen är återhämtad och hashverifierad; historiska orakel kräver fortfarande kvalificering för aktuell fixture och kodversion.

# Findings och status – obligatoriskt för varje arbetare

Använd ett unikt run-id och en egen packet: `runs/<run-id>/<worker-id>/<scenario-id>/`. Exakta skrivclaims avgör om packet ligger i detta repository eller i separat privat evidenslagring. Skicka en säker manifestreferens till integratören och PR930. Formella claims/handoffs behåller repositoryts aktuella protokoll och historiska #840-kvitton. Rådata, cookies, tokens, nycklar och verkliga personuppgifter ska inte publiceras i det offentliga repositoryt.

## FINDINGS.md

Varje fynd får ID `<campaign>/<worker>/<löpnummer>`, scenario-ID:n, datum, utförare och kategori: produktfel, prestanda, testharness, miljö eller ännu obekräftad Source-kandidat. Ange:

- exakt appcommit, build/overlay, migrerings-/schemahash, Node/PG-version och miljöresurser;
- förutsättningar, syntetiska indata, faktiskt kommando och förväntat kontra faktiskt utfall;
- reproduktionssteg, exitkod, HTTP-status, relevanta DB-/Storage-/köeffekter, logg-/artefaktref + SHA256;
- bedömd påverkan och allvar, vad som faktiskt är observerat och vad som är hypotes;
- eventuell rättning med fil-/commitreferens, relevanta tester, omtest och kvarvarande begränsningar;
- dokumenterade ersättningssteg och vad de inte verifierar.

Ett fynd går från observerat → styrkt/avfärdat → prioriterat → rättat-väntar-omtest → verifierad-rättning. Dokumentera avfärdade misstankar och verktygsfel separat; gör inte ett Source-sökfel till produktbugg. Originalförsök och kvitton får inte döljas av senare PASS.

## Mät vad som är segt

Separera appens svarstid, DB-fråga, väntan på kö/backoff, kall Next-kompilering och testverktygens overhead. Ange workload, råa varaktigheter, antal prover, warm/cold, minne/CPU och jämförelsebas. P95 kräver redovisat urval och beräkningsmetod. En timeout eller en enda kall start bevisar inte en generell produktionsflaskhals. Dokumentera först uppmätt observation; bekräfta orsak före optimeringspåstående.

## status.json

Varje packet anger minst: scenarioId, workerId, model, baselineCommit, appCommit, patch/overlayrefs, environmentId, databaseIdentity, schemaHash, clockModel, startedAtUtc, finishedAtUtc eller heartbeatAtUtc, state, executionScope, command/evidence refs, findingsIds, blocker, nextAction och cleanupReceipt.

Tillåtna state: NOT_RUN, RUNNING, BLOCKED, PARTIAL, FAIL, PASS. executionScope anges separat: SOURCE_ONLY, COMPONENT, ISOLATED_NATIVE, BROWSER_E2E eller EXTERNAL_ACCEPTANCE. PASS utan verifierade scenarieorakel och kvitto godtas inte i central sammanställning. Inte körda uppgifter har inte PASS. En Source-modell ger aldrig BROWSER_E2E. En saknad mätning anges som saknad, inte som noll.

## Samla och rätta

Varje arbetare lämnar sin packet samt en säker kortstatus i PR930 och fortsätter med nästa lediga ID inom sin scope. En integratör deduplicerar fynd efter rotorsak och sammanställer fel, prestanda och omteststatus i samma PR. Befintlig aktiv filägare får fyndet för adoption eller ger en exakt överlämning före kodändring.

Prioritera först tenant-/dataintegritet och felaktiga affärsutfall, sedan blockerande funktionsfel och uppmätta flaskhalsar. Rättningar ska ha verifierbart före/efter-underlag och relevanta positiva/negativa regressioner. Efter integration körs påverkade beroendefall och slutkedjan på dokumenterad slutversion; oförändrade tester återanvänds endast med tydlig tillämplighet. Merge/deploy följer befintlig leveransprocess.
