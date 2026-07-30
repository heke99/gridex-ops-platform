# Gridex – canonical kanalbehörighet och avtalspublicering

Datum: 2026-07-28  
Leveransstatus: **KOD LOKALT GRÖN, DATABAS/PRODUKTION NO-GO**

## Resultat

Lösningen har ett gemensamt, fail-closed flöde för `internal`, `website` och
`api`. Kanalbehörighet, publicering, kanalstatus och faktisk availability är
separata tillstånd.

- `canonical_internal_contract_offers_v` får alla obligatoriska grant-, status-,
  datum- och availability-fält.
- TypeScript-mappern kastar `ContractReadModelError` när obligatoriska
  databasfält saknas. Saknade booleans blir aldrig tyst `false`.
- Grant/revoke använder en egen idempotent RPC och kan aldrig publicera.
- Publicering kräver befintlig grant i UI, server action och databas-RPC.
- Publicerings-RPC:ns tidigare självgrant tas bort i en framåtmigration.
- Båda administrationsytorna använder samma server action och samma
  applikationstjänst.
- Granulära rättigheter används:
  `contracts.permissions.manage`, `contracts.publish.internal`,
  `contracts.publish.website` och `contracts.publish.api`.
- Readiness kommer från en gemensam databasfunktion per kanal.
- API-publicering skiljs från extern API-åtkomst. Extern åtkomst kräver en
  aktiv klient med `api_contracts.read`.
- Website och API använder samma externa DTO-mapper. API-svaret har en strikt
  allowlist och innehåller inte interna UUID:n eller interna snapshots.
- API/OpenAPI/ETag/header/metadata är synkroniserade på
  `2026-07-30.3`.
- Svensk kalendergiltighet ägs av PostgreSQL med `Europe/Stockholm`; frontend
  gör inte en konkurrerande UTC-datumfiltrering.
- Publication graph verifierar grant, assignment, kanal, publication,
  exakt en aktiv version, hash, datum och website public offer.
- Publicering är transaktionslåst, idempotent, auditerad och skyddad av ett
  unikt partial index.

## Lokal verifiering

| Kontroll | Resultat |
| --- | --- |
| App-typecheck | Godkänd |
| Test-typecheck | Godkänd |
| Script-typecheck | Godkänd |
| Contract-patch-typecheck | Godkänd |
| Vitest | 56 filer, 361 tester godkända |
| Ny kanalregression | 43/43 kontroller godkända |
| Contract go-live | 212 kontroller godkända |
| Contract lifecycle | 518 kontroller godkända |
| Tenant/contracts/API/mail | Godkänd |
| API/OpenAPI/docs/paritet | Godkänd, version `2026-07-30.3` |
| ESLint | 0 fel, 124 befintliga varningar |
| Next.js produktionsbygge | Godkänt |
| Ny migrationschecksumma | Godkänd |
| Full migrationsintegritet | **Blockerad av en historisk fil** |
| PostgreSQL apply/introspection | Inte körbar utan databas |
| Produktionsscenarier A–H | Inte körbara utan stagingmiljö |

Bygget kördes med Node 24. Projektets deklarerade produktionsintervall är
Node `>=22 <23`; release-CI ska därför upprepa bygget med Node 22.

## Releaseblockerare: historisk migration

Följande redan registrerade migration har ändrats:

```text
supabase/migrations/20260728170000_live_schema_code_canonical_sync.sql
```

Aktuell SHA-256:

```text
a743f580168fa2e5de28a9814f151ca0fdc1649517c84490afd093a72340afc4
```

Registrerad, betrodd SHA-256:

```text
881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482
```

Den exakta betrodda filen finns inte i den bifogade leveransen eller i de
tillgängliga tidigare artefakterna. Checksumman har därför **inte** skrivits om.
Det går inte att återskapa godtyckliga bytes från en SHA-256-checksumma.

Ny framåtmigration:

```text
supabase/migrations/20260728190000_contract_channel_permission_publication_completion.sql
```

SHA-256:

```text
dd0583262a7b0cc74a35ed79397fdd060776b9949f2cc826018c2e9b3f0e7f3e
```

Den nya checksumman är korrekt registrerad. Databasutrullning får inte ske
förrän `20260728170000...` har återställts byte-för-byte från det faktiskt
applicerade Git-/CI-/release-artefaktet och migrationskontrollen är helt grön.

## Synka leveransen till en befintlig arbetskopia

Byt destinationssökvägen till din egen repository-sökväg:

