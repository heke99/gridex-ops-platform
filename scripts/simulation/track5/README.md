# Spår 5 – separat simuleringsharness (EVENT01, AUTH01, API01)

Historisk kampanj `20261029-3f1a8ab1`, appbas `1c0c088cb4ed66d0dd8b3e34c9606019342a1a56`. Uppgifterna nedan beskriver förlagan; de anger inte identiteten för nya körningar eller paket.

**Ursprung:** kopierad från spår 2:s harness, `origin/claude/sim-20261029-track2` @ `5b6b27be9401a260fba6bd90b5b6d39b40300ae6`, katalogen `scripts/simulation/track2/`. Filerna är `up.sh`, `run.sh`, `down.sh`, `lib/{common.sh,counterparts.mjs,db.ts,env.ts,fixture.ts,index.ts,make-report.mjs,prepare-supabase.py,session.ts,server-action.ts}`, `tsconfig.json`, `vitest.config.ts` och `scenarios/smoke.test.ts`.

**Avvikelser mot förlagan:**
- **Standardvärden:** `SIM_HOME=/root/sim-home/track5`, `RUN_DIR=/root/sim/track5`, app-port 3105 och motpartsport 3195.
- **`up.sh`:**
  - `SKIP_REPLAY` godtar bara tillagda migrationer sedan `replay-commit`.
  - `SKIP_BUILD` godtar bara ändringar utanför appen, enligt sim-runners lista.
  - Före en ny replay avbryter skriptet om en Supabase-stack redan kör.
  - Skriptet skriver `fingerprint` (replayskriptets verifierade värde) och `db-url`.
- **`run.sh`:** kräver `SIM_REPORT`. Ett kvarlämnat `run.lock` tas inte bort, utan skriptet vägrar starta. Vitest-loggen skrivs både till stdout och till `SIM_HOME/logs`.

Användning, klocka och neutraliserade externa integrationer är desamma som i spår 2:s README.

## Nya statuspaket: explicit proveniens

`packet.py` är en offlineassembler. Den startar inga tester, läser ingen databas
och intygar inte att en kampanj, ett fullständigt schema eller en native-körning
är godkänd. Historiska paket och deras ursprungliga klassificeringar behålls;
nya klassificeringar måste följa kontraktet här.

```sh
python3 -I scripts/simulation/track5/packet.py EVIDENCE_DIR NEW_OUTPUT_DIR classification.json
```

`NEW_OUTPUT_DIR` får inte finnas, inte ens som en tom katalog. Alla indata
kontrolleras innan den skapas. Ett valideringsfel ger en fast felkod utan att
skriva ut indatans innehåll. JSON med dubbla nycklar eller icke ändliga tal
avvisas i klassificeringar, rapporter och kvitton.

Klassificeringen är ett JSON-objekt med `_meta` och en eller flera rader för
`AUTH01.01`–`AUTH01.06`, `API01.01`–`API01.05` eller
`EVENT01.01`–`EVENT01.05`. `_meta` kräver:

- `workerId`, `session`, `model`, `campaignId`, `cleanupReceipt`: uttryckliga,
  icke tomma strängar. Ingen arbetare, modell eller historisk kampanj antas.
- `baselineCommit`: fullständig Git-SHA; `heartbeatAtUtc`: tidsstämpel i UTC.
- `clockModel` och `versions`: objekt med körningens dokumenterade uppgifter.
- `reportBindings`: exakt fem nycklar: `auth01`, `api01`, `api01-poa`,
  `event01` och `scan`. Varje bindning beskriver just den rapportens körning.

Varje rapportbindning kräver följande fält:

- `command`, `environmentId`, `databaseIdentity`: dokumenterad kommando- och
  målidentitet. Databasidentiteten ska vara en ofarlig identifierare, aldrig en
  anslutningssträng med autentiseringsuppgifter.
