# Gridex OPS – API-, tenant- och faktureringshärdning

Datum: 2026-08-05  
API-release: `2026-08-04.3`  
Databasmigration: `20260805085617_api_contract_billing_tenant_hardening.sql`

## Rotorsak

`GET /api/v1/integration/context` returnerade det interna readiness-objektet direkt. Det interna objektet innehåller diagnostikfält som `blockers`, `warnings`, `checks`, `portal_url` och leveransstatus som inte ingår i den externa, immutabla `IntegrationContext`-modellen. Gridex Web upptäckte därför ett kompatibelt men felaktigt additivt svar och loggade `canonical_response_schema_invalid`.

## API-fix

- Infört `PublicExternalTenantContext` som uttrycklig extern DTO.
- Infört `projectPublicExternalTenantContext()` som tillåter endast dokumenterade fält.
- `/api/v1/integration/context` använder nu projektionen innan svaret skickas.
- Intern readiness-information finns kvar internt och läcker inte till webbklienten.
- API-version `2026-08-04.3` behålls; den immutabla releasefilen ändras inte.
- Aktiva regressionsskript hämtar nu aktuell API-version från de kanoniska OpenAPI-filerna i stället för att vara hårdkodade till en gammal release.

## Liknande fel som rättats

### Partnerfakturor

- `customer_invoice_lines.company_id` saknades vid skapande av rader.
- Radering av gamla rader var endast filtrerad på `invoice_id`.
- Radmoms och total inklusive moms materialiserades inte konsekvent.
- Partnerstatus `failed` normaliserades felaktigt till `issued`.

Fixen skriver nu tenant-ID på varje rad, filtrerar mutationer med både tenant och faktura, beräknar moms deterministiskt till två decimaler och bevarar `failed`.

### Fakturareferenser

Den gamla globala unikheten på `partner_invoice_reference` kunde orsaka kollision mellan två tenants. Databasen använder nu unikhet på `(company_id, partner_invoice_reference)`, vilket överensstämmer med runtime-upsert.

### Tenantkedjan

Validerade sammansatta främmande nycklar binder nu tenant genom:

`API-klient → idempotens → quote → kundansökan → avtal → prissnapshot → fakturaunderlag → fakturarad/charge ledger`.

Finansiella huvudtabeller kräver `company_id NOT NULL`, och bolag kan inte raderas så att ekonomiska poster lämnas utan tenant.

### Faktureringsidentitet

Ett avtal får inte bli faktureringsklart utan:

- kontraktsproduktversion,
- publiceringsversion,
- prissnapshot,
- verifierat elområde `SE1–SE4`,
- snapshot-hash.

Fakturarader har dessutom validerade moms- och beloppsinvarianter.

## Migrationshistorik

Fem migrationer hade redan applicerade objekt i databasen men saknades i `supabase_migrations.schema_migrations`:

- `20260804003000`
- `20260804093500`
- `20260804121000`
- `20260804151500`
- `20260804173000`

De registrerades först efter objekt-för-objekt-verifiering av kolumner, constraints, funktioner, triggers och index. SQL-filen `scripts/repair-verified-migration-history-20260805.sql` bevarar samma preflight och är idempotent.

## Säkerhet

- `anon`/`PUBLIC` kan inte längre köra `gridex_required_legal_modules` som `SECURITY DEFINER`.
- `authenticated` behåller åtkomst till avsedda tenant-/RLS-hjälpfunktioner. Dessa ska inte återkallas blint eftersom RLS-policies använder dem.
- Advisor-träffar av typen “RLS enabled, no policy” för service-tabeller är fail-closed: `anon` och `authenticated` saknar tabellrättigheter; endast `service_role` har åtkomst.
- Supabase-inställningen för leaked-password protection behöver fortfarande aktiveras manuellt i Auth-inställningarna.

## Verifierat mot kopplad databas

Efter migrationen var följande antal avvikelser `0`:

- quote/API-klient tenant-mismatch,
- idempotens/API-klient tenant-mismatch,
- prissnapshot/avtal tenant-mismatch,
- underlagsrad/underlag tenant-mismatch,
- fakturarad/faktura tenant-mismatch,
- inkonsekventa momsbelopp,
- faktureringsklara avtal utan kanonisk identitet,
- saknade förväntade migrationer.

Alla 15 nya constraints finns och är validerade. `company_id` är `NOT NULL` på avtal, fakturaunderlag, fakturor och fakturarader.

## Regressionsgrind

Kör:

```bash
npm run gridex:api-billing-tenant-hardening-regression
npm run db:migrations:check
npm run db:contract-hardening
```

Liveverifiering:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f scripts/verify-api-billing-tenant-hardening-20260805.sql
```

## Lokal fullverifiering

```bash
npm ci
npm run typecheck
npm run build
```

Den här körmiljön kunde inte slutföra `npm ci`, eftersom den tillgängliga npm-spegeln saknade ett låst tarball-paket. De paketoberoende API-, migration-, fakturerings- och säkerhetsregressionerna har däremot körts och godkänts.
