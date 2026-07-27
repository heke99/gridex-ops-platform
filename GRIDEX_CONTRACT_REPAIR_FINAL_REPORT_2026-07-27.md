# GRIDEX OPS – slutrapport för avtalsreparation 2026-07-27

## Sammanfattning

Kodbasen har reparerats med två nya framåtriktade migrationer och synkroniserade TypeScript-, admin-, regression- och verifieringsändringar. Den statiska migrations-/kontraktsverifieringen är grön. Full dependency-baserad typecheck, lint, Vitest och Next.js-build kunde inte verifieras i körmiljön eftersom `npm ci` blockerades av registry/DNS-fel. Staging saknade credentials och CLI, så live SQL- och runtime-scenarier är uttryckligen blockerade och inte rapporterade som godkända.

## 1. Rotorsaker

1. `20260727030000_contract_operation_readiness_completion.sql` ersatte tidigare reparerade RPC-definitioner och återinförde okvalificerade `valid_to`-referenser.
2. Regressionen läste en äldre hotfixfil i stället för den sista aktiva funktionsdefinitionen i migrationskedjan.
3. `contract_offers_contract_type_check` låg efter den canonicala TypeScript-/produktmodellen för kvart och mixed.
4. Migrationsmanifestet saknade slugmigrationen.
5. Slugnormalisering tog bort svenska tecken i stället för att translitterera dem.
6. Kanaltexter hade en binär website/API-mappning som gav fel etikett för andra kanaler.
7. UI-texten beskrev `closed` som mer terminalt än den faktiska statusmodellen.

## 2. Sista aktiva RPC-definitioner

Den sista migrationsdefinitionen för båda kritiska funktionerna är nu:

```text
supabase/migrations/20260727160000_contract_valid_to_active_rpc_repair.sql
```

Verifierad definition SHA-256:

```text
gridex_publish_contract_channel:
7e06e019abfbc93a1a7e795bb7bdfe941747893be5d0e78a286ea7fc319c4f4c

gridex_archive_contract_product:
f633c11aa9edc32ab6f17b592261f61dbde65e84d45ede1acf86e894a34a0127
```

Sista-definitionsanalysen identifierade 390 aktiva funktionssignaturer och 0 aktiva okvalificerade `coalesce(valid_to, ...)`-träffar.

## 3. `valid_to`-reparation

Migration `20260727160000_contract_valid_to_active_rpc_repair.sql` återskapar de sista canonicala definitionerna för nio berörda Gridex-funktioner. Den kvalificerar bland annat:

```text
old_channel.valid_to
old_publication_version.valid_to
ch.valid_to
pv.valid_to
ta.valid_to
backfill_publication_version.valid_to
```

Historiska migrationer ändras inte. De 45 kvarvarande textträffarna i äldre migrationsfiler är historiska definitioner som skrivs över av den nya sista migrationen. Slutdefinitionsregressionen kontrollerar nu det faktiska slutresultatet.

## 4. Arkiveringsmodell

`closed` betyder stängd för ny försäljning och fortfarande möjlig att arkivera. `archived` är terminalt och dolt från standardlistor, public contracts, quote och kundansökan.

Den canonicala arkiverings-RPC:n utför i samma transaktion:

- resurslåsning och actor/company-kontroll;
- avslut av öppna kanaler;
- avslut av publiceringsversioner;
- avslut av tenant assignments;
- döljning/inaktivering av public API-rader;
- arkivering av produkt/serie;
- `archived_at`;
- audit;
- idempotent svar för redan arkiverad resurs.

Ingen quote-, ansöknings-, kundavtals-, leverans-, faktura-, juridik- eller audithistorik raderas.

## 5. Slugmodell

Slug är sök-/URL-metadata och inte canonical identitet. Migrationen tar bort konkurrerande globalt eller partiellt unikt slugkrav och behåller/skapar endast:

```text
contract_offers_company_slug_idx
```

