# Gridex live-schema- och kodsynkronisering

Datum: 2026-07-28  
Projekt: Gridex OPS Platform  
Underlag:

- `gridex-live-audit-2026-07-28.zip`
  - SHA-256: `4900354df1cc1ae8c03fc105b8c05874258dcc6aad61d4aaa06065ab5de35c1c`
- `gridex-ops-platform-main(93).zip`
  - SHA-256: `c5d54367c799cdfe7b39fc3f0f02dd47c333022a6f93e2c7ce6447ee6e26290f`

## Sammanfattning

Kodbasen och en enda forward-only reparationsmigration har synkroniserats mot den exporterade, faktiskt aktiva live-definitionen. Reparationen omfattar samtliga 23 funktioner som live-lintningen rapporterade som felaktiga, samtliga identifierade `pgcrypto`-fel, schema-/kolumnmissar som applikationskoden använde, den kanoniska avtalsgrafen, behörigheter, statusövergångar, publiceringslivscykel och API-kontrakt.

Den lokala leveransen är:

**READY FOR CONTROLLED APPLY**

Den riktiga produktionsdatabasen är däremot inte ändrad av denna leverans. Den får inte markeras som synkroniserad eller felfri förrän migrationen har applicerats mot rätt projekt och den medföljande efterkontrollen samt live-lintningen har passerat utan fel.

Tidigare status: **NO-GO**  
Status efter lokal reparation: **READY FOR CONTROLLED APPLY**  
Produktionsstatus före genomförd efterkontroll: **NO-GO**

## Vad live-underlaget bekräftade

### 1. Aktiv livekod och repots migrationskedja var olika

Live-databasen hade endast nio registrerade remote-migrationer. Versionsnumren och innehållet matchade inte repots nuvarande filer, samtidigt som funktioner från senare, oregistrerade SQL-leveranser var aktiva. Det visar att databasen har ändrats utanför en entydig migrationskedja.

Konsekvensen var att:

- repots statiska tester kunde vara gröna medan live-definitionerna var trasiga;
- samma funktionsnamn kunde ha annan aktiv implementation i produktion;
- `db push` riskerade att spela om hundratals historiska migrationer i fel ordning;
- en registrerad migration inte bevisade att alla villkorliga objekt faktiskt skapades.

### 2. Live-lintningen innehöll 23 verkliga funktionsfel

Samtliga 23 funktionsnamn från `17-live-db-lint.txt` har täckts av reparationsmigrationen. Reparationerna inkluderar:

- borttagna eller namnändrade tabeller och kolumner;
- felaktiga returtyper och vyreferenser;
- gamla statusfält;
- trasiga onboarding-, workflow-, publicerings-, faktura- och kundlivscykelvägar;
- döda engångsfunktioner som inte längre ska vara anropbara.

### 3. `pgcrypto` gick inte att lösa säkert

Aktiva livefunktioner använde bland annat `digest()` med `search_path=public,pg_temp`, trots att `pgcrypto` ligger i `extensions`. Den nya migrationen kvalificerar eller säkrar alla berörda aktiva definitioner och regressionstestet blockerar nya osäkra varianter.

### 4. Databasrelationer och kodreferenser hade konkreta missmatchar

Utöver live-lintningen hittades missmatchar genom en separat kod-mot-live-scan:

- saknad `company_onboarding_tasks`;
- saknad `communication_log_events`;
- fakturakolumner och statusvärden som koden förutsatte men live saknade;
- saknade provider-/webhookkolumner;
- gamla EDIEL-, mätvärdes-, certifikat-, RBAC- och kundavtalsfält;
- felaktiga RPC-argument och äldre tabellalias.

Reparationen lägger till de saknade kanoniska objekten eller ändrar koden till det schema som faktiskt ska vara canonical.

## Genomförda databasändringar

Huvudleveransen är:

`supabase/migrations/20260728170000_live_schema_code_canonical_sync.sql`

Migrationen är transaktionell, använder ett advisory lock och är fail-closed. Den gör inga tysta antaganden om den aktiva funktionen: funktionspatchar matchas mot den exporterade live-definitionen och avbryter om förväntat uttryck inte finns.

### Canonical avtalsgraf

- Säkrar `energy_direction` i canonical kolumner och immutable snapshots.
- Kontrollerar snapshot-hash, avtalstyp, energiriktning och successor-relation.
- Återskapar den publika canonical-vyn med explicit kolumnordning.
- Gör publik giltighet konsekvent för inkluderande kalenderdatum.
- Tillåter onboarding utan site endast i uttryckliga resolutionstillstånd.
- Säkrar att interna och publika erbjudanden går genom canonical wrappers.
- Återkallar direkt `EXECUTE` från core- och legacy-ingångar.

