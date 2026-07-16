# Verifiering – contract, production och billing completion

Datum: 2026-07-16

## Slutresultat

- Next.js-produktionsbuild: **grön**, exitkod 0.
- Webpack: **kompilerad**, 62 sekunder.
- TypeScript i produktionsbuilden: **grön**.
- Statisk route-generering: **7/7**, grön.
- Vitest: **21 testfiler och 154 tester**, samtliga gröna.
- ESLint: samtliga ändrade TypeScript/TSX-test- och runtimefiler, **inga fel**.
- PostgreSQL-parser (`pglast`):
  - `20260716010000_contract_billing_end_to_end_completion.sql`: **92 satser**.
  - `20260716090000_production_settlement_export_completion.sql`: **58 satser**.
- Migrationshistorik: **266 filer, 171 versionsgrupper, alla checksummor verifierade**.
- Produktionsberoenden: `npm audit --omit=dev --audit-level=high`: **0 sårbarheter**.
- Formatkontroll: inga avslutande blanksteg och samtliga ändrade textfiler har newline vid EOF.

## Regressioner

- Canonical contract/legal/publication regression: grön.
- Contract legal publication completion: 32 kontroller, gröna.
- Pricing-flow regression: grön.
- Billing-readiness regression: grön.
- Multi-site billing-underlay regression: grön.
- Invoice-partner customer-number regression: grön.
- Production settlement/export completion regression: grön.

## Fastställda affärsregler

- Månadspris, timpris och kvartspris är separata avtal per månad.
- Avtalsbyte eller upplösningsbyte sker från nästa månadsgräns.
- Portföljpris är månadspris.
- Mix = månadens spotmedel × spotandel + månadens portföljpris × portföljandel.
- Fastpris är ett gemensamt pris per kWh för samtliga valda prisområden.

## Databasdeployment

Kör migrationerna i denna ordning:

```text
supabase/migrations/20260716010000_contract_billing_end_to_end_completion.sql
supabase/migrations/20260716090000_production_settlement_export_completion.sql
```

Efter deployment:

```sql
select
  c.id as company_id,
  public.gridex_contract_platform_integrity_report(c.id) as integrity_report
from public.companies c
order by c.id;
```

Alla räknare ska vara `0`, alla värden i `runtime_functions_present` ska vara
`true` och `runtime_search_path_valid` ska vara `true`.

Den tidigare identifierade orphan-prisboken ska vara borta:

```sql
select id
from public.price_books
where id = 'a24aa71d-42c0-4241-9145-fd66aec054ab'::uuid;
```

Förväntat resultat: noll rader.

## Körda huvudkommandon

```bash
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS='--max-old-space-size=3072' npm run build
npm test -- --run
npx eslint <samtliga ändrade TypeScript/TSX-filer>
npm run db:migrations:check
npm run gridex:canonical-contract-model-regression
npm run gridex:contract-legal-publication-completion-regression
npm run gridex:pricing-flow-regression
npm run gridex:billing-readiness-regression
npm run gridex:multi-site-billing-underlay-regression
npm run gridex:invoice-partner-customer-number-regression
npm run gridex:production-settlement-export-regression
npm audit --omit=dev --audit-level=high
```

Live-Supabase har inte ändrats från denna körmiljö. Produktionsstatus är därför
slutligt grön först när den nya migrationen är applicerad och integritetsrapporten
ovan har passerat i den driftsatta databasen.
