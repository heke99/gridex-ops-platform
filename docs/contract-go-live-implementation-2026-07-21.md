# Gridex OPS – canonical avtalslivscykel, go-live implementation

Datum: 2026-07-21  
Bas: `gridex-ops-platform-main(52).zip`  
Migration: `20260720233000_contract_product_lifecycle_go_live_completion.sql`

## Resultat

Avtalsadministrationen är ombyggd kring en permanent canonical produktserie. Intern försäljning, webb, API, partner och telefon är kanaler för exakta immutable produktversioner. Ett formulär kan endast spara `draft` eller `ready`; publicering, kanalväxling, paus, arkivering och permanent radering är separata readiness- och RBAC-skyddade kommandon.

Legacy-tabellerna `contract_offers` och `public_contract_offers` finns kvar som kompatibilitetsytor, men de får inte längre skapa fristående pris-, juridik- eller produktidentiteter.

## Arkitektur

```text
contract_products                      permanent produktserie
└── contract_product_versions          immutable kommersiell version
    ├── price_plan_versions            låst prisversion
    ├── price_books                    låst prisbok
    ├── legal_bundle_versions          låst juridikversion
    ├── tenant_contract_assignments    tenantens tilldelning
    │   └── tenant_contract_channels   internal / website / api / partner / phone
    ├── contract_publications
    │   └── contract_publication_versions
    └── customer_contracts             exakta signerade bindningar och snapshots
```

## Viktiga säkerhetsprinciper

- Nya avtal börjar alltid som utkast.
- Endast `draft` och `ready` får sparas via redigeringsformuläret.
- Publicering är ett separat kommando och låser samma pris-, produkt- och juridikidentitet.
- Publicerad data skrivs inte över. En kommersiell ändring skapar en efterföljande version i samma serie.
- Kanalväxling sker kanal för kanal. En ny intern version stänger inte gammal webb/API-version innan motsvarande kanal har publicerats för efterföljaren.
- Ett oanvänt utkast kan raderas exakt, även när en äldre version i samma serie har kundhistorik.
- Permanent radering faller aldrig tyst tillbaka till arkivering.
- Arkivering är serieomfattande och irreversibel. Återstart sker genom ny version, så gammal juridik eller gamla kanaler inte kan återupplivas av misstag.
- Kundavtal, signaturer, snapshots, fakturor och andra affärshändelser blockerar permanent radering.

# Implementationsmatris – samtliga 36 punkter

## P0

### 1. En canonical källa
**Implementerat.** Bolagssidan kan endast publicera en befintlig canonical avtalsversion till webbkanalen. Den kan inte längre skapa en separat pris- eller juridikmodell. `source_contract_offer_id` krävs för varje `public_contract_offers`-rad.

### 2. Permanent produktserie och immutable versioner
**Implementerat.** `version_series_id` är stabil. Efterföljare behåller `contract_product_id` och får ny immutable `contract_product_version_id`. Föregångaren ersätts först när relevant kanal har flyttats.

### 3. Fullständig arkivering
**Implementerat.** `gridex_archive_contract_product` låser serien, stänger assignments, kanaler, publikationer och publika kompatibilitetsrader, behåller kundhistorik och skriver audit-logg.

### 4. Permanent radering av oanvända utkast
**Implementerat.** `gridex_preview_delete_unused_contract` och `gridex_delete_unused_contract` arbetar på exakt offer-/produktversion och raderar endast exklusiva olåsta systemreferenser.

### 5. Foreign-key-säker radering
**Implementerat.** Den cirkulära kompatibilitetskopplingen mellan `public_contract_offers.contract_publication_version_id` och `contract_publication_versions.legacy_public_contract_offer_id` bryts explicit innan radering. Källa och kompatibilitetsrad tas bort före juridik- och produktversioner.

### 6. Säker rensning av testavtal
**Implementerat.** `gridex_cleanup_unused_contract_drafts` har dry-run/apply, tenantavgränsning, dependency-preview, resultat per avtal, audit och transaktionell rollback vid fel.

### 7. Arkiverade avtal döljs som standard
**Implementerat.** Standardfrågor filtrerar `archived` och `superseded`; administrationsvyn har separat `Visa arkiverade`.

### 8. Tydliga raderingsåtgärder
**Implementerat.** UI skiljer `Arkivera avtal` från `Radera oanvänt utkast permanent`. Raderingsknappen aktiveras endast när preview anger `deletable=true`.

### 9. Giltighetsperiod verkställs
**Implementerat.** Listning, canonical view, publicering och atomisk kundavtalstrigger kontrollerar lifecycle, assignment, kanal, `valid_from` och `valid_to`.

