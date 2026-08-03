# Gridex OPS – API- och schemajustering v4

Datum: 2026-08-03  
Projekt: `gridex-ops-platform`  
Supabase-projekt: `gridex-ops-dev` (`piidsfebjqjmnepdpnas`)  
Publikt API-kontrakt: `2026-08-03.1`

## Resultat

Incidenten `503 platform_schema_not_ready` är korrigerad både i den anslutna databasen och i källkoden.

Den huvudsakliga orsaken var att OPS-applikationen jämförde databasens aktuella runtime-fingerprint med en hårdkodad totalhash. Legitima additiva schemaändringar ändrade totalhashen trots att samtliga relationer, kolumner, funktioner, RLS-krav och rättigheter som API:t behöver fortfarande fanns. Applikationen blockerade därför ett kompatibelt schema.

Gridex Web var inte grundorsaken. Webben tog emot ett korrekt fail-closed `503` från OPS och försökte därefter använda en snapshot. Snapshotlagret var tomt, vilket gjorde att inget avtal kunde återställas lokalt.

## Korrekt slutmodell

Runtime-trafik styrs nu av den versionerade capability-vyn:

```text
public.gridex_runtime_schema_capabilities_v3
```

Gaten kräver samtidigt:

```text
is_ready = true
blocking_issues = []
schema_fingerprint = giltig lowercase SHA-256
```

Fingerprint används som manipulations- och revisionsbevis. Den jämförs inte längre med en hårdkodad totalhash som bryts av kompatibla additiva schemaändringar.

Migrationshistorik och release governance verifieras separat genom:

```text
public.gridex_migration_governance_v3
public.canonical_migration_readiness_v
public.platform_schema_state
```

Migrationshistorik får inte ensam skapa ett runtime-avbrott när de faktiska API-capabilities som krävs är verifierade.

## API-doktrin som kontrollerats

Projektet följer den publicerade modellen för Website Integration och Customer Portal:

- en server-side Bearer API-nyckel;
- tenant och bolag löses från integration context, inte från klientskickat `company_id`;
- publicerade avtal väljs genom immutable `offer_reference`;
- kundansökan kräver `Idempotency-Key` och payloadkonflikt detekteras;
- publika svar använder externa referenser och exponerar inte interna UUID-fält;
- Customer Portal kopplar användaren med stabila identiteter och tenantbunden ägarrelation;
- fel använder canonical error envelope;
- svar innehåller request-ID och kontraktsversionsheader;
- Website Integration och Customer Portal använder samma releaseversion `2026-08-03.1`.

## Kodändringar

### Runtime-gate

Ändrad fil:

```text
lib/platform/schemaReadiness.ts
```

Ändringar:

- borttagen hårdkodad exakt schemafingerprint;
- ny policy `capability_evidence_sha256`;
- explicit kontroll av `is_ready=true`;
- explicit kontroll av tom `blocking_issues`;
- explicit kontroll av giltig SHA-256-fingerprint;
- fortsatt fail-closed om capability-vyn saknas, inte returnerar rad eller innehåller blockerare;
- 30 sekunders cache behålls och kan invalideras.

### Test

Ny fil:

```text
__tests__/platform-schema-readiness.test.ts
```

Täcker:

- flera kompatibla giltiga fingerprints;
- `is_ready=false`;
- motsägelsefull rad med `is_ready=true` och blockerare;
- saknad eller felaktig fingerprint.

### Canonical migration governance

Ny migration:

```text
supabase/migrations/20260803212754_canonical_migration_readiness_reconciliation_v4.sql
```

SHA-256:

```text
08b8722e962ee019c9d190dcb3c4f3efe4cd956cdf88a0d432a0989f70635117
```

Migrationen:

- registrerar sex redan applicerade portfolio-migrationer med riktiga ledger-versioner, namn och checksummor;
- ersätter rå version/count-jämförelse med explicit `(applied_ledger_version, applied_ledger_name)`;
- kräver verifierad schemaeffekt;
- identifierar saknade, omappade och dubbla ledger-mappningar;
- tar bort tidsbaserad 24-timmarsblockering från governance-vyn;
- behåller vyn service-role-only;
- synkroniserar compatibility-raden mot runtime-capabilities.

### Repo–ledger-alignment

Följande lokala migrationer har fått samma versionsnummer som den verkliga live-ledgern:

