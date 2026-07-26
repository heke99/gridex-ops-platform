# GRIDEX OPS – slutrapport för avtals-, publicerings- och raderingsreparation

Datum: 2026-07-26  
Kodbas: `gridex-ops-platform-main(78).zip`  
Leveransmigration: `20260727020000_contract_lifecycle_reference_readiness_repair.sql`

## 1. Verifierade rotorsaker

### 1.1 `pco.canonical_offer_reference does not exist`

`pco` är alias för bastabellen `public.public_contract_offers`. Den tabellen skapades utan kolumnen `canonical_offer_reference`, och ingen senare slutlig tabelldefinition lägger till den.

Den canonical externa offertreferensen finns i stället på:

- `public.contract_publication_versions.offer_reference` som primär källa;
- metadatafältet `offer_reference` eller `canonical_offer_reference` endast som legacy-fallback;
- vyn `canonical_public_contract_offers_v`, där värdet projiceras som `canonical_offer_reference`.

Felet återintroducerades i de senaste funktionsdefinitionerna för close och delete-preview genom direkt SQL mot `pco.canonical_offer_reference`. Det är alltså inte ett cachefel eller ett saknat deploysteg, utan en faktisk schema-/runtime-mismatch.

### 1.2 `contract_version_not_publishable`

Den tidigare slutliga definitionen av `gridex_publish_internal_contract_version` låste `contract_offers` och kastade SQLSTATE `23514` med meddelandet `contract_version_not_publishable` när `lifecycle_status` inte låg i `draft`, `ready` eller `paused`.

Detta skedde innan den fullständiga readinessrapporten returnerades. Därför fick admin bara ett generiskt fel och kunde inte se om den blockerande statusen var exempelvis `published`, `expired`, `closed`, `archived` eller `superseded`, eller om pris-, assignment-, kanal- eller juridikdata saknades.

Den exakta live-statusen för den felande produktionsraden kan inte fastställas från ZIP-filen. Den kontrollen är markerad **BLOCKED** tills migrationen körts mot en auktoriserad staging-/produktionsdatabas. Den nya RPC:n returnerar statusen och exakta blockerare i svaret.

### 1.3 Readiness laddades med fel RPC-parameter

`/admin/contracts` anropade tidigare readiness med `p_offer_id`. Databasfunktionen använder `p_contract_offer_id`. Det gjorde att readiness kunde misslyckas oberoende av avtalets verkliga data.

### 1.4 Actor saknades i safe-action-loggar

Båda adminingångarna hade redan autentiserat aktören före mutation, men deras catch-/persistensväg skickade inte vidare användar-ID. Därför kunde loggen visa `userId: null` trots en inloggad superadmin.

### 1.5 Företagssidan använde en billig listvy som delete-preview

`TenantPlatformControls` läste `deletion_preview` från `canonical_internal_contract_offers_v`. Den billiga listvyn är avsiktligt byggd för stabil listning och ska inte köra full dependency graph per rad. Det senaste schemat returnerar därför ingen verklig preview där. Resultatet blev att radering antingen var permanent blockerad i UI eller byggde på ofullständig information.

## 2. Canonical avtalsdomän

Verifierad huvudkedja:

1. `contract_offers` – internt administrativt avtalsobjekt och lifecycle-ankare.
2. `contract_products` – canonical produktidentitet.
3. `contract_product_versions` – immutable produkt-/avtalsversion.
4. `price_plans` och `price_plan_versions` – prisdefinition och låst prisversion.
5. `tenant_contract_assignments` – tenantens tilldelning av exakt produktversion.
6. intern/website/API-kanal – säljbarhets- och publiceringskanal.
7. `contract_publication_versions` – immutable publiceringsversion och canonical `offer_reference`.
8. `public_contract_offers` – materialiserad publik offertyta, inte källa för canonical referensnamn.
9. `website_contract_quotes` – offert bunden till produkt-, publicerings-, pris-, snapshot-, juridik-, resolution- och tenantdata.
10. `website_customer_applications` – kundansökan med top-level `quote_reference` och exakt produktversionsreferens.
11. `customer_contracts` – signerat/aktivt kundavtal.
12. leverans-, produktions-, billing- och fakturakedjor – supply periods, billing underlays, ledger/export och `customer_invoices`.