```bash
DELIVERY_ZIP="$HOME/Downloads/gridex-ops-platform-contract-channel-completion-20260728.zip"
SYNC_DIR="$(mktemp -d)"
unzip -q "$DELIVERY_ZIP" -d "$SYNC_DIR"

rsync -av \
  --exclude node_modules \
  --exclude .next \
  "$SYNC_DIR/gridex-ops-platform-main/" \
  "/sökväg/till/gridex-ops-platform/"

cd "/sökväg/till/gridex-ops-platform"
git status --short
git diff --check
```

Kommandot använder inte `--delete` och tar därför inte bort lokala filer i
destinationen.

## Lokal kontroll efter synk

Använd Node 22:

```bash
cd "/sökväg/till/gridex-ops-platform"
npm ci
npm run typecheck
npm run typecheck:tests
npm run typecheck:scripts
npm test
npm run lint
npm run verify:contract-go-live:static
npm run gridex:platform-tenant-contracts-api-mail-regression
npm run verify:contract-channel-publication:static
npm run build
npm run db:migrations:check
```

Det sista kommandot ska just nu stoppa på exakt den historiska
`20260728170000...`-avvikelsen. Fortsätt inte till databassteget förrän den
betrodda originalfilen är återställd och kommandot returnerar exit code 0.

## Kontrollerad staging-applicering

Kör endast mot isolerad staging efter grön migrationsintegritet:

```bash
test -n "$DATABASE_URL"
npm run db:migrations:check

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260728190000_contract_channel_permission_publication_completion.sql

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f scripts/gridex-contract-channel-publication-post-apply.sql
```

Post-apply-skriptet är read-only och rullar tillbaka sin kontrolltransaktion.
Varje undantag eller rad från blocker-queryerna är NO-GO.

## Databas- och stagingtest

Välj två isolerade testtenants och en verkligt behörig test-admin:

```bash
export GRIDEX_CONTRACT_TEST_COMPANY_ID="<tenant-a-uuid>"
export GRIDEX_CONTRACT_TEST_SECOND_COMPANY_ID="<tenant-b-uuid>"
export GRIDEX_CONTRACT_TEST_ACTOR_ID="<actor-uuid>"

npm run gridex:contract-db-lifecycle-test
npm run gridex:contract-multitenant-test
```

Det befintliga DB-livscykeltestet kör i transaktion och avslutas med rollback.
Kör därefter staging-roundtrip endast i en isolerad miljö:

```bash
export SUPABASE_URL="<staging-url>"
export SUPABASE_SERVICE_ROLE_KEY="<staging-service-role-key>"
export GRIDEX_CONTRACT_TEST_CONFIRM_STAGING="YES"
npm run gridex:contract-staging-roundtrip
```

Lägg aldrig nyckelvärden i loggar, ärenden eller rapportfiler.

## Obligatoriskt releaseprotokoll A–H

| Scenario | Godkännandebevis |
| --- | --- |
| A – endast intern | Intern availability `true`; website `false`; tydlig grant-blocker |
| B – website-grant | Grant `true`, kanal `missing`, website readiness `ready` |
| C – website publish | Aktiv kanal/version/public offer; website endpoint innehåller `offer_reference` |
| D – API utan scope | API-kanal aktiv; external access `false`; blocker `api_scope_missing` |
| E – API med scope | External access `true`; API-svar följer DTO-allowlist utan interna ID:n |
| F – bypass | Direkt action/RPC utan grant ger SQLSTATE `42501`; inga nya rader |
| G – concurrency | Två parallella publish ger exakt en publicerad version |
| H – unpublish | Kanal `unpublished`, availability `false`, feed saknar avtalet |

För C och H verifieras:

```text
GET /api/v1/website/public-contracts
```

För D, E och H verifieras med rätt tenantnyckel och scope:

```text
GET /api/v1/contracts
```

Spara statuskod, `offer_reference`, `X-Gridex-Contract-Version`, ETag,
canonical view-resultat, auditkedja och antal aktiva publication versions som
releaseevidens. Scenario A–H är inte markerade gröna i denna leverans eftersom
ingen auktoriserad stagingdatabas eller API-miljö fanns.

## Slutligt releasebeslut

```text
Applikationskod och statiska kontrakt: GO för staging
Historisk migrationsintegritet: NO-GO
Databasapplicering och slutligt schema: NO-GO tills verifierat
Website/API-produktion: NO-GO tills A–H och endpoints är gröna
```

Detta är ett avsiktligt fail-closed beslut. Att skriva om den historiska
checksumman eller påstå att ej körda produktionsscenarier är godkända skulle
dölja en verklig release-risk.