- `reportSha256`: hash av de faktiska byten i `<grupp>-report.json`.
- `sourceCommit`, `builtCommit`, `replayCommit`: fullständiga Git-SHA som måste
  stämma med rapportens `appCommit`, `builtCommit` respektive `replayCommit`.
  Värdena behöver inte vara lika; skillnader redovisas.
- `logFile`: filnamnet på den lokala loggfilen. Filnamnet måste stämma med
  rapportens `log`, och filens hash med rapportens `logSha256`.
- `schemaHash`: objekt med `scope`, `fingerprint`, `evidenceFile` och
  `evidenceSha256`. `scope` anger exakt vad fingerprinten omfattar.
  `evidenceFile` är en lokal fil vars innehåll, efter omgivande blanktecken,
  är fingerprintens 64 hextecken; `evidenceSha256` binder filens råa bytes.
- `overlayRefs`: en icke tom lista med objekt som anger `kind`, `branch`,
  fullständig `commit` och en icke tom lista relativa `paths`. Minst en
  `kind: "harness"` ska matcha rapportens `harness.gitCommitIfAny`.
  Endast harnessreferensen får ha `commit: null`, om rapporten uttryckligen
  saknar Git-commit. Rapportens `harness.files` med relativa sökvägar och
  SHA-256 måste fortfarande finnas.

Rapport-, logg- och schemafiler ska vara vanliga filer direkt i
`EVIDENCE_DIR`; symboliska länkar avvisas. Valfria
`<grupp>-report.receipts.jsonl` läses som objekt, ett per rad. En rapport ska
innehålla körningsintervall i UTC, `scenarioFile`, `executionScope`,
`runDirClean`, `exitCode`, `summary` och `steps`. Stegens `durationMs` får vara
`null`, eftersom originalrapportören använder det när en duration saknas.

Varje scenariorad kräver `state` (`PASS`, `PARTIAL`, `FAIL`, `BLOCKED` eller
`NOT_RUN`), `evidenceScope` (`SOURCE_ONLY`, `COMPONENT` eller `SCENARIO`),
`appliesToCommit`, `scope`, `oracle` och `nextAction`. `appliesToCommit` binder
klassificeringen till rapportens faktiska `builtCommit`. `proposedState` är
valfri och använder samma statusvärden. `substitutions`, `notVerified` och
`findingsIds` är listor av strängar; `blocker` dokumenterar ett hinder.

`PASS` i antingen `state` eller `proposedState` kräver `SCENARIO`, inga
`notVerified` eller `blocker`, minst ett matchande godkänt steg, ingen
misslyckad suite-hook och rapporterade `ISOLATED_NATIVE`/`runDirClean: true`.
Misslyckade steg för ett annat scenario döljs inte: rapportens sammanfattning
och exitkod följer med även när ett självständigt scenario har godkänts.
Ett `COMPONENT`- eller `SOURCE_ONLY`-underlag kan aldrig få ett scenario-PASS.

`AUTH01.06` kräver också godkända matchande steg i `scan` för samma bygge,
replay, miljö, databas och schemafingerprint. Slutscannen måste börja efter
alla övriga rapporters sluttider. Dess harness- och källkodsidentitet får
skilja sig och följer då med som en separat `additionalRuns`-observation.

Paketet redovisar `sourceCommit`, `builtCommit`, `replayCommit`,
`harnessCommit`, `overlayRefs`, schema-scope och hashbindningar. Fältet
`appCommit` behålls för kompatibilitet och betyder det observerade
`builtCommit`; det påstår inte likvärdighet med aktuell källkod.
`schemaValidation: "FINGERPRINT_FILE_ONLY"`, `assemblyOnly: true` och
`campaignApproval: false` markerar gränsen: assemblern verifierar filbindningar
och konsistens, inte hur rapporten producerades eller om hela schemat är
korrekt. Schemafrågans scope, overlaylistan och körningsetiketterna kommer
från insamlarens uttryckliga uppgifter och ersätter ingen oberoende granskning.
