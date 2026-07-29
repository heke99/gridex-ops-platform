# Gridex – komplett kommersiell avtalsmodell och valflöde

Datum: 2026-07-29  
Leveransstatus: **Applikationskod klar och lokalt verifierad. Release NO-GO tills blockerarna i avsnittet Releasegrind är lösta.**

## Resultat

Leveransen inför en gemensam, versionsstyrd och fail-closed kommersiell modell för avtal, offert, kundansökan, avtalssnapshot, prisberäkning, fakturaunderlag och externt API.

Modellen har:

- stabila affärsreferenser för prisalternativ, områdespriser och priskomponenter;
- bindningstid 12/24/36 månader och exakta giltighetsdatum;
- separata avtalsflöden för fast, rörligt månadspris, rörligt timpris, rörligt kvartpris, portfölj och mix;
- fasta priser per SE1–SE4;
- obligatoriska, kundvalbara, administratörsvalbara och villkorsstyrda komponenter;
- leveranssätt för faktura och villkor för kundtyp, kanal, prisområde, avtals-/prisalternativ, anläggningsantal, årsförbrukning och datum;
- livscykel för återkommande, första avtalsperioden, årlig och händelsestyrd debitering;
- en exakt, signerad och oföränderlig snapshot som återanvänds från offert till fakturaunderlag;
- atomära databasfunktioner för intern avtalsmall och internt kundavtal;
- RLS, tenant-/versionskontroller, immutabilitet, publiceringsgrind och deterministisk legacy-backfill med granskningskö för tvetydiga rader.

## Synkroniserade huvudflöden

1. Administratören definierar avtalsvariant, prisalternativ, SE1–SE4-priser, fakturametoder och komponentregler i strukturerade formulär.
2. Serverschemat validerar hela modellen och sparar den atomärt med stabila referenser.
3. Publicerings-DTO:n exponerar samma affärsreferenser och regler, men inga interna databas-ID:n.
4. Webbplatsens offert-API skickar vald prisreferens, fakturametod, kundvalda komponenter och anläggningsantal.
5. Servern avgör obligatoriska, villkorsstyrda och tillåtna val och signerar de exakt upplösta raderna.
6. Kundansökan och avtalssnapshot måste matcha offerten; databastriggern avvisar avvikande identiteter, val eller hash.
7. Intern avtalsregistrering använder samma resolver och vägrar förbrukningsvillkor om anläggningen saknar verifierad årsförbrukning.
8. Pris- och fakturamotorerna använder snapshotens exakta rader och respekterar urval, villkor, anläggningsmultiplikator och debiteringslivscykel.

## Databasleverans

Ny migration:

`supabase/migrations/20260729200000_contract_commercial_selection_completion.sql`

SHA-256:

`59c19820866d186567914b12fcf831cc94c769ba200038034fbc4e172603d80c`

Hashen matchar `scripts/migration-history-manifest.json`.

Ny statisk regressionskontroll:

`scripts/gridex-contract-commercial-selection-regression.cjs`

Ny post-apply-kontroll:

`scripts/gridex-contract-commercial-selection-post-apply.sql`

## Verifiering

Följande kontroller har körts på det levererade tillståndet:

| Kontroll | Resultat |
|---|---|
| ESLint för ändrad runtimekod | Godkänd |
| `npm run typecheck` | Godkänd |
| `npm run typecheck:tests` | Godkänd |
| `npm test` | 57 testfiler, 366 tester, samtliga godkända |
| Fokuserade kommersiella regressionstester | Godkända |
| `npm run gridex:contract-commercial-selection-regression` | Godkänd |
| `npm run api:docs` | Godkänd |
| Ren `npm run build` | Godkänd |
| Ny migrations SHA mot manifest | Godkänd |
| `npm run db:migrations:check` | Blockerad enbart av historisk checksummeavvikelse nedan |

Bygget kördes med lokal Node `v24.14.0`. Projektets deklarerade releaseintervall är Node `>=22 <23`; CI/staging ska därför upprepa kontrollerna med Node 22.

Databasmigrationen har inte applicerats i denna miljö eftersom ingen auktoriserad databasanslutning eller `psql` fanns tillgänglig. SQL-verifieringen är därför statisk tills stagingsteget är utfört.

## Releasegrind – måste lösas före staging/produktion

Den redan existerande historiska filen

`supabase/migrations/20260728170000_live_schema_code_canonical_sync.sql`

har följande aktuella hash:

`a743f580168fa2e5de28a9814f151ca0fdc1649517c84490afd093a72340afc4`

Manifestet kräver:

`881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482`

Tidigare leveransarkiv som var tillgängliga kontrollerades, men innehöll samma avvikande fil. Manifestet har inte ändrats för att dölja avvikelsen. Återställ filen från en betrodd Git-/releasekälla vars SHA-256 är exakt manifestvärdet. Kör därefter hela migrationskontrollen.

Release får bli GO först när:

1. den historiska filen har betrodda originalbytes och `npm run db:migrations:check` är grön;
2. kontrollerna körts med Node 22;
3. migrationen har applicerats i auktoriserad staging i rätt ordning;
4. post-apply SQL, API-smoke, intern avtalsregistrering, offert → ansökan → snapshot och fakturaunderlag är gröna;
5. backup-/återställningspunkt och ansvarig releaseattest finns.

## Synka filpaketet till projektet

Kommandona antar:

- nedladdat paket: `~/Downloads/gridex-contract-commercial-selection-2026-07-29.zip`
- lokalt projekt: `/Users/hekmath/Projects/gridex-ops-platform`