### 10. En statuskälla
**Implementerat.** Användaren styr endast lifecycle. Legacy `status/is_active` härleds av RPC och kan inte sättas motsägelsefullt från formuläret.

### 11. Utkast som standard
**Implementerat.** Nytt avtal sparas som `draft`. `ready` betyder redo för publiceringskontroll, inte publicerat.

### 12. Gemensamt formulär-/serverkontrakt
**Implementerat.** `lib/contracts/adminContractSchema.ts` används för formulärvalidering och payloadbyggande. RPC:n har dessutom egna skydd mot ogiltiga direktanrop.

### 13. Automatisk prisversion
**Implementerat.** Prisversion visas skrivskyddat och genereras atomiskt av prisversionsmotorn.

### 14. Rabattmodell
**Implementerat.** Värde, enhet, beräkningsbas, månader och startläge sparas i version/snapshot. Procent begränsas till 0–100 och rabatt kräver positiv period.

### 15. Automatisk förlängning
**Implementerat.** UI, schema, RPC, juridikmaterialisering och snapshot stöder automatisk förlängning och förlängningsperiod.

### 16. Fullmaktsläge
**Implementerat.** Enum: `always_required`, `required_when_information_missing`, `not_required`. Boolean härleds från enum även i databasen.

### 17. Kundtak
**Implementerat.** Triggern `gridex_enforce_contract_availability_and_capacity` använder transaktionslås/advisory lock och räknar reserverade/pågående/signerade/aktiva kundavtal över produktserien.

### 18. Portfölj- och mixandelar
**Implementerat.** Typanpassade defaults och validering till exakt 100 %. Portfölj-ID och efterhandsprissättningsmodell låses i snapshot.

### 19. Strukturerade extra avgifter
**Implementerat.** Avgifter lagras med ID, namn, belopp, enhet, bas, frekvens, lifecycle, webbsynlighet, momsbehandling och sortering.

### 20. Legacyfält
**Implementerat.** Legacyfält får inte skapa fristående canonical data. Juridik genereras från publicerade juridikmoduler; fasta priser per område ingår i canonical prissnapshot.

### 21. Redigering och ny version
**Implementerat.** Olåsta utkast redigeras på plats. Låsta/publicerade versioner öppnar ett nytt utkast i samma serie. UI har visa, redigera/skapa version, publicera, kanalstyrning, paus, arkiv och säker radering.

### 22. Enhetliga API-felkoder
**Implementerat.** Primär kod är `offer_reference_mismatch`; `offer_selector_mismatch` finns endast som `legacy_code` för bakåtkompatibilitet. OpenAPI och guide är uppdaterade.

### 23. Aktuella regressionstester
**Implementerat.** Tester använder nuvarande canonical publicerings- och finaliseringsflöde och hårdkodar inte den tidigare dokumentationsversionen.

### 24. Fält-roundtrip
**Implementerat som två stagingverktyg.** REST-baserat field roundtrip samt ett transaktionellt psql-test för hela lifecycle. Båda är staging-only och lämnar ingen data efter lyckat test/rollback.

### 25. Finmaskig RBAC
**Implementerat.** `contracts.create`, `contracts.edit_draft`, `contracts.create_version`, `contracts.publish`, `contracts.pause`, `contracts.archive`, `contracts.delete_unused`, `pricing.read`, `pricing.write`, `pricing.publish`. Superadmin har implicit rätt; andra roller måste vara delegerbara och ha explicit permission.

### 26. Cacheinvalidisering
**Implementerat.** Alla mutationer invalidiserar admin-, kundintags-, public-contract-, quote- och website-ytor samt tenant-/produkt-/versionsrelaterade taggar.

### 27. Live-schema driftkontroll
**Implementerat.** `gridex_verify_contract_schema_alignment` och `gridex-contract-live-schema-check.cjs` verifierar funktioner, kolumner, public source binding och model version.

## P1

### 28. Återställning av arkiverat avtal
**Löst genom säker policy.** Arkivering är irreversibel. RPC:n avvisar återställning med `archived_contract_requires_new_version`; användaren skapar en ny version. Detta förhindrar dubbla assignments och återupplivning av gammal juridik.

### 29. Gemensam readiness-gate
**Implementerat.** Kontrollerar canonical prisidentiteter, fakturaavgift, moms, prisområden, fast pris, portföljmodell, vikter, rabatt, förlängning, juridikmoduler, tenantens juridikprofil och operativa go-live-beredskap.

