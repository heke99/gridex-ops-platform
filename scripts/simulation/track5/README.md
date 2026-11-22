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

## Inträdeskontroll före up/run/down

Alla tre shellskript kräver uttryckliga `SIM_HOME`, `RUN_DIR` och
`SIM_RUNTIME_ASSIGNMENT_FILE`. Inga historiska standardportar, gamla
markörfiler eller ett tidigare `ports.env` ger en ny körtilldelning.
Tilldelningen ska utfärdas av den aktuella samordnaren, ligga utanför Git och
vara en kanonisk, vanlig fil med aktuell användare som ägare och filmod `0600`.
Den är ett JSON-objekt med:

- `schema: "gridex-simulation-runtime-assignment-v1"`, `worker: "T5"`,
  `state: "ACTIVE"`, `environmentId` och en framtida tidszonssatt `expiresAt`.
- `allowedOperations`: de uttryckligen tilldelade operationerna `up`, `run`
  och/eller `down`. Varje start kontrollerar operation och giltighet igen.
- `runDir`, `simHome` och `sourceCommit`: exakta kanoniska sökvägar och
  fullständig SHA för en ren `RUN_DIR`. Katalogerna får inte överlappa.
  `SIM_HOME` ska ligga utanför Git och ha filmod `0700` om den redan finns.
  Dess `logs`, `pids` och `reports` får inte vara symlänkar eller ha annan ägare.
- `projectId`: ett separat tilldelat projekt, aldrig `gridex-ops-platform`.
- `ports`: exakt elva olika heltalsportar mellan 1024 och 65535 med nycklarna
  `SIM_API_PORT`, `SIM_DB_PORT`, `SIM_SHADOW_PORT`, `SIM_POOLER_PORT`,
  `SIM_STUDIO_PORT`, `SIM_MAIL_HTTP_PORT`, `SIM_SMTP_PORT`, `SIM_APP_PORT`,
  `SIM_COUNTERPART_PORT`, `SIM_RECEIVER_TLS_PORT`, `SIM_RECEIVER_CTRL_PORT`.
- `receiver`: `ip` som är en uttryckligt tilldelad publik IPv4-adress,
  `hosts` med mottagarens namn under `.t5.sim.invalid` och `networkTag`
  som börjar med `gridex-sim-t5-`. Samordnaren ansvarar för att dessa resurser
  är lediga och exklusivt tilldelade; parsern intygar inte detta.

Miljöns eventuella port-/projekt-/mottagarvärden måste överensstämma med
tilldelningen. Ett befintligt `ports.env` tolkas endast som enkla datarader
och måste exakt matcha projekt, elva portar och mottagar-IP. Filen körs aldrig
som shellkod. Fel stoppar även `run.sh` och `down.sh`, som saknar `errexit`,
före katalogskapande eller vidare skriptkörning.

**Runtime är fortfarande inte kvalificerad av inträdeskontrollen.** Direkt
scenarioimport kan kringgå shellinträdet. Faktisk backend-identitet, bygge,
replay och schemascope måste kvalificeras separat innan samordnaren tilldelar
en verklig körning. Process- och mottagarnätets avgränsningar beskrivs nedan.

## Processägande och extern nätförberedelse

`up.sh` kräver även `SIM_NAMESPACE_PLAN_FILE` före första backendkommando.
Det är samordnarens privata vanliga `0600`-fil utanför Git med
`schema: "gridex-simulation-namespace-plan-v1"`, `worker: "T5"`,
`state: "QUALIFIED"`, `mode: "PREPARED_EXTERNALLY"`, samma `environmentId`,
`assignmentSha256` för runtime-tilldelningens råa bytes, `networkNamespace`
som matchar `/proc/self/ns/net`, en framtida tidszonssatt `expiresAt` och
`receiver`. Mottagarobjektet innehåller tilldelningens `ip`, `hosts`,
`networkTag` samt `tlsPort` och `controlPort` från porttilldelningen.
Planen dokumenterar samordnarens förberedelse; parsern provar inte exklusivitet
eller att hela nätet är korrekt konfigurerat.

