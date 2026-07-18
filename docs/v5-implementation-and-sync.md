# Gridex V5 – implementation och synk

## Source of truth

- Ett tecknat webbavtal binds till exakt publiceringsversion, produktversion,
  prisplansversion, pris-snapshot, juridikpaket och varje enskilt dokument-ID.
- Juridiska accepter skapas och avtalet signeras i samma databastransaktion.
  Databasen räknar själv signatur-snapshotens SHA-256. Den äldre
  `legal_text_version_id` är endast historisk läsdata.
- Leverantörsbyte kräver signerad PDF med matchande hash, alla exakta accepter,
  giltig fullmakt, anläggning, mätpunkt, nätägare, elområde, startdatum och inga
  ånger-/export-/livscykelblockerare. App, service, databas-trigger och PRODAT
  använder samma fail-closed-kedja.
- Portföljavtal sparar metod och andelar, aldrig ett framtida faktiskt
  utfallspris. Utfall lagras i en canonical avräkningsledger med revisioner.
- Estimat sparas separat med `estimate_source`, `estimate_month`,
  `estimate_price_ore_per_kwh`, `estimate_generated_at` och
  `non_binding=true`. De används aldrig i definitiv fakturering.
- Faktureringsbindningen accepterar exakt aktuell `final` eller `locked`
  avräkning. En `final` rad låses atomiskt i samma bindning; fakturan får sedan
  endast bära den exakta `locked` revisionen och dess SHA-256-snapshot.
- Portfölj-RBAC är default-deny. Endast uttryckliga grants gäller; endast
  `platform_superadmin` kan skapa/återkalla grants. De kan delegera exakt
  `portfolio_settlement.read|create|import|calculate|review|approve|lock|correct`
  per tenant, portfölj och utgångstid, direkt eller genom de sex separata
  rollmallarna. `portfolio_settlement.manage_access` kan aldrig delegeras.
- Den canonicala avräkningsnyckeln är `company_id + portfolio_id +
  price_plan_version_id + delivery_month + price_area_code + revision_no`.
  Kostnads-, volym-, status-, rättelse- och beräkningshashhistorik är
  append-only.

## Säker driftsättningsordning

1. Ta databasbackup och verifiera återläsningsrutinen.
2. Kör migrationsintegritetskontroll och hela verifieringssviten lokalt/CI.
3. Kör `supabase migration list` mot rätt projekt och kontrollera att endast de
   tre nya V5-migrationerna väntar.
4. Applicera databasmigrationerna före applikationsdeploy.
5. Deploya applikationen.
6. Kör den read-only live-preflight som finns i
   `scripts/sql/v5-live-readiness-preflight.sql`.
7. Hantera eventuella historiska avvikelser som separata, auditerade
   korrigeringar. Massuppdatera, radera eller retrya aldrig köer från
   preflightresultatet.

Preflighten inventerar även verkliga öppna transaktioner (`xact_start is not
null`), repository/live-migrationer, scheduler-/Vault-metadata, API-klienters
scope/origin/utgångstid, köposter, testdatamarkeringar, avtalssnapshots,
juridikaccepter och fullmakter. Den ändrar eller retryar ingenting.

## Verifieringskommandon

```bash
npm ci
npm run db:migrations:check
npm run typecheck
npm run typecheck:scripts
npm run typecheck:tests
npm run lint
npm run gridex:canonical-portfolio-pricing-regression
npm test
npm run build
```

Livekontroll efter deploy, med en read-only databasroll:

```bash
psql "$READ_ONLY_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f scripts/sql/v5-live-readiness-preflight.sql
```

Migration och deploy ska följa projektets normala CI/CD-flöde. Kör inte
`supabase db reset`, force-push eller manuella DELETE/UPDATE mot produktion.