Legacyfält och metadata läses endast defensivt. Nya lifecycle-/delete-skrivvägar använder den canonical grafen och `contract_publication_versions.offer_reference`.

## 3. Genomförda korrigeringar

### Databas

Den nya framåtriktade migrationen:

- inför `gridex_contract_offer_references_v1` för tenant-säker upplösning av canonical offer references;
- frågar aldrig `public_contract_offers.canonical_offer_reference`;
- inför `gridex_contract_readiness_blocker_details_v1` med `{code, field, message}`;
- inför `gridex_contract_delete_blocker_details_v1` med `{resource_type, count, reason, message}`;
- återskapar `gridex_validate_contract_readiness` med central modell-, pris-, resolution-, assignment-, kanal-, legal- och go-live-kontroll;
- återskapar `gridex_publish_internal_contract_version` så förväntade affärsblockerare returneras som strukturerad JSON i stället för dold SQLSTATE;
- gör redan publicerad version idempotent med `contract_already_published`;
- återskapar delete preview och delete commit så båda använder samma dependency graph;
- återskapar remove/close-vägar med canonical referensfunktion;
- behåller tenantisolering, låsning, audit och service-role-gräns för destruktiva RPC:er.

### Admin `/admin/contracts?company_id=...`

- Korrigerat readiness-parametern till `p_contract_offer_id`.
- Behåller explicit `company_id` genom länkar, formulär, redirect och pagination.
- Lazy-laddar readiness och delete preview endast för vald rad.
- Visar strukturerade blockerare med kod, fält, antal och meddelande.
- Visar begränsande foreign keys separat.
- Visar rena systemberoenden som får raderas atomiskt separat.
- Maskerar inte diagnostikfel som tom avtalslista.
- Publish-action visar faktisk blockerare i admin.
- Safe-action-loggen försöker alltid bevara autentiserat actor-ID.

### Admin `/admin/companies/<company-id>`

- Länken till central avtalsförvaltning behåller `company_id`.
- Samma canonical interna offer-ID används för redigering, readiness, preview, archive och delete.
- Readiness och delete preview körs lazy via `diagnose_contract`.
- Permanent delete är inaktiverad tills samma server-side preview uttryckligen returnerar `can_delete/deletable = true`.
- Arkivering är separat från fysisk radering.
- Publika offerter och interna produkter pekar tillbaka till samma canonical källa.
- Safe-action-loggning bevarar actor-ID.

## 4. Publiceringsreadiness

Den centrala readinessfunktionen kontrollerar nu minst:

- tenant och kontraktets existens;
- lifecycle-status;
- namn;
- canonical produkt och exakt version;
- versionens produkttillhörighet;
- tenant assignment i `active` eller `paused` läge;
- intern kanal;
- prisplan, prisversion och prisbok/snapshot;
- explicit fakturaavgift och giltig moms;
- fastpris per kWh;
- price areas och dubbletter;
- faktisk och förväntad interval resolution;
- validity, max customers, renewal och discountfält;
- portfölj-ID och mixvikter;
- produktionsavtalets settlement mode;
- tenantens go-live-/routingberedskap;
- juridisk profil och obligatoriska publicerade juridikmoduler.

Exempel på nytt blockeringssvar:

```json
{
  "ok": false,
  "changed": false,
  "code": "contract_version_not_publishable",
  "lifecycle_status": "closed",
  "blocker_codes": ["lifecycle_status_not_publishable"],
  "blockers": [
    {
      "code": "lifecycle_status_not_publishable",
      "field": "lifecycle_status",
      "message": "Nuvarande lifecycle-status kan inte publiceras. Skapa eller öppna ett draft, ready eller paused-utkast."
    }
  ],
  "readiness": {}
}
```