T5 ändrar inte `/etc/hosts`, iptables eller sysctl, startar ingen värd-dockerd
och utför ingen automatisk backendstädning. Samordnarens kvalificerade
producent förbereder och återställer separat nät/daemon/backend. Saknas plan,
daemon eller entydig inventering av ett nytt projekts resurser avbryter up.

Start/stopp delar `run.lock` med scenariokörningen; ett kvarlämnat lås rensas
inte automatiskt. Före nya starter kontrolleras alla befintliga app-, motparts-
och mottagarkvitton. Enbart PID-, namn- eller portträffar ger ingen stopprätt.
Varje ny process får omedelbart ett privat `pids/<roll>.birth.json` och en
PID-fil. Birth-observationen kräver aktuell användare, ett nytt eget
sessions-/processgruppsledarskap, rätt Node-exekverbar fil och arbetskatalog
samt att processen är ett barn till den aktuella startaren. Observationen
binder PID, startticks, UID, exe, cwd, grupp/session, kommandoradshash och
runtime-tilldelningens hash.

Efter hälsokontrollen skrivs separat `pids/<roll>.ready.json`, bundet till
birth-filens hash och samma oföränderliga processidentitet. Detta bevarar
Nexts ändring av processtiteln utan att skriva över startobservationen.
Hälsosvar bevisar inte ensamt portägande; faktisk runtime behöver fortsatt
kvalificering. Om ett tidigt haveri saknar ready-observation och kommandoraden
har ändrats krävs samordnarens avstämning. En felaktig ready-observation får
aldrig kringgås genom återfall till birth.

```sh
SIM_RUNTIME_ASSIGNMENT_FILE=/private/runtime.json SIM_HOME=/private/t5 RUN_DIR=/private/app \
  bash scripts/simulation/track5/down.sh --processes-only
```

`down.sh` stöder endast `--processes-only`. Hela målsetet verifieras före
första signalen; pidfd binder sedan signalen till exakt registrerad process.
En återanvänd PID, främmande identitet, ändrad tilldelning, en observerad ättling
eller en föräldralös sessionsmedlem stoppar automatisk städning. Processernas
föräldrarelationer (PPID) läses i den skrivskyddade inventeringen före första signalen för
hela målsetet och igen före varje ledares signal, även för barn med annan SID/PGID.
Endast en registrerad ledare utan observerade ättlingar eller andra levande
sessions-/gruppmedlemmar kan signaleras; efteråt måste dess session vara tom.
Inga processgruppssignaler eller breda pkill görs.

En privat journal under `process-cleanup-receipts/` reserveras före signalerna
och bevarar ursprungliga birth/ready-observationer. Endast slutförda registrerade
ledare får sina PID-/identitetsfiler borttagna. Resultatet anger uttryckligen
`backendStopped: false`, `hostNetworkChanged: false`, `descendantsStopped: false`
och `descendantContainment: "NOT_PROVEN"`. Kontrollen saknar cgroup-inneslutning
och kontinuerlig spårning: barn som redan har frikopplats och fått annan
förälder före observationen, eller som undkommer under en race, kan inte
uteslutas. Ett DONE gäller endast registrerade ledare och intygar inte att
alla ättlingar eller hela miljön är städade. Backend, volymer, nät och okända
barn har separat ägare. Ursprungliga replay-/byggmarkörer och credentials
behålls för samordnarens separata custody.

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
Ett oförklarat process- eller rapportfel avvisas, även om scenariots egna steg
är godkända. Endast vanlig exitkod 1 får förklaras av uttryckliga misslyckade
steg för andra kända scenario-ID; ett oidentifierat SETUP-/hookfel eller en
signal-/OOM-exit får inte göra det. Om rapporten innehåller Vitest-sammanfattning
måste dess utfall och felräknare stämma med dessa steg. Misslyckade steg för ett
annat scenario döljs inte: rapportens sammanfattningar och exitkod följer med
även när ett självständigt scenario har godkänts.
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

