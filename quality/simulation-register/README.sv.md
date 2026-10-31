Aktuell tilldelning enligt delegerat beslut6506143437: Claude T1/T2/T3/T4/T6/T7 (89 ID), Codex T5 (16 ID). GEN-producent: session_01UHTg8KVQcYJS5fqdU3XihA, med egen autentiserad ALL-target-ACK före write. T4 betyder Faktura, samtidighet och fil (13 ID); finance-grenen används endast som referens. Originalfilen är återhämtad och hashverifierad; historiska orakel kräver fortfarande kvalificering för aktuell fixture och kodversion.

Custody enligt beslut6506056163: A gäller endast nya egna filer under scripts/simulation/trackN/** och egen runs/<run-id>/<worker-id>/**: egen gren plus kvitto i PR930 före första push och kontroll av claims/öppna PR före skrivning. B gäller befintliga delade filer: exakt godkänd CLAIMPLAN (B), Codex som proxy, därefter arbetarens egen autentiserade fulla ref-/receipt-readback före write. Ingen token delas. GEN förblir ensam producent enligt6506303596.

# Gemensam simulering – börja här

Operativ samordning sker i [PR #930](https://github.com/heke99/gridex-ops-platform/pull/930). [#840](https://github.com/heke99/gridex-ops-platform/issues/840) behålls som historik, länkpunkt och för befintliga claim-/handoffkvitton. Vi skriver inte konkurrerande statuslistor i två ärenden. Repositoryts AGENTS.md och atomiska reservationsprotokoll gäller fortfarande; en kommentar eller teamtilldelning ersätter inte en skrivclaim.

Den enda uppdaterbara statuskällan är [register.safe.json](register.safe.json). Detta är en offentlig, säker projektion av det granskade underlaget, inte råa loggar, secrets eller privata runtimefiler. Äldre detaljerade auditfiler är bevarade separat. Inga tidigare körresultat har raderats eller omvandlats till nya PASS.

## Sju spår, 105 unika design-ID:n

| Spår | Samordningsägare | Område | Antal |
|---|---|---|---:|
| 1 | Claude | MAIN03.01–05; MAIN04.01/.03/.04; SITE01.01–05 | 13 |
| 2 | Claude | TERM01.01–05; TERM02.01–08; TERM03.01–05 | 18 |
| 3 | Claude | EDIEL01.01–06; EDIEL02.01–06; EDIEL03.01–05 | 17 |
| 4 | Claude | MAIN04.02/.05; BILLNEG01.01–05; MAIN05.01–06 | 13 |
| 5 | Codex | EVENT01.01–05; AUTH01.01–06; API01.01–05 | 16 |
| 6 | Claude | DELIVERY01.01–05; CUSTODY01.01–05; MAIN06.01–03 | 13 |
| 7 | Claude | UI01.01–05; QA01.01–05; QA02.01–05, sist på slutversionen | 15 |
| Totalt | Codex16 / Claude89 | inga dubbla eller saknade ID:n | 105 |

Ägarskapet ovan gäller scenarioarbete. Det tar inte över aktiva filer, befintliga producentroller eller main-leveransägaren. EVENT har befintlig CODEX-EVENTS-ägare och sparade resultat. Samordna de övriga11 Codex-ID:na separat och verifiera befintliga claims före skrivning. Befintliga aktiva Claude-spår behåller sina egna filer; denna fördelning är ingen blankoöverlämning.

## Gemensam kodbas och rena PR:er

Applikationsbasen är commit `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`. Läs dokumentationen från PR930:s aktuella head; appkoden i denna dokumentations-PR är oförändrad mot basen. Alla arbetare noterar sin exakta checkout och eventuella fixer/overlays. En integratör uppdaterar PR-grenen seriellt; varje arbetare lämnar egna fynd-/statuscommits från egen gren/worktree. Claude kan alltså uppdatera per-ID-status genom granskade commits utan att flera sessioner pushar samtidigt till samma gren.

Produktfixar lämnas som små, avgränsade PR:er till main med findings-ID, regression och omtest. Ingen hel gammal simuleringsgren slås in. När integrerade fixar ändrar applikationsbasen binds nästa körning till en ny uttrycklig bas och gamla bevis bedöms för tillämplighet.

Finance-referensen `finance/simulation-handoff-20261029-5f5cfa20` är pinnad till `c400f6959d8c279fb518b7199fe6e77da30409c4`. Jämförelsen mot basen visar353commits enbart på donatorgrenen och249enbart på main. Använd den som underlag för granskade exakta patchar, inte som gemensam körbas eller som helgrensmerge. Äldre siffror i designbeskrivningarna är historiska orakel som måste kvalificeras för respektive aktuella fixture.

## Dokumentation och verifiering

Alla arbetare skriver FINDINGS.md och status.json per scenario enligt [rapporteringskraven](../simulation-campaign/20261029-3f1a8ab1/REPORTING.sv.md). Logga fel, misslyckade försök, miljö-/harnessproblem och uppmätta tider. Märk Source-modell, riktig nativekörning, browserflöde och extern acceptans separat. Samla, deduplicera och prioritera först; rätta sedan avgränsat och behåll både före- och efterkvitto.

Kvitto per ID innehåller kodcommit/build/overlays, migrations-/schemahash, miljö- och DB-identitet, faktiskt kommando, logg-/artefaktref med SHA256, native före/efter och begränsningar. PASS kräver de faktiska oraklen, inte bara grön exitkod. Hemliga värden och privata råloggar publiceras inte i GitHub. Råa miljöfiler kopieras inte mellan agenter.

## Isolering och beroenden

En egen DB/Auth/Storage/kö/mailmotpart/portuppsättning per arbetare och en utsedd muterande aktör per miljö. Ingen mutation i Roots befintliga databas och inga två nativesviter mot samma DB. Kontrollera kapacitet innan flera servrar startas; sju spår innebär inte sju obegränsade samtidiga stackar. Auth och VM måste verifieras på nytt; gammal miljö eller utgången session är ingen tilldelning.

Spår1 skapar/godkänner det som spår4 testar repeats och export för. De använder separata fixtures i egna DB:er; en senare normal integrationskörning samlar flödet utan att slå ihop deras databaser. Spår2 delar pris-/avtalskod med1/4; spår5:s API delar kunddomän med1; spår6 behöver låsta original från1/3 och XML från4. Spår7 körs sist på exakt integrerad slutversion. Handoff sker med bevis och exakta filägare, inte genom samtidiga skrivningar i samma filer.

## Öppet EVENT-handoff

I denna session finns inte originalbytes för migrationen20261028140000 och dess test, och ingen EVENT-miljö är tilldelad hit. Befintlig producent ombeds publicera exakt tvåfilsändring i egen gren/PR med base/head/tree, filhashar och körbevis. Originalet får inte rekonstrueras ur en beskrivning. Inga migrations- eller main-mutationer är gjorda genom denna dokumentation.

Startprompt för Claude och Codex finns i [PROMPTS.sv.md](../simulation-campaign/20261029-3f1a8ab1/PROMPTS.sv.md).

## GEN, claims och originalunderlag

[Beslut om fördelning](https://github.com/heke99/gridex-ops-platform/pull/930#issuecomment-6506143437) och [GEN-kvitto/avgränsad handoff](https://github.com/heke99/gridex-ops-platform/pull/930#issuecomment-6506303596). GEN köar #932 först och lämnar en liten PR mot dess gren. Codex T5 anmäler GEN-behov i samma kö. Proxyclaim ger inte ny körningsacceptans.

[Återhämtat exakt original](oracles/all-systems-scenarios.safe.json): 41 736 byte, SHA256 `96518c184c240dafa5890df8f6b375b0730acd90f0e97d8f39063fb68c329df3`. Originalet bevaras byteexakt som historiskt DESIGN_ONLY. Dess gamla exekveringsordning, Root-GO och miljöbindningar är historik; aktuell kampanj styrs av färska beslut och egen kvalificering. Beloppet1809,51 SEK gäller bara motsvarande kvalificerade fixture, inte godtyckliga nya kunder.
