# Gridex OPS – arkitektur- och dataflödeskarta

## Kanoniskt dataflöde för publika avtal

1. `GET /api/v1/website/public-contracts` autentiseras av `requireIntegrationApiAccess()`.
2. Tenantidentiteten hämtas från API-klienten. `company_id` från query eller body används inte som tenantauktoritet.
3. `loadExternalTenantContext()` ger den externa tenantreferensen och kontraktsversionen.
4. `listPublicContractOffers()` jämför två kanoniska datakällor:
   - `canonical_visible_public_contracts_v` för materialiserad publik avtalsdata.
   - `canonical_public_contract_delivery_readiness_v` för graf, readiness, blockerare och slutlig synlighet.
5. Varje kanoniskt synlig rad berikas med publiceringsversion, prisalternativ, områdespris, fakturaavgift och juridiskt bundle.
6. Alla rader måste kunna byggas och valideras. Ett enda fel stoppar hela färska feeden med `PUBLIC_CONTRACT_FEED_INCONSISTENT`.
7. DTO:n skapas av `mapContractPublicationToPublicDto()` och valideras mot den externa kontraktsmodellen.
8. Ett deterministiskt ETag skapas efter serialisering från tenant, kanal, kundtyp, kontraktsversion, avtal, feedstatus, empty-feed-bevis och eventuell diagnostik.
9. `304` får endast returneras efter att den aktuella representationen har byggts och dess ETag matchar.
10. Tenantintegrationen sparar endast en fullständigt verifierad snapshot. Timeout, HTTP-fel, ogiltig JSON, schemaskevhet eller obehörig tom feed behåller last-known-good.

## Feed och diagnostik

Både normal feed och `/api/v1/website/public-contracts/diagnostics` använder `canonical_public_contract_delivery_readiness_v`. Vyn skiljer på:

- strukturell grafkonsistens,
- tenant-, assignment- och kanalberedskap,
- publicerings- och versionsberedskap,
- snapshot/source-konsistens,
- pris, fakturaavgift och juridik,
- giltighetsfönster,
- successor-kedja,
- slutlig `visible`.

Pris-, juridik-, datum- eller tenantblockerare märks därför inte felaktigt som `PUBLICATION_GRAPH_INCONSISTENT`.

## Tenantinstallation

`provisionTenantWebsiteIntegration()` anropar den kanoniska RPC:n `gridex_provision_tenant_website_client_v1()`:

1. normalisera HTTPS-origins,
2. lås tenant + miljö,
3. säkerställ stabil tenantreferens,
4. skapa eller återanvänd exakt en primär `tenant_website`-klient,
5. sätt kanoniska scopes och origins,
6. skapa credential endast när klienten skapas,
7. spara resumable installationskvitto utan plaintext-secret,
8. kör integration-context-preflight,
9. bygg publik feed,
10. verifiera tenantreferens och kontraktsversion,
11. markera klient och kvitto completed eller failed.

Befintliga dubbletter repareras inte automatiskt. Operatören måste välja credential som ska behållas via `gridex_repair_duplicate_primary_website_client_v1()`.

## Migrationssanning

- Repositoryinventering: SQL-fil, version, SHA-256 och ledger-lämplighet.
- Supabase-ledger, canonical manifest och schemafingerprint måste överensstämma.
- `canonical_migration_readiness_v` är fail-closed.
- `gridex_refresh_platform_schema_state_v2()` kräver verifierat release-ID och schemafingerprint.
- Manifest-SQL-filen är en mall och får inte köras före ren rekonstruktion och live-effektverifiering.

## API-release

Release `2026-08-02.1` synkroniserar:

- runtime-header och body,
- Website Integration OpenAPI,
- Customer Portal OpenAPI,
- immutable versionerade OpenAPI-routes,
- current-routes med `no-store`,
- scope- och error-code-register,
- dokumentation och fixtures,
- release manifest och SHA-256.

## Auditmatris

| ID | Allvar | Fil/funktion/route | Databasobjekt | Tidigare beteende | Korrekt beteende | Migration | Dokumentation | Regression | Bakåtkompatibilitetsrisk |
|---|---|---|---|---|---|---|---|---|---|
| F-001 | P0 | `public-contracts/route.ts`, `GET` | publication revision | `304` kunde returneras före aktuell feed | bygg aktuell representation före villkorssvar | Nej | Ja | Ja | Låg; mer korrekt cache |
| F-002 | P0 | `listPublicContractOffers()` | visible/readiness views | enrichmentfel kunde ge tyst `continue` | fail-closed för hela färska feeden | Ja | Ja | Ja | Medel; fel blir 503 i stället för partiell 200 |
| F-003 | P0 | DTO-loop i route | publication versions | mappingfel kunde ge kortare lista | strukturerat `PUBLIC_CONTRACT_FEED_INCONSISTENT` | Nej | Ja | Ja | Medel |
| F-004 | P0 | feed + diagnostics | diagnostics/graph views | total synlighet användes som grafkonsistens | separat strukturell graf och operationell readiness | Ja | Ja | Ja | Låg |
| F-005 | P0 | tenant fetch-hjälpare | durable snapshot store | processcache/tomt svar kunde radera avtal | verifierad durable last-known-good och timeout | Nej | Ja | Ja | Låg |
| F-006 | P0 | empty-feed metadata | readiness view | tom feed saknade starkt transitionbevis | kanonisk källa, blockerare och offerreferenser krävs | Nej | Ja | Ja | Låg |
| F-007 | P1 | legal DTO/builders | legal bundle documents | fullmakts-ID saknades eller kunde förväxlas med dokumentreferens | exakt module-version UUID exponeras | Nej | Ja | Ja | Additiv |
| F-008 | P1 | provisioning action/service | clients/receipts | flera manuella steg, ej resumable | en idempotent workflow/RPC | Ja | Ja | Ja | Medel |
| F-009 | P1 | API client guard | integration clients | dubbla primärklienter möjliga | DB-lås + guard; explicit repair | Ja | Ja | Ja | Medel |
| F-010 | P0 | migration tooling | ledger/manifest/state | 18 live-ledgerrader, tomt manifest, stale green readiness | fail-closed readiness och checksuminventering | Ja | Ja | Ja | Hög; kräver verifierad rollout |
| F-011 | P1 | API errors | OpenAPI/components | felkoder och envelopes driftade | ett kanoniskt register och envelope | Nej | Ja | Ja | Additiv |
| F-012 | P1 | OpenAPI-routes | release artifacts | current-artifacts kunde ligga stale | current no-store, versionerade immutable | Nej | Ja | Ja | Låg |
| F-013 | P1 | security migration | SECURITY DEFINER | externa roller kunde exekvera trigger/interna funktioner | explicit revoke och service-role only | Ja | Ja | Ja | Hög; måste stagingtestas |
| F-014 | P2 | regressionsskript | flera runtimekedjor | tester pekade på gamla filer/koder/version | tester spårar aktuell kanonisk arkitektur | Nej | Ja | Ja | Ingen |
| F-015 | BLOCKER | migration chain | tre versionsgrupper | dubbla historiska timestamp-versioner | unik, verifierad canonical migrationsordning krävs | Ej löst | Ja | Gate | Hög |
| F-016 | BLOCKER | full build | npm toolchain | intern registry saknar tarball; full install uteblir | ren `npm ci`, lint, typecheck, tests och build | Ej löst | Rapport | Gate | Hög |
| F-017 | BLOCKER | live rollout | Supabase/Auth | advisor-varningar och leaked-password protection kvar live | efterkontroll utan externa WARN, skydd aktiverat | Förberedd delvis | Rapport | Live gate | Hög |