som ett vanligt icke-unikt index. Dubbletter per company är tillåtna.

Ny central TypeScript-normalisering och SQL-kompatibel normalisering translittererar svenska tecken, exempelvis:

```text
Gridex Månad -> gridex-manad
ÅÄÖ El -> aao-el
```

Historiska slugs skrivs inte om automatiskt.

## 6. Contract type alignment

Migration `20260727161000_contract_type_slug_alignment.sql` synkroniserar constraints för `contract_offers` och `contract_product_versions` med den canonicala mängden:

```text
fixed
variable_monthly
variable_hourly
variable_quarterly
portfolio
mixed
```

Migrationen stoppar säkert om okända befintliga värden hittas i stället för att tyst förstöra data. Övriga inventerade tabeller har antingen ingen `contract_type`-kolumn eller redan kompatibel modell.

## 7. Migrationsstatus

Nya framåtriktade migrationer:

```text
20260727160000_contract_valid_to_active_rpc_repair.sql
20260727161000_contract_type_slug_alignment.sql
```

Ingen befintlig applicerad migration har ändrats. Inga timestampkollisioner hittades. Migrationskontrollen rapporterar:

```text
Migration integrity check passed (311 files; 216 version groups; checksums verified).
```

## 8. Checksumstatus

Registrerade SHA-256-värden:

```text
20260727150000_contract_offer_slug_identity_completion.sql
b0558538499350b4d91f0bcef1afcf2daa39d2835bfdbcba4c6acd7ad8d19fb1

20260727160000_contract_valid_to_active_rpc_repair.sql
43d23965a8842982e30ff90a4d01b0fb374d898672512ec9611191c5d227372f

20260727161000_contract_type_slug_alignment.sql
597fee23ffd2a123521a279236d236acfa1899cb97a56b0e9032175d639d0cc7
```

## 9. Säkerhetsgrants

Den nya RPC-reparationen återkallar execute från `PUBLIC`, `anon` och `authenticated` för de känsliga funktionerna och ger execute till `service_role`. Server actions fortsätter att använda verifierad sessionsactor; actor-ID ska inte vara klientens source of truth.

`scripts/gridex-contract-repair-post-apply.sql` verifierar live:

- `SECURITY DEFINER`/funktionsdefinition;
- `search_path`/proconfig-utskrift;
- execute-grants;
- service-role-rättighet;
- frånvaro av offentliga execute-rättigheter.

## 10. Adminförändringar

- `Stäng för ny försäljning` skiljs från `Arkivera och dölj`.
- Close-resultatet förklarar att avtalet senare kan arkiveras.
- Central explicit kanaletikett används för `internal`, `api`, `website`, `partner` och `phone`.
- Publicering/avpublicering använder korrekt kanalnamn.
- Cacheinvalidering omfattar båda adminingångarna och public-contract diagnostics.
- `TenantPlatformControls.tsx` hade redan korrekt discriminated-union-narrowing med `operator === "in"` före `eq`/`neq`; ingen `as any` lades till.
- Standardlistor använder gemensamt repositorylager och databaskriterier för att exkludera arkiverat, inte enbart React-filtrering.

## 11. API och OpenAPI

`npm run api:docs` gick grönt och kontrollerade kontrakt, OpenAPI-paritet, dokumentationsversion, exempel och delade komponenter. Ingen extern API-semantik ändrades av reparationen, därför behålls version:

```text
2026-07-27.1
```

API-nyckel och base URL är fortsatt den externa klientens integrationskrav; tenant/company-ID exponeras inte som obligatorisk klientkonfiguration.

## 12. Typecheck

Status:

```text
BLOCKED – dependencies unavailable
```

`npm run typecheck` kördes och avslutades med exit code `2`, men resultatet är inte en giltig källkodsverifiering eftersom `node_modules` saknas. De första felen är modul-/typupplösningsfel för `next`, `react/jsx-runtime` och Node-typer. Den isolerade kontrollen av `lib/contracts/slug.ts` gick med exit code `0`.

