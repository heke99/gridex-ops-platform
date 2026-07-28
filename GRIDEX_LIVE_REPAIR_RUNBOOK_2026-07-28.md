# Gridex live-reparation – Docker-fri körbok

Datum: 2026-07-28  
Migration: `20260728170000_live_schema_code_canonical_sync.sql`

Den här körboken använder `psql`, `pg_dump` och den länkade Supabase CLI:n. Docker används inte.

Aktivera pipeline-felhantering i terminalsessionen:

```bash
set -o pipefail
```

## Regler före start

- Frys manuella schemaändringar i Supabase SQL Editor.
- Kontrollera att du arbetar mot rätt produktionsprojekt.
- Kör inte `supabase db push`.
- Kör inte gamla migrationer igen.
- Kör inte `supabase migration repair` innan migrationen har commit:at och post-apply är grön.
- Lägg aldrig databaslösenord eller anslutningssträng i chatt, logg eller repo.
- Säkerställ att Supabase PITR/backuper är aktiva innan produktionsändringen.

## 1. Gå till det reparerade projektet

```bash
cd "/sökväg/till/gridex-ops-platform-main"
```

Kontrollera Node-version. Använd Node 22:

```bash
node --version
npm --version
```

Installera exakt låsta beroenden och kör lokal verifiering:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run api:docs
npm run gridex:live-schema-code-sync-regression
npm run verify:contract-go-live:static
npm run build
```

## 2. Sätt en skyddad anslutningsvariabel

Hämta Session Pooler-strängen från:

`Supabase → projektet → Connect → Session pooler`

Läs in den utan att skriva den i historiken:

```bash
read -s "GRIDEX_DB_URL?Database URL: "
export GRIDEX_DB_URL
echo
```

Skapa en lokal loggmapp:

```bash
export GRIDEX_APPLY_LOG_DIR="$HOME/Downloads/gridex-live-apply-2026-07-28"
mkdir -p "$GRIDEX_APPLY_LOG_DIR"
```

Verifiera identiteten:

```bash
psql "$GRIDEX_DB_URL" -X -v ON_ERROR_STOP=1 -c "
select
  current_database() as database_name,
  current_user as database_user,
  current_setting('server_version') as postgres_version,
  now() as checked_at;
"
```

Avbryt om projekt, användare eller miljö är fel.

## 3. Ta en schemaexport före ändringen

Detta exporterar inga kundrader:

```bash
pg_dump "$GRIDEX_DB_URL" \
  --schema-only \
  --no-owner \
  --no-privileges \
  --schema=public \
  --schema=extensions \
  --file="$GRIDEX_APPLY_LOG_DIR/00-before-schema.sql"
```

Kontrollera att filen inte är tom:

```bash
test -s "$GRIDEX_APPLY_LOG_DIR/00-before-schema.sql"
shasum -a 256 "$GRIDEX_APPLY_LOG_DIR/00-before-schema.sql" \
  > "$GRIDEX_APPLY_LOG_DIR/00-before-schema.sha256"
```

## 4. Kör preflight

```bash
psql "$GRIDEX_DB_URL" \
  -X \
  -v ON_ERROR_STOP=1 \
  -f scripts/gridex-live-repair-preflight.sql \
  2>&1 | tee "$GRIDEX_APPLY_LOG_DIR/01-preflight.log"
```

Fortsätt endast om kommandot har exitkod 0:

```bash
test "$?" -eq 0
```

Om preflight stoppar:

- kör inte migrationen;
- spara loggen;
- lös den exakta blockeraren;
- kör preflight igen.

## 5. Kontrollera migrationsfilens checksum

Förväntad SHA-256:

```text
881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482
```

Verifiera:

```bash
test "$(
  shasum -a 256 \
    supabase/migrations/20260728170000_live_schema_code_canonical_sync.sql \
    | awk '{print $1}'
)" = "881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482"
```

Avbryt vid minsta avvikelse.

## 6. Applicera migrationen

Migrationen innehåller `BEGIN`, advisory lock, fail-closed-kontroller och `COMMIT`. `ON_ERROR_STOP` gör att `psql` avbryter vid första fel.

```bash
psql "$GRIDEX_DB_URL" \
  -X \
  -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260728170000_live_schema_code_canonical_sync.sql \
  2>&1 | tee "$GRIDEX_APPLY_LOG_DIR/02-apply.log"
