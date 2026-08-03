# Gridex OPS – API-, databas- och dokumentationsfix

Datum: 2026-08-03  
Ny kontraktsrelease: `2026-08-03.1`

## Resultat

De identifierade blockerarna är rättade i repositoryt och de säkerhetskritiska databasändringarna är applicerade och verifierade i den anslutna Gridex OPS-databasen.

### Live-databas

- `gridex_contract_platform_readiness(uuid)` är nu en tenantauktoriserad fasad.
- Den tidigare interna implementationen heter `gridex_contract_platform_readiness_internal_v1(uuid)` och är återkallad från `public`, `anon` och `authenticated`.
- Ett verkligt cross-tenant-test med en vanlig tenantanvändare gav:
  - egen tenant: tillåten;
  - annan tenant: nekad med `insufficient_company_access`.
- Snapshot-tabellerna `ops_publication_state` och `website_public_contract_snapshots` är RLS-skyddade och endast åtkomliga för `service_role` samt databasägaren.
- De två historiska snapshot-migrationerna är återställda i repositoryt från live-ledgerns exakta statements.

Slutlig migration governance:

| Kontroll | Resultat |
| --- | ---: |
| Manifestfiler | 31 |
| Verifierade filer | 31 |
| Ledger-versioner | 27 |
| Saknas i ledger | 0 |
| Omappade ledger-versioner | 0 |
| Dubbla ledger-mappningar | 0 |
| Ogiltiga checksummor | 0 |
| `is_ready` | `true` |
| Blockers | `[]` |

Runtime schema capabilities:

- `is_ready = true`
- schemafingeravtryck: `d18261edf09683ff4451c334160b4c19c66f504f293766f660489cf72f4890a4`
- inga saknade relationer, funktioner eller kolumner;
- inga funktion-ACL-, RLS-, policy- eller view-security-blockers;
- inga tenantlösa operativa rader eller ogiltiga aktiva API-klienter.

### Avtalsvisning för Gridex-tenant

Canonical readiness för tenant `tenant_60de87cf9c7e4de9936cf3a47f4080dd7a7c` visar ett aktivt websiteavtal:

- namn: `Gridex Månad`
- kanal: `website`
- publicering: `published`
- publiceringsversion: `published`
- tenant assignment: `active`
- kanalstatus: `active`
- fakturaavgift: ready
- prisalternativ: ready
- juridik: ready
- datumfönster: valid
- public offer: ready
- `visible = true`
- blockers: `[]`

Ingen publicerings- eller affärsdata ändrades. OPS-databasen innehåller alltså ett korrekt synligt avtal. Om en deployad tenantwebb fortfarande visar tomt efter koddeploy ligger felet i tenantens deploy, API-nyckel/scopes, requestparametrar eller lokala cache/snapshot-konsumtion – inte i att canonical OPS-avtalet saknas.

## OpenAPI och dokumentation

Ny release `2026-08-03.1` innehåller:

- website OpenAPI SHA-256: `6b8828ff7331dce30d0f34b6c479e65d386033e4eac2a6c3c93f78b1e5f4bb25`
- customer portal OpenAPI SHA-256: `6bd12b1bd36b219737e3a3630471e2d7c5cc9a3bcdf049ce370bee9842e180f4`

Korrigeringar:

1. Webhooken är flyttad från Gridex-hostade `paths` till OpenAPI 3.1 top-level `webhooks`.
2. Webhooken dokumenterar HMAC-requestheaders, replay-/idempotencykrav och generisk lyckad `2xx` från tenantens mottagare.
3. Publika OpenAPI- och release-manifestoperationer har `security: []`.
4. Statiska dokumentresponses dokumenterar och skickar `X-Request-ID`, `ETag`, `Vary`, `Cache-Control`, `Content-Type` och vid behov `Content-Disposition` samt `304 Not Modified`.
5. Felaktiga rate-limitheaders har tagits bort från statiska OpenAPI-responses.
6. Bearer är officiell autentisering. `x-api-key` är dokumenterad som legacy med planerat slutdatum 2026-10-31.
7. Granulära customer portal-scopes är dokumenterade enligt runtime. `customer_portal.read/write` är legacy-umbrella-alias som expanderas server-side.
8. Det kanoniska felkuvertet är dokumenterat med nested `error`, request-ID, correlation-ID och kontraktsversion.
9. Public-contract-schemat innehåller runtimefälten för fullmaktsversion och feed state/empty-feed-bevis.
10. Den tidigare releasen `2026-08-02.1` levereras från arkiverade, immutabla schemafiler och påverkas inte av “latest”.

## Återställda och nya migrationer

- `20260803100040_public_contract_snapshot_shared_schema.sql`
- `20260803100130_public_contract_snapshot_shared_rpc.sql`
- `20260803131558_external_api_contract_database_hardening_v1.sql`
- `20260803131922_external_api_contract_database_hardening_v2.sql`

De två första är återställd historik. De två sista motsvarar de redan applicerade live-hardeningmigrationerna. De ska inte köras manuellt igen mot den nuvarande anslutna databasen; normal migrationsstyrning ska läsa ledgern och endast applicera ej applicerade versioner i andra miljöer.

## Verifieringar

Följande passerar:

```text
npm run api:docs
npm run db:migrations:check
npm run api:compatibility
npm run api:release:verify
npm run api:runtime:parity
```

Kontrollerna omfattar bland annat:

- 41 runtime-routefiler;
- 43 registry-rutter;
- 47 OpenAPI-operationer;
- 54 nåbara schemas;
- kontraktsversion `2026-08-03.1`;
- runtime/OpenAPI-paritet;
- publika avtalsfixtures;
- juridik- och DTO-gränser;
- webhook-, auth-, header- och immutable-release-regressioner;
- 352 SQL-filer, 256 versionsgrupper och registrerade checksummor.

## Kvarvarande verifieringsbegränsning

Full dependencyinstallation kunde inte slutföras i körmiljön eftersom npm-registret inte kunde nås (`EAI_AGAIN`) för bland annat `zod-validation-error-4.0.2.tgz`, Next, Vitest, Vite och React-typer. Därför kunde full `npm run typecheck`, Vitest-svit och Next production build inte slutföras här.

Detta är en nätverks-/dependency-fetchbegränsning, inte ett påvisat kodfel. Ändrade TypeScript/TSX-filer passerade separat syntaxtranspilering, och samtliga repositorybaserade API- och migrationskontroller passerar.

## Deployment

Live-databasen är redan hardenad. Källkod, OpenAPI och dokumentationssida blir publika först när den korrigerade applikationen deployas.

Rekommenderad releasegate i en miljö med fungerande npm-registry:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run api:docs
npm run db:migrations:check
```

Efter Vercel-deploy:

```bash
npm run verify:production-release:2026-08-03
```

Den publika release-manifesten ska därefter rapportera `2026-08-03.1` och samma två OpenAPI-checksummor som ovan.
