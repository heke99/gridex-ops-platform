# Canonical fastpris- och kundflöde – implementation 2026-07-23

## Mål

Implementationen följer principen **en tenantbunden kund, en ansökan, en faktisk avtalsrelation per anläggning och en publicerad fastprisprodukt med flera SE-prisrader**.

API-förändringarna är begränsade till befintliga routes och typer. Ingen parallell kund-, offert-, avtals- eller faktureringsmodell har skapats.

## Vad som har ändrats

### Ett fastprisavtal med SE1–SE4

- `contract_product_version` fortsätter vara den immutable canonicala avtalsversionen.
- `commercial_snapshot.base_components` kan nu innehålla en fastprisrad per `price_area`.
- Admin kan ange `SE1 | belopp` till `SE4 | belopp` på samma avtal.
- Valideringen kräver pris för varje aktiverat område men förbjuder inte längre olika priser.
- Det äldre scalarfältet `fixed_price_ore_per_kwh` fylls bara när alla områden har samma pris.
- Public contracts returnerar ett offer med `area_pricing`; fyra områden blir inte fyra produktkort.

### Canonical resolver och quote

Befintliga routes har återaktiverats med tenantautentisering och etablerade scopes:

- `POST /api/v1/website/energy-area/resolve`
- `POST /api/v1/website/quote`
- `POST /api/v1/website/quote/validate`

Den oautentiserade legacyrutten `GET /api/public/energy-area` är fortsatt avstängd.

Quoten binds till exakt:

- tenant/API-klient;
- `offer_reference`;
- publicerad produkt-, publicerings-, pris- och juridikversion;
- kundtyp;
- SE-område;
- förbrukning;
- startdatum;
- vald fastprisrad.

### Kundteckning och kundnummer

Den befintliga canonicala onboardingkedjan återanvänds:

- stabil extern kundreferens kan skickas som `external_customer_id` eller `external_customer_reference`;
- samma idempotenta ansökan matchar eller skapar en kund;
- OPS tilldelar/återanvänder kundnummer atomiskt;
- samma RPC skapar/kopplar site, mätpunkt, kundavtal och prisögonblicksbild;
- quote konsumeras av högst en canonical ansökan;
- ett retry med samma idempotency key skapar inte ett parallellt avtal.

### Mail, uppgiftsbegäran och leverantörsbyte

Befintliga produktionsflöden behålls och verifieras i den nya regressionskedjan:

- mottagnings- och avtalsmail går via durable/idempotent mailflöde;
- anläggningsuppgiftsbegäran köas automatiskt när underlag saknas;
- leverantörsbyte startar när readiness-villkoren är uppfyllda;
- samma kund-, site-, application- och contract-ID följer hela processen.

### Fakturering

- Kundavtalet sparar `price_area_used` och exakt `fixed_price_ore_per_kwh`.
- `contract_price_snapshots.base_price_components_snapshot` innehåller kundens valda områdesrad och tillämpliga globala komponenter.
- Pris- och faktureringsmotorn behåller globala komponenter men utesluter andra SE-rader.
- Publicerade framtida prisändringar ändrar inte kundens låsta prisögonblicksbild.

## Databasmigration

`supabase/migrations/20260723120000_canonical_fixed_area_quote_flow.sql` är additiv och:

- återaktiverar endast redan etablerade quote-/resolver-scopes för relevanta website-klienter;
- lägger till ett tenant+quote-index;
- skapar auditvyn `contract_fixed_area_prices_v` för att kontrollera prisrader per produktversion.

Migrationen gör **ingen heuristisk eller destruktiv sammanslagning av historiska fyra separata erbjudanden**. Sådan data får inte grupperas efter namn eller pris utan ett uttryckligt, verifierat ID-underlag. Nya och redigerade avtal använder den canonicala modellen direkt. Auditvyn används för att inventera live-data innan en separat, tenantgranskad backfill genomförs.

## API-version

Aktuell dokumenterad kontraktsversion är `2026-07-23.1`.

## Verifiering

Godkända kontroller i leveransmiljön:

- canonical fixed-area static regression: 31 kontroller;
- contract single-source regression: 90 kontroller;
- canonical portfolio regression: 127 kontroller;
- contract go-live regression: 169 kontroller;
- API/signature/visibility regression;
- invoice-fee canonical regression;
- public-pricing visibility regression;
- canonical onboarding regression;
- customer-number chain regression;
- multi-site customer regression;
- multi-site billing regression;
- automation/idempotency regression;
- API route contract check: 30 routes;
- migrationshistorik: 294 migrations och checksumkontroll;
- TypeScript-syntaxtranspilering av ändrade TS/TSX-filer;
- runtime-smoke för SE-prisparsning, val och validering.

Två äldre regressioner är fortsatt röda med exakt samma fel i originalprojektet och i patchen:

- `gridex-website-application-canonical-dispatch-regression.cjs`: två befintliga mätpunktskontroller;
- `gridex-platform-tenant-contracts-api-mail-regression.cjs`: tre befintliga publicerings-/auditkontroller.

Full `npm ci`, Vitest, full typecheck och Next build kunde inte slutföras i leveransmiljön eftersom paketregistret svarade med HTTP 503 och lämnade en ofullständig `node_modules`. `node_modules` ingår därför inte i leveransen. Kör verifieringskommandot lokalt innan deploy.

## Lokal synk och verifiering

Efter att patchfilen har synkats till projektet:

```bash
cd /Users/hekmath/Desktop/Projects/gridex-ops-platform
npm run sync:canonical-fixed-area-flow
```

När alla kontroller är gröna och Supabase CLI är länkat till rätt projekt:

```bash
cd /Users/hekmath/Desktop/Projects/gridex-ops-platform
APPLY_SUPABASE_MIGRATIONS=1 npm run sync:canonical-fixed-area-flow
```

Det sista kommandot kör tester och build före `supabase db push`.