### 30. Samlade fältvalideringar
**Implementerat.** UI/shared schema, prisnormalisering, SQL constraints och readiness-RPC delar ansvaret. Direkt-RPC-anrop kan inte kringgå kritiska regler.

### 31. Faktureringskoppling
**Implementerat/verifierat statiskt och med regression.** Kundkontrakt och fakturering använder låsta `price_plan_version_id`, `price_book_id`, publication/legal IDs och kundens contract price snapshot, inte senaste adminversion.

### 32. Offert och ansökan låser samma version
**Implementerat.** Finalisering binder product, product version, publication version, price snapshot, legal bundle och offer reference. Mismatch nekas.

### 33. Audit
**Implementerat.** Skapande, ny version, publicering, kanalpublicering, avpublicering, paus, arkiv, radering och RBAC-skyddade mutationer loggar actor, tenant, entity/version och metadata/before/after där relevant.

## P2

### 34. Tydlig lifecycle-vy
**Implementerat.** Avtalskort visar serie, version, status, giltighet, kanaler, kundantal, readiness och deletion preview.

### 35. Kundförhandsgranskning
**Implementerat.** Adminvyn visar kundens prisrad, avgifter, villkor, juridik-/readinessinformation med samma canonical DTO-data som publiceringsflödet.

### 36. Versionsjämförelse
**Implementerat.** UI visar förändringar mellan vald version och föregångare för priser, avgifter, villkor, giltighet och kanaler innan publicering.

# Nya/centrala RPC:er

- `gridex_upsert_internal_contract_offer`
- `gridex_publish_internal_contract_version`
- `gridex_validate_contract_readiness`
- `gridex_publish_contract_channel`
- `gridex_unpublish_contract_channel`
- `gridex_pause_contract_channels`
- `gridex_archive_contract_product`
- `gridex_restore_archived_contract` – fail-closed, kräver ny version
- `gridex_preview_delete_unused_contract`
- `gridex_delete_unused_contract`
- `gridex_cleanup_unused_contract_drafts`
- `gridex_verify_contract_schema_alignment`

# Testverktyg

## Kod-/kontraktsverifiering

```bash
npm run verify:contract-go-live
npm run db:migrations:check
npm run typecheck
npm run lint
npm run build
```

## Live-schema efter applicerad migration

```bash
SUPABASE_URL="https://<projekt>.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
npm run gridex:contract-live-schema-check
```

## Full transaktionell lifecycle i staging

Kräver en staging-tenant som har komplett juridik- och operativ go-live readiness. Testet avslutas med `ROLLBACK`.

```bash
DATABASE_URL="postgresql://..." \
GRIDEX_CONTRACT_TEST_COMPANY_ID="<staging-company-uuid>" \
GRIDEX_CONTRACT_TEST_ACTOR_ID="<superadmin-or-delegated-actor-uuid>" \
npm run gridex:contract-db-lifecycle-test
```

Testet bevisar:

1. utkast och canonical identitet,
2. readiness-publicering utan byte av pris-/produkt-ID,
3. webbpublicering,
4. avpublicering och återpublicering med samma publication identity,
5. efterföljande utkast utan tidig supersede,
6. exakt säker radering av efterföljande utkast,
7. kanalvis intern/webb-handover utan webbglapp,
8. serieomfattande arkivering,
9. full rollback.

# Verifieringsstatus i byggmiljön

Grönt:

- PostgreSQL-parser: 97 migrationsstatements.
- DB lifecycle-testparser: 6 statements efter psql-variabelsubstitution.
- Fokuserad TypeScript-kontroll.
- Fokuserad ESLint för samtliga ändrade TS/TSX-filer.
- `verify:contract-go-live`.
- 148 go-live-strukturkontroller.
- 20 fokuserade Vitest-tester.
- 118 canonical portfolio-kontroller.
- Canonical contract/legal/publication regression.
- Canonical invoice fee regression.
- Public pricing visibility regression.
- Contract API/signature/visibility regression.
- Legal publication completion regression.
- Next.js control-flow regression.
- Migration checksum/integritetskontroll: 286 migrationsfiler.

Inte verifierat mot live/staging-databas i denna miljö:

- faktisk applicering av migrationen,
- live-schema-check,
- transaktionellt DB lifecycle-test.

Full projekt-`typecheck` och full projekt-`lint` gav inga rapporterade fel men nådde miljöns timeout. Fokuserade kontroller för hela patchytan är gröna. Full production build måste slutföras lokalt/CI efter synk och migration innan go-live-signering.
