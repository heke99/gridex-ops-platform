# Gridex OPS – aktuell fortsättning på Mac

Detta är den aktiva ingången för överlämningen. Sökvägen i repo är `quality/audits/gridex-simulation-handoff-20261116/`. Läs denna fil och CONTINUE.sv.md före äldre arkivtexter.

## Kodbas och status

Leveransen utgår från main `c94f9cb2fd9a6aa66bc3b66ccb18ed4ac16dd2bb`, merge av PR #1053 med kundkort/workflow-rättningarna. Den tillför enbart denna auditkatalog; ingen produktkod, migration eller databas ändras genom överlämningen. Äldre underlag bygger på bf32b7e eller tidigare testkompositioner. Det är historisk evidens, inte bevis för att alla scenarier körts på c94f9cb2.

Registrerad status för de 105 ursprungliga scenarierna är **43 FULL PASS, 1 dokumenterad GAP, 61 INCOMPLETE**. Ofullständiga: 16 partiella/blockerade, 36 utan entydigt mappat fallkvitto med återstående förutsättningar, 9 med otillgängligt original. Inga nya PASS har tillkommit genom Git-överföringen. Registret har 46 blandade fynd, inte 46 öppna produktbuggar.

Kanonisk per-ID-tabell: `archive/current/per-id-execution.v5.safe.json`, SHA256 `d29f2f05494b69d4b8dd034515730db239273d9e39d38319b1ed17e14d92a197`. Läsbar vy: `archive/SCENARIOS-105.sv.md`. Nästa grupp är EDIEL02.05 och EDIEL03.01/.02/.03; deras senaste försök nådde inte lösenordsinloggning eller affärssteg. Fulla acceptanskrav finns i `archive/evidence/workspace/gridex-ediel05-06-acceptance-20261116/FOUR-ORIGINAL-COHORT-EXACT-ACCEPTANCE.safe.json` (SHA256 14576b4d9b0db32c9c66390fca07bc59b598b7447054b065546abfdaf654dec8).

## Vad ska läsas?

1. `CONTINUE.sv.md`, repoets AGENTS.md och gällande samarbets-/ägarskapsinstruktioner.
2. `review/REVIEW.sv.md`, aktiv `review/SQL-CANDIDATES.v2.safe.json`, UI-DEADCODE-CANDIDATES.safe.json och REMAINING-61.safe.json. V1 av SQL-granskningen är historik. Den tidigare väntan på workflow-agenten är nu upphävd genom användarens uppgift och verifierad merge #1053; ny bas måste fortfarande kvalificeras.
3. `archive/current/FINDINGS.safe.json`, ROUTES-AND-DEAD-CODE.sv.md och per-ID-tabellen. Äldre checkpoint är kronologi och får inte användas som aktuell körorder.
4. `archive/preflight/DATABASE-CONTINUITY.safe.json` och PORTABILITY-REVIEW.sv.md.
5. `archive/EVIDENCE-INDEX.safe.json`, `archive/evidence/simulation-source/SHA256-MANIFEST.v2.safe.json` och README.v2.sv.md. Dessa mappar faktiska inkluderade filer till ursprung och hash. Absoluta /workspace- och /tmp-sökvägar är molnproveniens, inte lokala Mac-sökvägar.

## Samma staging och bevarat lokalt arbete

Användaren har valt **samma befintliga simulerings-/stagingdatabas**. Den sparade identiteten avser molnets Docker-Postgres/loopback, inte Macens localhost. Ingen säker privat anslutning från Mac, målverifiering, giltig normal Auth eller portering av kontrollplanet har etablerats genom denna leverans. Bevara staging-Main/Auth som auktoritet och ägd testisolering för affärsskrivningar. Skapa ingen ny lokal DB som tyst ersättning och exponera inga tjänster publikt för att kringgå anslutningshindret.

Det lokala ursprungsrepot `/Users/hekmath/Projects/gridex-ops-platform` har rapporterade ändringar i tre quality/e2e-filer och grenen reports/local-verification-20261105-a71c. Bevara dem. Den nya arbetsytan `/Users/hekmath/Projects/gridex-ops-simulation` ska kontrolleras lokalt innan ändringar. Den tidigare lokala matrisens 20 PASS/85 BLOCKED och denna uppgifts 43/1/61 får inte adderas eller ersätta varandra utan per-ID-/orakel-/miljö-/versionsjämförelse.

## Återanvänd rätt evidens

Kundraderingen 8af37439 har senare kvalificerad evidens: 21 nativefall PASS, lokal TEST apply/replay och normal UI-radering med POST200/native commit. Äldre NOTRUN i committade rapporter är inaktuellt för denna komposition. Bevara begränsningar om sekvenser, separat helperexit1/listfel och ofullständig före-evidens för vissa främmande rader. Det är inte ett fullscenario- eller c94/Git-main-godkännande. Återanvänd giltiga bevis efter tillämplighetskontroll; kör inte om dem blint.

De sju gamla kandidatpatcharna i archive/candidate-patches är inte applicerade. Kundlisteförfiningen 1d2 behöver även a9b5-grunden, nu bevarad under review/additional-candidate-patches. Dessa ändringar ska bedömas semantiskt mot c94 och workflow-rättningarna; applicera inte den gamla stacken automatiskt. Framer måste föregå headerfixen. Dödkodsinventeringen är 33 deklarationer, 24 lokalt borttagna/9 behållna; 187 onådda är inte bevisat döda. Den separata dashboardkandidaten ändrar inte automatiskt dessa tal.

## Överföringskontroll och begränsningar

Kör `python3 quality/audits/gridex-simulation-handoff-20261116/verify.py` från repot. Det kontrollerar filhashar och kör inte appkod. Därefter kan den läsande Mac-preflighten köras: `bash quality/audits/gridex-simulation-handoff-20261116/archive/preflight/local-preflight.sh`.

Äldre `archive/RESUME-PROMPT.sv.md`, verify-handoff.py och ZIP-startinstruktioner hör till ett tidigare paket och ska inte användas som aktiv startväg för denna Git-leverans. Den gamla ZIP-länken fungerade inte för användaren. Här överförs underlagen via Git, inte via den länken.

Privata runtimefiler, nycklar, lösenord, sessioner, databasdata, kompletta installerade beroenden/containerbilder och alla historiska råarkiv ingår inte. Hantera återstående privata artefakter genom avsedd säker kanal och behåll molnmiljön tills fortsatt åtkomst är säkrad. Officiellt Nordfin-XSD/avrundningsunderlag och originalserien 28 meddelanden/1 809,51 kr saknas enligt användaren. De får inte uppfinnas. Nya deklarerade funktionella fixturefall ersätter inte originalets facit.

Källsnapshotarna ligger under archive/evidence/simulation-source för att följa repoets befintliga audit-evidence-undantag i ESLint. Ingen kvalitetsregel har ändrats. Dessa snapshotar är bevarat underlag och får inte importeras som ny produktkod automatiskt.