```

Kontrollera exitkoden:

```bash
test "$?" -eq 0
```

Om migrationen misslyckas före `COMMIT` rullas transaktionen tillbaka. Försök inte manuellt fortsätta från mitten.

## 7. Kör post-apply

```bash
psql "$GRIDEX_DB_URL" \
  -X \
  -v ON_ERROR_STOP=1 \
  -f scripts/gridex-live-repair-post-apply.sql \
  2>&1 | tee "$GRIDEX_APPLY_LOG_DIR/03-post-apply.log"
```

Kontrollera exitkoden:

```bash
test "$?" -eq 0
```

Post-apply använder en transaktion som avslutas med `ROLLBACK`; den lämnar inte kvar kontrollrader.

## 8. Kör Supabase live-lint

Projektet ska redan vara länkat till rätt projekt:

```bash
npx supabase migration list --linked \
  | tee "$GRIDEX_APPLY_LOG_DIR/04-migration-list-before-repair.txt"
```

Kör lint:

```bash
npx supabase db lint \
  --linked \
  --schema public \
  --level error \
  2>&1 | tee "$GRIDEX_APPLY_LOG_DIR/05-live-db-lint.txt"
```

Krav: inga error.

## 9. Exportera schema efter ändringen

```bash
pg_dump "$GRIDEX_DB_URL" \
  --schema-only \
  --no-owner \
  --no-privileges \
  --schema=public \
  --schema=extensions \
  --file="$GRIDEX_APPLY_LOG_DIR/06-after-schema.sql"
```

```bash
test -s "$GRIDEX_APPLY_LOG_DIR/06-after-schema.sql"
shasum -a 256 "$GRIDEX_APPLY_LOG_DIR/06-after-schema.sql" \
  > "$GRIDEX_APPLY_LOG_DIR/06-after-schema.sha256"
```

## 10. Markera endast den nya migrationen som applicerad

Gör detta först efter grön post-apply och live-lint:

```bash
npx supabase migration repair \
  20260728170000 \
  --status applied \
  --linked
```

Verifiera:

```bash
npx supabase migration list --linked \
  | tee "$GRIDEX_APPLY_LOG_DIR/07-migration-list-after-repair.txt"
```

Detta registrerar den nya reparationspunkten. Det gör inte den äldre, avvikande migrationshistoriken canonical.

## 11. Smoke-tester

Kör minst en kontrollerad test för varje kritisk väg:

1. Intern avtalsversion → canonical erbjudande.
2. Publik avtalsversion → publiceringskanal → publik feed.
3. Quote → onboarding → kund/site/avtal.
4. Misslyckad signatur → `signature_failed` → retry.
5. Pausa kanal och avsluta kanal som två olika operationer.
6. Fakturautkast med rader, moms och providerexport.
7. Provider/webhook-händelse med idempotent återspelning.
8. Juridisk bundle-materialisering.
9. EDIEL/certifikat- och mätpunktsläsning.
10. Tenantisolering med minst två tenants.

Spara testresultat utan kunddata i:

```text
$GRIDEX_APPLY_LOG_DIR/08-smoke-tests.md
```

## 12. Slutligt GO-kriterium

Markera produktionsdatabasen som synkroniserad endast om:

- preflight passerade;
- migrationen commit:ade;
- post-apply passerade;
- live-lint har noll error;
- post-apply-schemaexporten finns;
- migration `20260728170000` syns remote;
- Node 22-builden passerar;
- samtliga kritiska smoke-tester passerar.

Om någon punkt är röd är status fortsatt **NO-GO**.

## 13. Ny canonical baseline

Den gamla migrationshistoriken ska inte repareras genom att markera alla repofiler som applicerade. Efter godkänd produktion:

1. använd `06-after-schema.sql` som verifierat underlag;
2. skapa en ny baseline på en separat branch;
3. applicera baselinen i en tom stagingdatabas;
4. kör full test- och post-applysvit;
5. jämför stagingexport mot produktionsschemat;
6. dokumentera exakt cutover;
7. förbjud fortsatta manuella schemaändringar i SQL Editor.

## 14. Rensa anslutningshemligheten

```bash
unset GRIDEX_DB_URL
```

Packa loggarna först efter att du har verifierat att de inte innehåller anslutningssträng, lösenord eller kunddata.