```bash
set -euo pipefail

PACKAGE="$HOME/Downloads/gridex-contract-commercial-selection-2026-07-29.zip"
PROJECT="/Users/hekmath/Projects/gridex-ops-platform"
STAGE="$(mktemp -d)"

unzip -q "$PACKAGE" -d "$STAGE"
rsync -av --itemize-changes \
  "$STAGE/gridex-contract-commercial-selection-2026-07-29/" \
  "$PROJECT/"

cd "$PROJECT"
```

Paketet skriver endast de listade ändrade/tillagda filerna. Det tar inte bort andra filer.

## Verifiera efter synk

Använd Node 22:

```bash
cd /Users/hekmath/Projects/gridex-ops-platform
nvm install 22
nvm use 22

npm ci
npm run typecheck
npm run typecheck:tests
npm test
npm run api:docs
npm run gridex:contract-commercial-selection-regression
npm run build
npm run db:migrations:check
```

Det sista kommandot ska fortsätta blockera release tills den historiska filen har återställts korrekt.

## Stagingdatabas – först efter grön migrationshistorik

Inspektera först vilka migrationer som faktiskt saknas i staging. Kör aldrig samma migration två gånger och hoppa inte över en tidigare migration.

```bash
cd /Users/hekmath/Projects/gridex-ops-platform
test -n "${DATABASE_URL:-}"
npm run db:migrations:check
```

När historiken är grön och en auktoriserad stagingbackup finns kan ansvarig operatör applicera just den nya migrationen:

```bash
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260729200000_contract_commercial_selection_completion.sql

psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f scripts/gridex-contract-commercial-selection-post-apply.sql
```

Kör därefter de vanliga tenant-, RLS-, publicerings-, offert-, kundansöknings-, snapshot-, pris- och fakturasmoke-testerna innan någon produktionstransport.

## Ändrade och tillagda produktfiler

### Kommersiell domän, pris och fakturering

- `lib/pricing/commercialModel.ts`
- `lib/pricing/types.ts`
- `lib/pricing/priceSourceResolver.ts`
- `lib/pricing/priceComponentCalculator.ts`
- `lib/pricing/engine.ts`
- `lib/pricing/offerQuote.ts`
- `lib/pricing/websiteQuotes.ts`
- `lib/billing/underlayEngine.ts`
- `lib/contracts/adminContractSchema.ts`
- `lib/website/customerApplications.ts`
- `lib/external-contracts/publicationDto.ts`
- `lib/integrations/websiteIntegrationContract.ts`

### Administrations- och API-flöden

- `components/admin/contracts/CommercialPricingEditor.tsx`
- `components/admin/contracts/ContractOfferAdminForm.tsx`
- `components/admin/customers/contracts/ContractForms.tsx`
- `components/admin/customers/contracts/actions.ts`
- `app/admin/contracts/actions.ts`
- `app/api/v1/website/quote/route.ts`
- `app/developers/customer-portal-api/page.tsx`

### Databas, test och verifiering

- `supabase/migrations/20260729200000_contract_commercial_selection_completion.sql`
- `scripts/migration-history-manifest.json`
- `scripts/gridex-contract-commercial-selection-regression.cjs`
- `scripts/gridex-contract-commercial-selection-post-apply.sql`
- `__tests__/contract-commercial-selection.test.ts`
- `__tests__/contract-admin-schema.test.ts`
- `__tests__/contract-channel-publication-completion.test.ts`
- `__tests__/market-price-api-contract.test.ts`
- `package.json`

### Versionssynkroniserade API-kontrakt och dokument

- `docs/openapi/website-integration-v1.json`
- `docs/openapi/customer-portal-v1.json`
- `docs/external-website-api-integration-guide.md`
- `docs/external-integration-contract-tests.md`
- `docs/gridex-customer-portal-api.md`
- `docs/canonical-market-resolution-quote-billing-flow-2026-07-24.md`
- `docs/ops-api-customer-intake-facility.md`
- `docs/ops-summary-1-api-completion-2026-07-22.md`
- `docs/single-api-key-tenant-integration.md`
- `docs/staging-smoke-test-checklist.md`
- `docs/ai-context/10_CHANGELOG.md`
- `GRIDEX_CONTRACT_CHANNEL_PUBLICATION_COMPLETION_2026-07-28.md`
- `scripts/check-api-documentation-version.cjs`
- `scripts/gridex-canonical-fixed-area-flow-regression.cjs`
- `scripts/gridex-canonical-market-resolution-quote-billing-regression.cjs`
- `scripts/gridex-canonical-portfolio-pricing-regression.cjs`
- `scripts/gridex-contract-api-signature-visibility-regression.cjs`
- `scripts/gridex-contract-go-live-regression.cjs`
- `scripts/gridex-contract-security-energy-direction-regression.cjs`
- `scripts/gridex-invoice-fee-canonical-regression.cjs`
- `scripts/gridex-market-price-api-regression.cjs`

### Projektminne och överlämning

Filerna under `.agent-memory/` har uppdaterats med fas, beslut, blockerare, verifieringsmatris, databasmodell, API-kontrakt, handover och nästa åtgärder. De ingår i paketet så att nästa arbetspass inte tappar den verifierade releasebilden.

## Återställning

Filpaketet saknar raderingsoperationer. Ta ändå en Git-commit eller separat kopia av arbetskatalogen före synk. Vid återställning ska kodversion och databasschema behandlas tillsammans. Försök inte rulla tillbaka en applicerad databasförändring genom att enbart återställa TypeScript-filer; använd stagingbackup och en granskad framåtmigration eller dokumenterad restore-plan.