## Slutarkivets exakta bytes och externa bevisfiler

Vitest-scannen i `scenarios/scan.test.ts` är en tidigare runtimeögonblicksbild.
Dess filantal, byteantal och träffar binder inte ett senare omgenererat paket.
Efter alla runtimeunderlag och paket har slutförts skapar den kvalificerade
producenten därför slutleveransens ZIP en gång. Två separata offlinekommandon
binder och verifierar exakt detta objekt:

```text
python3 -I packet.py --scan-final-archive FINAL.zip CONTEXT.json PRIVATE_NEEDLE_FILE NEW_PROOF_DIR
python3 -I packet.py --verify-final-archive FINAL.zip MANIFEST.json RECEIPT.json EXPECTED_HANDOFF.json
```

Slut-ZIP ska innehålla exakt de 16 kända T5-ID:ns `<ID>/status.json` och
`FINDINGS.md` på rotnivån. Vanliga tomma föräldrakatalogposter får finnas.
Alla utfall, inklusive uttryckliga PARTIAL/FAIL/NOT_RUN, kan bindas som bytes;
kommandot avgör inte om scenarierna är godkända. Saknade/extra/dubbla eller
osäkra sökvägar, krypterade/särskilda/symlänkade poster och felaktig CRC
avvisas. Endast ZIP_STORED och ZIP_DEFLATED stöds. Gränserna är 64 MiB arkiv,
64 MiB per fil och 256 MiB expanderat; ingen tyst trunkering görs.

Arkivprofilen är dessutom strikt ZIP32 på en enda disk: inga ZIP64-fält,
data descriptors, inledande data, överlappande områden, luckor mellan lokala
poster eller obundna bytes efter slutposten. Vanliga ZIP-kommentarer ingår i
det hashade/scannade arkivet. Lokala headerfält måste stämma med den centrala
katalogens namn, metod, flaggor, CRC och storlekar; varje komprimerat byteområde
måste vara bundet till exakt en post. En producent som använder streaming-
descriptors eller ZIP64 måste först välja en separat kvalificerad packningsväg;
scannern tolkar inte om en sådan representation tyst.

ZIP-bibliotekets avkortade filvy används inte för payloads. STORED läses som
hela det bundna byteområdet. DEFLATE expanderas direkt från samma fångade
komprimerade bytes med en positiv gräns från återstående budget, oberoende av
deklarerad filstorlek. Fullt strömslut krävs; oanvända bytes, ytterligare
strömmar och ofullständigt slut avvisas. Faktisk expanderad storlek och CRC
måste därefter exakt matcha deklarationerna innan bytes scannas/hashas eller
CLEAN kan skrivas. Detta gäller också tomma katalogposter. En förfalskad liten
deklaration får alltså inte dölja en större komprimerad payload.

Scannern läser ett avgränsat arkivsnapshot. Arkivhashning, filhashning och
sökningen använder samma fångade bytes, inklusive rå ZIP-metadata och varje
expanderad fil. Inga paket skrivs om och arkivet packas inte om. Omleverans
med ändrade filbytes eller ZIP-metadata kräver ett nytt terminalt bevis.

`PRIVATE_NEEDLE_FILE` är en vanlig, kanonisk fil med aktuell användare som
ägare och filmod `0600`, utanför Git. Den innehåller endast den aktuella
service-nyckelns bytes, eventuellt med ett avslutande radbyte. Värdet lämnas
aldrig i argv eller utdata, och inga värden hämtas genom en generell miljödump.
Scanningen söker detta exakta värde och de versionerade JWT-/partner-token-/
Svix-/auth-cookie-mönstren. Det är en avgränsad policy, inte en allmän garanti
om samtliga möjliga hemligheter eller kodningar. Kontexten som ska kopieras
till manifestet kontrolleras också; vid träff publiceras inget CLEAN-kvitto
och ingen nyckel, matchad text eller payloadsnutt skrivs ut.

