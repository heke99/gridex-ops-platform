# UTILTS-paketets acceptansgrindar — 2026-09-30

Aktuell kod-/bevishead `d30fa0203f0499a8e15faeddda7676af81296c86`. Fem separata oberoende kravgranskningar har läst frysta kriterier, tillämpliga original, faktisk verkställighet och verkliga konsumenter. Detta är en färsk avstämning av dessa fem krav, inte en ny semantisk certifiering av alla 121 regelkort.

| Krav / kontrakt | Återanvändbart bevis | Exakt kvarvarande grind | Teknisk ägare |
| --- | --- | --- | --- |
| U-02 / AT-U-02 | Fysisk huvud/IDE/SEQ-projektion; 27 S02-native inklusive egna LOC172/QTY135, agency89-hold, positiv kontroll, atomicitet och retry på sluthead. | Andra tillämpliga profilers egna upprepade grupper och åtskilda reading/energy behöver komplett kontraktsmatris. `utilts/profiles.ts` har bredare fallback till globala fakta; detta är en källgranskad kandidat utan nytt native-motexempel. | CALL-09 `canonicalEdifactAst`/`canonicalObservationScope`, CALL-11 profilvalidering; CALL-13 fysisk SQL-bindning. |
| U-03 / AT-U-03 | Guide före funktion på varje IDE; SC-044 fullständigt PASSED; S02-nationella fältfel går före funktion. | Direkt operativ konsument behöver faktisk native-syntaxvägran för fel UNT. Huvudfel behöver ett meddelandesvar utan ACW och utan efterföljande funktion; idag pekar koden på per-IDE-svar. Full grammatik kan inte godkännas av en enda UNT-kontroll. | CALL-11 `runUtiltsRuntimeForMessage`/canonical dispatcher → `processInboundUtiltsMessage`; CALL-12 ACK-planning. |
| ACK-03 / AT-ACK-03 | Verkliga positiva och transaktionsnegativa U-APERAK med D04A/E5SE5A/BGM312/313 och fysiska ACW i S02/SC-044. | Native huvudnivå utan ACW; blank fysisk IDE får aldrig bli wire-`transaction-1`; positiva och negativa egna referenser. DM-unikhet inom samma APERAK vid flera felgrupper är separat oprövad kandidat. | CALL-12 `ack.ts` → `aperakEngine.ts` → canonical kernel/writer/finalizer. |
| ACK-08 / AT-ACK-08 | ERR-process/full-IDE-identitet korrigerad och native verifierad; SC-044 PASSED, separat lagring/svar och oförändrad retry. | Huvud/delutfall samt PRODAT:s skilda svarsstruktur/mutationsomfattning behöver sina egna fulla prov. Same-IDE-samtidighet tillhör ACK-09 och ska inte uppfinnas som extra SC-044-kriterium. | CALL-10 PRODAT runtime/mutation; CALL-11 UTILTS; CALL-12/13 svar och beständig verkställighet. |
| U-14 / AT-U-14 / SC-054 | Canonical storage före positivt svar, full batchrollback, storage-failure suppression och immutabla konsumtionskontrakt i tidigare native-prov; SC-044 lagrar före ACK. | Manual backend decision → ACK-draft → preflight → `sendQueuedEdielMessage` måste native visa att mottaget/kölagt utan lagringsauktoritet inte når observerad provider. Preview i sig är inget fel. Verkliga context/security/readiness-guards får inte kringgås. Deadlinefailure/retry och faktisk schemalagd bevakning återstår. | CALL-01 manual backend, CALL-06/07 send gateway/provider, CALL-13 inbox/SQL, CALL-15 timers/worker. |

U-02/U-03/U-14/ACK-03/ACK-08 och AT-kontrakten är **PARTIAL**. SC-044:s egna kriterier är **PASSED** enligt `acceptance-sc044-20260930.md`; detta stänger inte hela de två länkade regelkorten. Direkt-syntax-, huvudreferens- och manual-storage-kandidaterna är ännu inte bekräftade beständiga fel. Native-prov ska köras före produktändring och faktisk första vägran/felorsak ska läsas.

## Hur ett kontrakt godkänns

1. Lås kontraktets original-ID och ordalydelse, tillämplig källa/version/datum och ett oberoende facit. Skriv exakta förväntade respektive förbjudna effekter.
2. Spåra verklig CALL-konsument, canonical policy, source/tenant/actor/route/context och beständig verkställare. Dokumentera eventuella mocks och vad de begränsar.
3. Kör det kontraktets relevanta positiva, negativa och gränsfall. Lagring/atomicitet kräver native; retry/avbrott/samtidighet krävs när kontraktet eller dess mutation gör dem tillämpliga.
4. Knyt assertions och exekverat resultat till exakt head, jobblogg och autentisk artefakt. Gör oberoende granskning av facit, scope och felvägar. Gröna tester för andra krav räcker inte.
5. Sätt enbart det kontraktet till PASSED i `coverage.json` med ett fullständigt acceptanskvitto. Kvarvarande kriterium ger PARTIAL; saknat nödvändigt underlag ger dokumenterad blockerare. Frysta källregister förblir oförändrade.

Intern kontraktsacceptans, teknisk mergegrind och formell marknadsaktivering är olika beslut. Externa mandat och historik blockerar bara de krav som behöver dem; de är inte extra villkor för SC-044 eller vanlig intern parser-/ACK-acceptans.

## Granskningens proveniens

Read-only kravgranskare: `/root/acceptance_u02`, `/root/acceptance_u03`, `/root/acceptance_u14`, `/root/acceptance_ack03`, `/root/acceptance_ack08`. U-14:s native-harness har separat feasibility/refutation; ingen SMTP/nätverks-/DB-körning gjordes av granskaren. SC-044:s slutgranskare har inspekterat faktisk replay-logg. Full source hashes och versionsbevis finns i SC-044- och S02-kvittona. Relevant routing: `spec-to-code-compliance`, oberoende refutation, TDD/native, differential/code review och verification-before-completion. Inga UI-/prestandaförändringar eller externa operationsprov ingår.