### Avtals- och signaturlivscykel

- Inför `signature_failed` och recovery till `pending_signature`.
- Lägger till separat RPC för att avsluta en publiceringskanal.
- Skiljer `ended` från `paused`.
- Anpassar kundavslut så utkast/väntande signering avbryts medan signerade/aktiva avtal avslutas.
- Förhindrar statusuppdateringar som saknar obligatorisk beviskedja.

### Onboarding, juridik och workflow

- Rättar `pgcrypto` i onboarding, legal bundle och publiceringsfunktioner.
- Skapar och säkrar `company_onboarding_tasks`.
- Rättar workflowfunktioner som refererade till borttagna fält.
- Gör juridiska och canonical steg fail-closed.
- Klassificerar en saknad wrapper skilt från en saknad funktion inne i en existerande wrapper.

### Fakturering och providerhändelser

- Synkroniserar fakturastatus och metadata.
- Lägger till `vat_amount` och `amount_inc_vat` på fakturarader med deterministisk backfill.
- Lägger till saknade provider-/webhookfält:
  - `environment`;
  - `billing_provider_connection_id`;
  - `signature_timestamp`.
- Lägger till de unika index som kodens `onConflict` förutsätter.
- Markerar äldre händelser som inte kan härledas säkert för manuell granskning i stället för att gissa miljö.

### Kommunikation, EDIEL, mätning och behörigheter

- Skapar `communication_log_events` med foreign keys, index, RLS och grants.
- Byter EDIEL-anrop till de aktiva kanoniska fälten.
- Rättar certifikathemlighetsreferenser och actor-/role-fält.
- Rättar mätpunktens site-, arkiv- och statusfält.
- Rättar RBAC override-tidsfält.
- Rättar immutable event-skrivningar och äldre prisperiodsupplåsning.

## Genomförda kod- och API-ändringar

Totalt ändrades eller lades 57 käll-, test-, dokumentations- och migrationsfiler till jämfört med projektarkivet.

Viktiga korrigeringar:

- Tar bort läckan av en annan ansökans interna UUID från publika quote-fel.
- Gör diagnostikens `canonical_graph_consistent` beroende av faktisk grafkonsistens, inte antalet dolda avtal.
- Lägger till `signature_failed` i typer, etiketter, admin- och portalflöden.
- Använder separat `gridex_end_contract_channel` för `ended`.
- Rättar dubblerad räknare för väntande signeringar.
- Normaliserar API-versionen till `2026-07-28.1`.
- Rättar OpenAPI:s transaktionsbeskrivning till den verkliga runtime-gränsen.
- Rättar EDIEL-, certifikat-, mätning-, RBAC-, faktura- och meddelandequeries till canonical schema.
- Rättar publik grafdiagnostik och readiness till nya integritetsfält.

## Nya skydd och verifieringsfiler

### Preflight

`scripts/gridex-live-repair-preflight.sql`

Läsande kontroll som bland annat verifierar:

- aktuellt projekt och PostgreSQL-version;
- extensions och funktionsupplösning;
- nödvändiga tabeller och kolumner;
- dubletter som skulle blockera unika index;
- ogiltiga energiriktningar;
- providerhändelser som inte kan migreras säkert;
- avtalsgrafens tillstånd.

### Efterkontroll

`scripts/gridex-live-repair-post-apply.sql`

Kör alla kontroller i en transaktion som avslutas med `ROLLBACK`. Endast temporära kontrollrader skapas. Den misslyckas om någon av följande kvarstår:

- osäker `digest`/`gen_random_bytes`;
- saknade tabeller, kolumner, index, vyfält eller RPC:er;
- trasig canonical graf;
- ogiltig `energy_direction`;
- dubletter som bryter provider-idempotens;
- felaktiga grants till core-/legacyfunktioner;
- providerhändelser som kan köras men saknar härledbar miljö.

### Kod-mot-live-regression

`scripts/gridex-live-schema-code-sync-regression.cjs`

Kontrollen:

- simulerar 41 exakta funktionspatchar mot exporterad aktiv livekod;
- verifierar att alla 23 live-lintfel täcks;
- jämför samtliga statiska `.from()`- och `.rpc()`-referenser mot live plus reparation;
- verifierar 4 759 direkta skrivfält;
- verifierar 3 679 filter-, sorterings-, matchnings- och OR-fält;
- verifierar 120 literal-RPC-anrop mot funktionssignaturer;
- tillåter endast det uttryckligt optionala `customer_profiles`-schemat, där runtime redan har dokumenterad fallback.

## Verifieringsresultat