```text
20260803152014_contract_portfolio_tenant_fk_indexes.sql
20260803152236_portfolio_superadmin_helper_service_role_only.sql
```

De tidigare felaktiga lokala filnamnen ska tas bort:

```text
20260803152200_contract_portfolio_tenant_fk_indexes.sql
20260803153500_portfolio_superadmin_helper_service_role_only.sql
```

SQL-innehållet är inte omspelat. Ändringen förhindrar att en framtida `supabase db push` försöker köra samma schemaeffekt under en ny version.

### Post-apply

Ny fil:

```text
scripts/post-apply-runtime-readiness-v4.sql
```

Skriptet är idempotent och:

- kräver att v4-migrationen finns i Supabase-ledgern;
- registrerar v4-migrationen i canonical manifest;
- uppdaterar compatibility-raden;
- stoppar om runtime, governance, canonical readiness eller ledger-mappningar avviker;
- returnerar samtliga readiness-källor.

## Live Supabase – verifierat slutläge

Följande kontrollerades efter applicering och efter en andra idempotent post-apply-körning.

### Runtime capabilities

```text
is_ready = true
blocking_issues = []
missing_relations = []
missing_columns_by_relation = {}
schema_fingerprint = bb46302e11a2a97c897d02fdd6b5ad4313be786cef9bf0fb4a969cabf51c2312
```

### Migration governance

```text
manifest_file_count = 38
ledger_version_count = 34
missing_in_ledger = 0
unmapped_ledger_versions = 0
duplicate_ledger_mappings = 0
invalid_checksum_count = 0
unverified_effect_count = 0
is_ready = true
blockers = []
```

Manifest och ledger har avsiktligt olika antal eftersom canonical manifest även innehåller verifierade aliases/effect records. Readiness bygger därför på explicita entydiga mappningar, inte rå count equality.

### Canonical readiness

```text
manifest_file_count = 38
ledger_version_count = 34
missing_in_ledger = 0
invalid_checksum_count = 0
is_ready = true
blockers = []
```

### Compatibility state

```text
current_version = 20260803-runtime-capability-compatible-v4
is_ready = true
blocking_issues = []
```

## Lokala verifieringar

Grönt:

```text
Platform runtime readiness compatibility static check
Migration integrity: 359 filer, 263 versionsgrupper
Public API contract: 41 routefiler
OpenAPI/runtime parity: 43 registry routes, 47 operations, 54 schemas
Dokumentationsversion: 2026-08-03.1
Dokumentationsexempel
Delade OpenAPI-komponenter
Public contract runtime/OpenAPI
External API contract corrections
API compatibility
Canonical runtime/OpenAPI parity
Single API-key tenant integration: 107 kontroller
Website application idempotency hardening
Customer Portal multi-site API
TypeScript-syntax för ändrade runtime- och testfiler
Live post-apply, inklusive idempotent omkörning
```

## Begränsning i denna körmiljö

Ett färskt `npm ci` kunde inte genomföras i den isolerade miljön eftersom den interna npm-spegeln saknade ett indirekt paket. Därför ska full `typecheck`, full Vitest-svit och produktionsbuild köras lokalt eller i CI innan appdeploy.

Detta är en verifieringsmiljöbegränsning och inte ett konstaterat kodfel.

## Separat säkerhetsbacklog

Supabase Security Advisor visar flera äldre, redan existerande findings som inte skapades av v4-migrationen:

- ett antal interna/service-owned tabeller med RLS men utan användarpolicy;
- leaked-password protection är inte aktiverat i Auth;
- flera äldre `SECURITY DEFINER`-funktioner behöver separat execute-/exponeringsgranskning.

Dessa ska hanteras i en egen härdningsrelease. De förändrar inte slutsatsen för den aktuella `platform_schema_not_ready`-incidenten, men plattformen ska inte beskrivas som fullständigt säkerhetsstängd innan de är behandlade.

## Kvarvarande produktionsteg

Databasen är redan reparerad. Den körande OPS-applikationen måste fortfarande deployas om så att den laddar den nya `schemaReadiness.ts`-gaten. Fram till appdeploy kan gamla instanser fortsätta returnera `503`.

Efter deploy ska minst 30 sekunder passera eller instansen startas om, eftersom readiness-resultatet cachas i 30 sekunder.