## 5. Canonical statusmaskin

Databasens slutliga lifecycle-värden är:

- `draft`
- `ready`
- `published`
- `paused`
- `expired`
- `closed`
- `archived`
- `superseded`

`deleted` är inte en mjuk status. Det betyder fysisk radering efter godkänd preview och ny kontroll i commit-transaktionen.

Praktiska övergångar:

- `draft -> ready`
- `ready -> published`
- `paused -> published`
- `published -> paused`
- publicerad kanal -> avpublicerad/paused enligt kanalflödet
- `published|paused -> closed`
- `closed -> archived`
- `draft|ready` och helt oanvänd -> fysisk delete
- immutable publicerad version ändras inte; ändrad avtals-/prisdata skapar ny version
- `expired`, `closed`, `archived` och `superseded` är inte publicerbara via samma version

## 6. Delete dependency graph

Preview och commit kontrollerar samma graf.

### Affärs- och bevarandeblockerare

- kundavtal;
- accepterade kundansökningar;
- externa intag;
- bindande prissnapshots;
- website quotes;
- fakturor;
- billing underlays och underlay items;
- charge ledger;
- juridiska accepter;
- successor-versioner;
- delade canonical produktversioner;
- delade juridikversioner;
- inkonsekvent publiceringsgraf;
- restricting foreign keys;
- annan lifecycle-status än `draft` eller `ready`.

### Raderbara tekniska beroenden

När ingen affärshistorik finns får commit radera den interna, tenantbundna grafen i säker ordning, bland annat:

- public offers;
- tenant assignments;
- publications;
- publication versions;
- endast unika juridikbundle-versioner;
- backfill-issue-rader;
- därefter canonical draft-/product-/price-rader som inte delas.

Commit kör preview igen i samma transaktion under lås. Det eliminerar TOCTOU mellan UI-preview och delete commit. Raderingen är idempotent på domännivå: en redan borttagen resurs returnerar not-found utan att en annan tenants data påverkas.

## 7. Modell- och resolutionstöd

| Modell | Canonical resolution | Readiness/quote-bindning | Resultat |
|---|---|---|---|
| Portfölj | `portfolio` eller vald mix-resolution | Kräver portfölj-ID, versionerad snapshot och giltiga vikter | Stöds och kontrolleras |
| Fastpris | `fixed` | Kräver positivt kWh-pris; price areas hanteras i snapshot/offert | Stöds och skiljs från spot |
| Rörligt månadspris | `monthly` | Exakt resolution måste matcha snapshot och price version | Stöds |
| Rörligt timpris | `hourly` | Får inte falla tillbaka till monthly | Stöds |
| Rörligt kvartspris | `quarterly` | 15-minutersupplösning bevaras i SQL/TS/API-flödet | Stöds |
| Mix/hybrid | `monthly`, `hourly` eller `quarterly` enligt snapshot | Vikter måste summera till 100 % | Stöds när modellen finns i data |
| Produktion/inmatning | explicit `energy_direction=production` plus resolution | Kräver production settlement mode; behandlas inte som negativ konsumtion | Stöds explicit |

Denna leverans ändrar inte extern prisberäkning eller DTO. Den skärper publiceringsgränsen så fel resolution eller saknad production settlement blockerar publicering med synlig orsak.

## 8. Website-API, OpenAPI och utvecklardokumentation

Verifierade runtime-routes:

- `GET /api/v1/integration/context`
- `GET /api/v1/website/public-contracts`
- `GET /api/v1/website/public-contracts/diagnostics`
- `POST /api/v1/website/energy-area/resolve`
- `POST /api/v1/website/market-price/current`
- `POST /api/v1/website/quote`
- `POST /api/v1/website/quote/validate`
- `POST /api/v1/website/customer-applications`
- `GET /api/v1/website/legal-bundle`
- `GET /api/v1/customer/portal-bundle`
- customer invoice list/detail endpoints.

Observera att legal bundle är `GET /api/v1/website/legal-bundle`, inte `POST /website/legal/bundle`.