| Kontroll | Resultat |
|---|---|
| TypeScript | Godkänd |
| ESLint | Godkänd, 0 fel; 124 befintliga unused-var-varningar |
| Vitest | 55 testfiler, 357 tester godkända |
| Produktionsbuild | Godkänd, komplett Next.js-build |
| API-dokumentation och versionsparitet | Godkänd |
| Contract P0 integrity | Godkänd, 126 kontroller |
| Contract go-live static suite | Godkänd |
| Contract go-live regression | Godkänd, 209 kontroller |
| Contract lifecycle regression | Godkänd, 505 kontroller |
| Contract lifecycle tests | Godkänd, 40 tester |
| Single-source regression | Godkänd, 90 kontroller |
| Portfolio/pricing regression | Godkänd, 127 kontroller |
| Legal publication regression | Godkänd, 34 kontroller |
| Website POA regression | Godkänd |
| Migration integrity | Godkänd, 319 filer / 223 versionsgrupper |
| Live-schema/kod-regression | Godkänd |
| Exakta livefunktionspatchar | 41 av 41 matchade |
| Live-linttäckning | 23 av 23 fel täckta |
| SQL-parser, migration | Godkänd, 141 statements |
| SQL-parser, preflight | Godkänd, 12 statements |
| SQL-parser, post-apply | Godkänd, 14 statements |

Migrationsfilens SHA-256:

`881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482`

Checksum är registrerad i `scripts/migration-history-manifest.json`.

## Flera granskningspass

Genomgången utfördes i separata pass:

1. Aktiv livefunktion mot sista lokala funktionsdefinition.
2. Live-lintfel mot exakt reparationspunkt.
3. Kodens tabell- och RPC-vägar mot live-schema plus migration.
4. Kolumn-, write-, filter-, order-, match- och RPC-argumentscan.
5. Avtalsgraf, snapshots, energiriktning och successor-kedja.
6. Statusmaskin, signatur, publicering, juridik och onboarding.
7. RLS, grants, index och idempotens.
8. API/OpenAPI/versioner och exempeldokumentation.
9. Full TypeScript-, lint-, test- och produktionsbuild.
10. Slutlig SQL-parse, checksum och live-auditsimulering.

## Kvarvarande produktionsgränser

Följande kan inte avslutas enbart i ett lokalt arkiv:

1. Migrationen måste köras mot rätt liveprojekt.
2. Preflight måste vara grön för den då aktuella databasen.
3. Efterkontroll och `supabase db lint --linked` måste vara gröna.
4. En ny schemaexport måste tas efter applicering och jämföras med leveransen.
5. Provider-/webhookflöden bör smoke-testas mot respektive sandbox eller kontrollerad testhändelse.
6. Repots gamla migrationshistorik är fortfarande historiskt icke-kanonisk. Den nya migrationen etablerar en säker reparationspunkt men skriver inte om historiken.

Bygget kördes framgångsrikt med Node 24. Projektets deklarerade produktionsintervall är Node 22. Kör därför själva releaseverifieringen med Node 22 för identisk driftsmiljö.

ESLint har inga fel men rapporterar 124 `no-unused-vars`-varningar i äldre, främst EDIEL- och adminrelaterad kod. De blockerar inte bygg eller test och är inte schema-/path-missmatchar. De har inte massraderats i denna databasreparation, eftersom flera representerar vilande operativa funktioner där blind borttagning kan ändra affärsflöden. De ska hanteras som ett separat dead-code- och UI-wiring-arbete med egna beteendetester.

## Migrationshistorik efter reparation

Efter godkänd post-apply kan endast den nya reparationsversionen markeras som applicerad:

`20260728170000`

Det reparerar inte automatiskt de gamla remote-versionernas avvikande tidsstämplar eller innehåll. Kör inte `db push` mot den nuvarande historiken.

En full canonical baseline ska göras i en separat fas:

1. Exportera post-apply-schema.
2. Skapa en ny baseline från det verifierade schemat.
3. Återspela baselinen i en tom stagingdatabas.
4. Köra hela verifieringssviten.
5. Arkivera den gamla kedjan utan att ändra produktionsobjekt.
6. Börja alla framtida ändringar från den verifierade baselinen.

## Slutligt godkännandekriterium

Leveransen får markeras **GO** först när alla punkter är sanna:

- preflight passerar mot rätt projekt;
- migrationen commit:ar utan fel;
- post-apply passerar;
- live-lint har noll error;
- schemaexporten visar de nya objekten och inga oväntade driftavvikelser;
- applikationsbygget med Node 22 passerar;
- kritiska onboarding-, publicerings-, signatur-, faktura- och provider-smoke-tester passerar.

Körordningen finns i `GRIDEX_LIVE_REPAIR_RUNBOOK_2026-07-28.md`.
