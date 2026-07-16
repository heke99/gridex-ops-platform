# Verifiering – contract/billing end-to-end completion

Datum: 2026-07-16

## Slutresultat

- Produktionsbuild: **grön**, exitkod 0.
- TypeScript i produktionsbuild: **grön**.
- Vitest: **19 testfiler, 147 tester, samtliga gröna**.
- ESLint: **26 ändrade TypeScript/TSX-filer, inga fel**.
- `git diff --check`: **grön**.
- SQL-parser (`pglast`): **91 SQL-satser, inga syntaxfel**.
- Migrationshistorik: **265 filer, 170 versionsgrupper, alla checksummor verifierade**.

## Regressioner

- Canonical contract/legal/publication regression: grön.
- Contract legal publication completion: 32 kontroller, gröna.
- OPS final contract regression: grön.
- Public API contract: 23 route-filer, grön.
- Pricing-flow regression: grön.
- Billing-readiness regression: grön.
- Multi-site billing-underlay regression: grön.
- Invoice-partner customer-number regression: grön.

## Körda kommandon

```bash
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS='--max-old-space-size=3072' npm run build
npm test -- --run
npx eslint <alla ändrade .ts/.tsx-filer>
git diff --check
npm run gridex:canonical-contract-model-regression
npm run gridex:contract-legal-publication-completion-regression
npm run ops:final-contract-regression
npm run api:contract
npm run gridex:pricing-flow-regression
npm run gridex:billing-readiness-regression
npm run gridex:multi-site-billing-underlay-regression
npm run gridex:invoice-partner-customer-number-regression
npm run db:migrations:check
```

## Databasverifiering

Migrationen har parsats lokalt och migrationsmanifestet är konsistent. Live-Supabase var inte tillgänglig i körmiljön. Efter deployment ska följande kontroll köras per tenant:

```sql
select *
from public.gridex_contract_platform_integrity_report('<company_id>'::uuid);
```

Städning av historiska orphan-rader ska först provas i staging:

```sql
select public.gridex_cleanup_orphan_contract_pricing(interval '24 hours');
```

Ingen produktionsdata har ändrats av denna lokala verifiering.