`CONTEXT.json` har exakt dessa fält:

- `schema: "gridex-t5-final-archive-context-v1"`.
- Icke tomma `campaignId`, `workerId`, `session`, `model`, `buildId`,
  `environmentId`, `databaseIdentity`. Databasidentiteten är en ofarlig
  identifierare, aldrig en anslutningssträng eller autentiseringsuppgift.
- `sourceCommit`, `sourceTree`, `builtCommit`, `replayCommit`: fullständiga
  Git-SHA. Skillnader behålls; `ROOT_TO_PIN` och andra platshållare avvisas.
- `harnessCommit`: fullständig Git-SHA eller uttryckligt `null`, samt en icke
  tom `harnessFiles`-lista med relativa `path` och `sha256` utan dubbletter.
- `schemaHash` med exakt `scope` och `fingerprint`; fingerprinten är SHA-256.
  Detta intygar inte fullständigt schema, faktisk backend eller native.

`NEW_PROOF_DIR` måste vara ny, utanför Git och ha en befintlig kanonisk
föräldrakatalog. Den skapas privat och innehåller endast:

- `manifest.json`: scope `FINAL_DELIVERY_ARTIFACT_BYTES_ONLY`, rå ZIP-SHA-256,
  arkivstorlek, kontext/policy-hash och en sorterad lista över filnamn,
  expanderad storlek och SHA-256. Kontext/policy använder UTF-8, sorterade
  JSON-nycklar, kompakta separatorer och ett avslutande radbyte.
- `receipt.json`: hash av manifestets faktiska bytes, samma ZIP-/kontext-/
  policyidentiteter, scannerfilens SHA-256, UTC, räknare och `artifactScan:
  "CLEAN"`. `campaignApproval`, `nativeApproval` och `browserApproval` är
  alltid `false`.

Manifestet och kvittot ligger utanför ZIP-arkivet. Manifestet hashar inte sig
självt eller kvittot; kvittot pekar på manifestet och payloaden. Lägg inte till
bevisfilerna i arkivet efteråt och generera inte om redan scannade statusfiler.
Historiska kataloger och befintliga bevisfiler skrivs aldrig över.

Verifieraren kräver en **separat, betrodd handoff** med exakt `schema:
"gridex-t5-final-archive-handoff-v1"`, `archiveSha256`, `manifestSha256`,
`receiptSha256`, `contextSha256`, `scannerSourceSha256` och `policySha256`.
Alla sex hashvärden ska vara oberoende pinnade från producentens faktiska
underlag. Att kopiera hashvärden från ett självdeklarerat kvitto skapar ingen
auktoritet. Scannerfilen och policyn måste motsvara den pinnade versionen.

Verifieringen läser de faktiskt levererade ZIP-byten, kontrollerar arkivets
hela filuppsättning och hashbindningar samt manifest/kvittots strikta schema.
Den ändrar inga indata och skriver inte ett nytt scan-kvitto. Det är en
integritetskontroll; Root måste separat kvalificera producent, CI/källkedja,
nyckelns verkliga tillämplighet och faktisk körning. Ingen signeringsnyckel
eller attestationsauktoritet uppfinns här. Filsystemets framtida oföränderlighet
garanteras inte; mottagaren måste verifiera det objekt som verkligen levereras.

Denna slutkontroll gäller enbart slutleveransens artefaktbytes. Tidigare
privata runtime-/logg-/static-/HTTP-underlag behöver fortsatt egen avgränsad
evidens. Ingen scenario-PASS, native-, browser- eller kampanjstatus uppgraderas
av CLEAN eller en lyckad leveransverifiering.