Denna patch ändrar inte ett publikt DTO eller endpointkontrakt. API-/dokumentationsversionen ligger därför kvar på `2026-07-25.1`. Route-registry, OpenAPI-operationer, versionsmarkörer, exempel och delade komponenter är verifierade mot runtime och passerar. API-nyckel och bas-URL är fortfarande den externa websiteintegrationens konfiguration; tenant hämtas från integration context och extern klient behöver inte skicka `company_id`.

## 9. Ändrade och tillagda filer

Ändrade:

1. `app/admin/contracts/actions.ts`
2. `app/admin/contracts/page.tsx`
3. `app/admin/companies/[id]/tenant-platform-actions.ts`
4. `app/admin/companies/[id]/TenantPlatformControls.tsx`
5. `app/admin/companies/[id]/page.tsx`
6. `lib/contracts/lifecycleErrors.ts`
7. `scripts/migration-history-manifest.json`
8. `docs/ai-context/10_CHANGELOG.md`

Tillagda:

9. `supabase/migrations/20260727020000_contract_lifecycle_reference_readiness_repair.sql`
10. `GRIDEX_CONTRACT_LIFECYCLE_REFERENCE_READINESS_REPAIR_2026-07-26.md`
11. `GRIDEX_CONTRACT_LIFECYCLE_VERIFICATION_2026-07-26.log`

## 10. Migrationer i körordning

Den nya migrationen ska köras efter samtliga tidigare migrationer, särskilt:

1. `20260726010000_contract_tenant_lifecycle_completion.sql`
2. `20260726140000_contract_deletion_graph_completion.sql`
3. `20260726230000_contract_admin_api_alignment.sql`
4. `20260727010000_contract_flow_integrity_completion.sql`
5. **`20260727020000_contract_lifecycle_reference_readiness_repair.sql`**

Ändra eller återkör inte äldre migrationsfiler manuellt. Den nya filen ersätter de slutliga funktionsdefinitionerna framåt.

## 11. Legacy-/parallellvägar

- `public_contract_offers` behålls som publik/materialiserad yta men är inte canonical källa för offertreferensen.
- `canonical_public_contract_offers_v` får fortsatt exponera aliaset `canonical_offer_reference` för läsning.
- Metadatareferenser används endast som legacy-fallback.
- Destruktiva och lifecycle-skrivvägar går via canonical source offer, product version, assignment och publication version.
- Företagssidan och central admin använder nu samma source offer-ID och samma RPC:er för preview/commit.
- Billig listning och tung diagnostik är separerade; listvyn kör inte delete graph per rad.

## 12. Verifieringsresultat

| Kontroll | Resultat |
|---|---|
| Migration history/checksum | PASS – 305 filer, 210 versionsgrupper |
| Contract tenant lifecycle completion regression | PASS |
| Contract lifecycle repair regression | PASS – 81 kontroller |
| Specifika statiska kontroller för canonical ref/readiness/delete/actor | PASS – 11/11 |
| TypeScript/TSX syntaxtranspilering av 6 ändrade kodfiler | PASS |
| Public API route contract | PASS – 34 route-filer |
| OpenAPI/runtime parity | PASS – 36 registry-routes, 38 operationer |
| API docs version parity | PASS – `2026-07-25.1` |
| API documentation examples | PASS |
| Shared OpenAPI responsibility boundaries | PASS |
| Full `npm ci` | BLOCKED – paketregistret svarade HTTP 503 |
| Full `npm run typecheck` | BLOCKED av dependency installation |
| Full `npm run lint` | BLOCKED av dependency installation |
| Full `npm run build` | BLOCKED av dependency installation |
| Migration apply mot riktig DB | BLOCKED – ingen Supabase CLI/psql eller auktoriserad DB i miljön |
| Exakt status/data för de två angivna produktionsreferenserna | BLOCKED – kräver live/staging DB |
| Extern provider/marknadsdata | Inte förändrad av patchen; livekontroll BLOCKED utan credentials |

