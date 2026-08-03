# Gridex OPS – runtime schema readiness v3

**Datum:** 2026-08-03  
**Repo som granskats:** uppladdade `gridex-ops-platform-main(128).zip`  
**Live Supabase:** `gridex-ops-dev` (`piidsfebjqjmnepdpnas`)

## Resultat

Den externa OPS-API-gaten är korrigerad både i kod och live-databas.

Slutlig live-status:

- Runtime readiness: **READY**
- Runtime blockers: **0**
- Schemafingerprint: `cd64e1d6153619440cd878531d26b83b631680801ad517c07f92f99617a40f6a`
- Migration governance: **READY**
- Manifest: **27 verifierade rader**
- Live ledger: **19 mappade versioner**
- Saknade ledger-mappningar: **0**
- Omappade ledger-versioner: **0**
- Dubbla ledger-mappningar: **0**
- Ogiltiga checksummor: **0**
- Dubbla aktiva primära website-klienter: **0**
- Tenantlösa operativa EDIEL-/billingrader: **0**
- Ogiltigt konfigurerade aktiva API-klienter: **0**

## Rotorsak

Den tidigare `platform_schema_not_ready`-gaten blandade ihop två olika frågor:

1. Om databasen faktiskt har de tabeller, kolumner, funktioner, RLS-regler och privilegier som runtime behöver.
2. Om repositoryts historiska migrationsfiler har samma råa antal och tidsstämplar som Supabase-ledgern.

Den gamla implementationen blockerade produktion när:

- `canonical_migration_manifest` var tomt,
- filantalet inte var identiskt med ledgerantalet,
- verifieringen var äldre än 24 timmar.

Det var fel för Gridex historik. Flera äldre migrationer har andra canonicala filversioner än de tidsstämplar Supabase registrerade, och vissa senare säkerhetsändringar fanns som verifierade schemaeffekter utan en motsvarande historisk ledgerpost. Resultatet blev ett avsiktligt men felaktigt produktionsstopp trots att de kritiska runtime-objekten fanns.

## Ny modell

### Runtime capability gate

`gridex_runtime_schema_capabilities_v3` kontrollerar det som faktiskt får blockera API-trafik:

- kritiska tabeller och vyer,
- obligatoriska kolumner,
- obligatoriska funktioner och exakta signaturer,
- RLS på kritiska tabeller,
- minst en policy på kritiska användar-/tenanttabeller,
- `security_invoker` på kritiska vyer,
- att känsliga backendfunktioner inte kan köras av `anon` eller `authenticated`,
- att `service_role` har nödvändiga rättigheter,
- dubbla primära tenant-website-klienter,
- tenantlösa operativa rader,
- ogiltiga rate-limit-inställningar,
- deterministiskt SHA-256-fingerprint av kritiskt schema, funktioner och policies.

Applikationen accepterar endast det exakta fingerprint som byggversionen har verifierats mot.

### Migration governance

`gridex_migration_governance_v3` är separat från runtime-gaten och stödjer:

- exakt ledger-mappning,
- explicita historiska timestamp-alias,
- verifierade schemaeffekter,
- checksumkontroll,
- full ledgertäckning,
- skydd mot dubbla mappningar.

Verifieringen går inte längre ut efter 24 timmar. Historikdrift kan stoppa en deployment, men orsakar inte automatiskt ett nattligt API-avbrott när runtime-schemat fortfarande är korrekt.

## Live-databasändringar

### Duplicate website credential

Två aktiva primära production-klienter fanns för samma tenant.

Behållen aktiv klient:

- ID: `bf2f3755-4a84-446a-b361-b6aa7149c39a`
- Prefix: `gdxp_45b9a11`
- Status: `active`
- `primary=true`

Pausad äldre klient:

- ID: `67cb32e0-9b0c-4a2d-a357-b86bafb5c4ce`
- Prefix: `gdxp_260ada7`
- Status: `paused`
- `primary=false`

En auditpost skapades. Den reparerade RPC:n använder nu det verkliga canonicala `audit_logs`-kontraktet och är atomisk för framtida reparationer.

Kontrollera att website-projektets hemliga API-nyckel motsvarar den aktiva prefixen `gdxp_45b9a11`. Full nyckel ska aldrig skrivas i loggar eller repository.

### Ledger och manifest

Livehistoriken är nu uttryckligen mappad:

- exakta ledgerposter,
- historiska timestamp-alias,
- verifierade schemaeffekter,
- separat alias för Supabase MCP:s automatiskt registrerade migration `20260803081939`.

När canonicala versioner `20260803093000`–`20260803093300` senare registreras av en kontrollerad CLI-process kan reconciliation-scriptet automatiskt flytta deras manifestposter från `schema_effect` till exakt `ledger` utan att den automatiska live-aliasposten tappas.

## Kodändringar