## 13. Lint

Status:

```text
BLOCKED – eslint unavailable because npm ci failed
```

`npm run lint` avslutades med exit code `127` och `eslint: not found`.

## 14. Tester

Följande statiska regressioner gick med exit code `0`:

- migration versions;
- migrations checksum check;
- lifecycle repair, 496 checks;
- go-live, 198 controls;
- delete graph;
- security/energy direction;
- tenant lifecycle;
- single source, 90 controls;
- canonical contract model;
- API signature/visibility;
- legal publication completion, 34 controls;
- platform tenant contracts/API/mail;
- API docs.

Vitest/full `npm test` är:

```text
BLOCKED – dependencies unavailable
```

## 15. Build

Status:

```text
BLOCKED – Next.js unavailable because npm ci failed
```

`npm run build` avslutades med exit code `127` och `next: not found`. Build rapporteras inte som grön.

## 16. Stagingresultat

Status:

```text
BLOCKED – staging credentials unavailable
```

`SUPABASE_ACCESS_TOKEN`, projektreferens, databaslösenord och anslutningssträngar saknades. Supabase CLI och `psql` saknades också. Därför har `migration list`, `db push --dry-run`, live `pg_get_functiondef`, grants, SQL postconditions och runtime-scenarier A–H inte körts.

## 17. Externa blockerare

`npm ci --fetch-retries=0 --fetch-timeout=10000` gav:

```text
503 Service Temporarily Unavailable
zod-validation-error-4.0.2.tgz
```

Direkt försök mot npmjs gav:

```text
EAI_AGAIN registry.npmjs.org
```

Dessa är nätverks-/registryblockerare. De ska köras om i användarens normala miljö före release.

## 18. Deployordning

1. Backup och Git-status.
2. Applicera patch och kontrollera diff.
3. `npm ci`.
4. Migrations- och checksumkontroll.
5. Statiska regressioner och API docs.
6. Typecheck, lint, Vitest och build.
7. Staging migration history och dry-run.
8. Databasmigrationer.
9. Live post-apply SQL-verifiering.
10. Applikationsdeploy.
11. Runtime-scenarier för publicering, stängning, arkivering, liknande slug, kontraktstyper, cross-tenant, actor och cache.
12. Audit- och live dokumentationskontroll.

## 19. Rollback

- Applikation: återdeploya föregående verifierade releaseartifact.
- Databas: endast ny framåtriktad rollbackmigration.
- Återintroducera inte okvalificerad `valid_to`, unikt slugkrav, känsliga grants eller återaktivering av arkiverade avtal.
- Radera aldrig historisk kund-, quote-, faktura-, juridik- eller auditdata.

## Acceptansmatris

| Krav | Status |
|---|---|
| Sista aktiva publish/archive-definition reparerad | Grön statiskt |
| Inga aktiva okvalificerade `valid_to` | Grön statiskt, live verifiering blockerad |
| Closed kan arkiveras atomiskt | Kod verifierad, runtime blockerad |
| Arkiverat döljs i standardlistor/public API | Kod/regression grön, runtime blockerad |
| Samma slug kan återanvändas | Schema/reparation grön statiskt, runtime blockerad |
| Inget unikt slugindex i målmodellen | Grön statiskt, live verifiering blockerad |
| Kvartspris och mixed i DB | Grön statiskt, live verifiering blockerad |
| Migration/checksum | Grön |
| Regressioner för sista aktiva funktion | Grön |
| UI closed/archive och kanaltexter | Grön statiskt |
| API/OpenAPI-paritet | Grön |
| Typecheck | Blockerad av dependencies |
| Lint | Blockerad av dependencies |
| Vitest | Blockerad av dependencies |
| Next build | Blockerad av dependencies |
| Staging SQL/runtime | BLOCKED – staging credentials unavailable |