## 13. Deployordning

1. Säkerhetskopiera databas och aktuell release.
2. Synka de ändrade filerna.
3. Kör `npm ci` i en miljö där paketregistret fungerar.
4. Kör migrationskontroll.
5. Applicera endast nya migrationer, i ordning.
6. Kör typecheck, lint och production build.
7. Deploya applikationen efter lyckad migration.
8. Kör staging-smoke:
   - öppna båda adminingångarna för samma tenant;
   - kör readiness på felande avtal;
   - verifiera att faktisk status/blockerare visas;
   - publicera ett komplett `ready`-avtal;
   - pausa, återpublicera, stäng och arkivera;
   - preview + delete av helt oanvänt draft;
   - verifiera att använt avtal blockeras och rekommenderar archive;
   - kontrollera public-contracts före och efter lifecycle-ändring.
9. Kontrollera safe-action-/auditloggen för korrekt actor, company och offer-ID.

## 14. Rollbackplan

Applikationsrollback:

- deploya föregående applikationsrelease;
- återställ inte gamla migrationsfiler.

Databasrollback:

- migrationen ändrar främst funktionsdefinitioner och lägger till hjälpfunktioner;
- säkrast rollback är en ny framåtriktad rollbackmigration som återskapar föregående funktionsdefinitioner från `20260727010000`/tidigare release;
- droppa inte tabeller, canonical data eller kundhistorik;
- återinför aldrig `pco.canonical_offer_reference` som direkt tabellreferens;
- om snabb rollback krävs, återställ föregående funktioner från databasbackup och följ upp med en registrerad framåtriktad migration.

## 15. Synkroniseringskommandon

Patch-ZIP i `~/Downloads`:

```bash
rm -rf /tmp/gridex-contract-lifecycle-patch
mkdir -p /tmp/gridex-contract-lifecycle-patch

unzip -q \
  "$HOME/Downloads/gridex-ops-contract-lifecycle-patch-2026-07-26.zip" \
  -d /tmp/gridex-contract-lifecycle-patch

rsync -av --checksum --itemize-changes --dry-run \
  /tmp/gridex-contract-lifecycle-patch/gridex-ops-contract-lifecycle-patch-2026-07-26/files/ \
  /Users/hekmath/Projects/gridex-ops-platform/

rsync -av --checksum --itemize-changes \
  /tmp/gridex-contract-lifecycle-patch/gridex-ops-contract-lifecycle-patch-2026-07-26/files/ \
  /Users/hekmath/Projects/gridex-ops-platform/

cd /Users/hekmath/Projects/gridex-ops-platform
npm ci
npm run db:migrations:check
npm run typecheck
npm run lint
npm run build
```

Applicera databasmigration enligt projektets normala Supabase-releaseflöde. Om projektet är länkat med Supabase CLI:

```bash
cd /Users/hekmath/Projects/gridex-ops-platform
supabase migration list
supabase db push
```

Kör därefter de relevanta statiska lifecycle-kontrollerna:

```bash
npm run gridex:contract-tenant-lifecycle-completion-regression
npm run gridex:contract-lifecycle-repair-regression
npm run api:docs
```

Live DB-kontroller, när `DATABASE_URL` och test-ID:n är satta:

```bash
npm run gridex:contract-live-schema-check
npm run gridex:contract-db-lifecycle-test
npm run gridex:contract-multitenant-test
```

## 16. Slutsats

Den konkreta `42703`-rotorsaken är borttagen i den slutliga runtime-definitionen, utan att lägga till en duplicerad kolumn. Publicering returnerar nu precisa blockerare, båda adminingångarna använder samma canonical offer och samma delete preview, och permanent delete kräver ett aktuellt serverbeslut från samma dependency graph som commit.

Det som återstår är inte ytterligare kodanalys utan miljöberoende verifiering: applicera migrationen i staging, läsa den felande live-radens faktiska lifecycle/readiness, köra full dependency-installation/typecheck/lint/build och sedan genomföra staging-scenarierna ovan.