- `lib/platform/schemaReadiness.ts`
  - läser v3 capability-vyn,
  - validerar SHA-256-format,
  - kräver exakt releasefingerprint,
  - använder 30 sekunders cache men ingen 24-timmars utgång.
- Fyra framåtriktade migrationer för metadata, runtime-katalog, governance och duplicate-repair-RPC.
- Ny statisk kontroll: `db:runtime-readiness:check`.
- Produktionsmigrationskontrollen accepterar endast tre uttryckligen dokumenterade historiska versionskollisioner.
- Post-deployment- och tenant-integritets-SQL använder v3-modellen.
- Release-scriptet kör runtime readiness-kontrollen.
- Live reconciliation är idempotent och skiljer på canonicala ledgerposter, live-alias och schemaeffekter.

## Lokalt verifierat

Följande kontroller passerade i leveransmiljön:

- `npm run db:runtime-readiness:check`
- `npm run db:migrations:production-readiness`
- `npm run db:migrations:check`
- `npm run api:contract`
- `npm run api:error-registry`
- `npm run api:openapi-parity`
- `npm run api:docs-version`
- `npm run api:docs-examples`
- `npm run api:shared-components`
- `npm run api:public-contract-runtime-openapi`
- `npm run api:release:verify` för lokala artifacts
- `npm run gridex:single-api-key-integration-regression` – 107 kontroller
- syntaxkontroll av release-shellscriptet

Migrationskontrollen rapporterar:

- 348 SQL-filer,
- 252 versionsgrupper,
- 255 ledger-lämpliga filer,
- samtliga registrerade checksummor verifierade,
- endast tre dokumenterade historiska kollisioner:
  - `20260612193000`
  - `20260616123000`
  - `20260727150000`

Full `npm ci`, lint, TypeScript, Vitest/Jest och Next.js-build kunde inte köras i leveranscontainern eftersom färdiga npm-beroenden saknades. De ska köras lokalt eller i CI före deploy.

## Applicera kodpatchen

Synka patchen till OPS-repot och kör:

```bash
cd "/Users/hekmath/Projects/gridex-ops-platform"

npm ci
npm run db:runtime-readiness:check
npm run db:migrations:production-readiness
npm run db:migrations:check
npm run api:contract
npm run api:docs
npm run typecheck
npm run lint
npm test
npm run build
```

Deploya därefter OPS-koden till projektet som driver `app.gridex.se`.

### Viktigt om Supabase-migrationer

Live-databasen innehåller redan de levererade schemaeffekterna. Kör därför **inte ett generellt `supabase db push` blint** från detta historiska repo; Supabase-ledgern innehåller inte alla äldre lokala filer och ett generellt push kan försöka köra gammal SQL.

För den nuvarande live-miljön:

1. Deploya kodpatchen – v3-vyerna finns redan live.
2. Kontrollera `supabase migration repair --help` i er installerade CLI innan ledgerändringar.
3. Registrera endast de fyra nya canonicala versionerna genom en kontrollerad migration/repair-process.
4. Kör därefter `scripts/reconcile-live-platform-schema-2026-08-03.sql` med `psql` mot exakt rätt projekt.
5. Kör post-deployment-verifieringen.

Reconciliation-scriptet är live-specifikt och innehåller tenant-/credential-ID:n. Det ska inte köras mot en annan tenant eller en tom generell databas.

## Live efter deploy

Kör mot OPS-repot med rätt miljövariabler:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f scripts/post-deployment-verification-2026-08-02.sql

npm run db:runtime-readiness:check
npm run api:release:verify
```

API-smoke:

```bash
curl -i \
  -H "Authorization: Bearer $GRIDEX_API_KEY" \
  https://app.gridex.se/api/v1/integration/context

curl -i \
  -H "Authorization: Bearer $GRIDEX_API_KEY" \
  "https://app.gridex.se/api/v1/website/public-contracts?customer_type=private"
```

Förväntat:

- HTTP 200,
- `X-Gridex-Contract-Version: 2026-08-02.1`,
- inget `platform_schema_not_ready`,
- website-feed med det publicerade avtalet,
- inga duplicate-primary-blockerare.

## Kvarvarande separat säkerhetsskuld

Supabase Security Advisor rapporterar fortfarande äldre, plattformsomfattande fynd som inte skapades av denna patch:

- flera service-/intern-tabeller med RLS men utan användarpolicy,
- ett antal äldre `SECURITY DEFINER`-hjälpfunktioner som är körbara av `anon` eller `authenticated`,
- leaked-password protection är avstängt.

Dessa ska hanteras i en separat funktions- och tabellklassificering. De ska inte mass-revokas utan att först kontrollera RLS-beroenden och avsedda klientanrop, eftersom det kan bryta autentisering och tenantpolicies. Den nya runtime-gaten kontrollerar de kritiska externa API-funktionerna och de är gröna.
