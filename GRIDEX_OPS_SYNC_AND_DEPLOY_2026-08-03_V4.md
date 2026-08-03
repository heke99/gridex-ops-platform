# Gridex OPS – synk, verifiering och deploy v4

## Viktigt nuläge

- Supabase-projektet `piidsfebjqjmnepdpnas` är redan migrerat och verifierat.
- Migration `20260803212754_canonical_migration_readiness_reconciliation_v4` finns redan i live-ledgern.
- Kör inte migrationens DDL manuellt igen.
- Synka repot, verifiera att local/remote migration history matchar och deploya sedan OPS-applikationen.

## 1. Synka patchen till OPS-projektet

Anpassa endast sökvägarna om ditt projekt ligger någon annanstans.

```bash
set -euo pipefail

PATCH_ZIP="/Users/hekmath/Downloads/gridex-ops-runtime-readiness-v4-patch.zip"
PROJECT_DIR="/Users/hekmath/Projects/gridex-ops-platform"
PATCH_DIR="$(mktemp -d)"

unzip -q "$PATCH_ZIP" -d "$PATCH_DIR"

rm -f \
  "$PROJECT_DIR/supabase/migrations/20260803152200_contract_portfolio_tenant_fk_indexes.sql" \
  "$PROJECT_DIR/supabase/migrations/20260803153500_portfolio_superadmin_helper_service_role_only.sql"

rsync -av --checksum \
  "$PATCH_DIR/project/" \
  "$PROJECT_DIR/"

rm -rf "$PATCH_DIR"

cd "$PROJECT_DIR"
git status --short
git diff --stat
```

## 2. Installera och kör full verifiering

```bash
cd "/Users/hekmath/Projects/gridex-ops-platform"

npm ci

npm run db:migrations:check
npm run db:runtime-readiness:check

npm run api:docs
npm run api:compatibility
npm run api:runtime:parity

npm run gridex:single-api-key-integration-regression
npm run gridex:website-application-idempotency-hardening-regression
npm run gridex:customer-portal-multi-site-api-regression

npm run typecheck
npm run typecheck:scripts
npm run typecheck:tests
npm run test
npm run build
```

GitHub-workflowet kör dessutom:

```bash
npm run ops:hardening-regression
npm run ops:hardening-behavior-regression
npm run ops:final-contract-regression
npm run api:error-boundaries
npm run security:audit-production
```

## 3. Verifiera Supabase-ledgern

```bash
cd "/Users/hekmath/Projects/gridex-ops-platform"

npx supabase --version
npx supabase link --project-ref piidsfebjqjmnepdpnas
npx supabase migration list --linked
```

Förväntat:

```text
20260803152014  local + remote
20260803152236  local + remote
20260803212754  local + remote
```

Det ska inte finnas en pending lokal v4-migration. Om `20260803212754` visas som remote applied är databasen redan korrekt och `db push` behövs inte för denna leverans.

Kör inte `migration repair` och kör inte de gamla felaktiga versionerna `20260803152200` eller `20260803153500`.

## 4. Kör idempotent post-apply-verifiering

Sätt en direkt Postgres-anslutning som endast finns i ditt terminalskal:

```bash
export GRIDEX_OPS_DATABASE_URL='postgresql://...'

psql "$GRIDEX_OPS_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f scripts/post-apply-runtime-readiness-v4.sql
```

Krav:

```text
runtime is_ready = true
runtime blocking_issues = {}
governance missing_in_ledger = 0
governance unmapped_ledger_versions = 0
governance duplicate_ledger_mappings = 0
canonical missing_in_ledger = 0
platform_schema_state is_ready = true
platform_schema_state blocking_issues = []
```

## 5. Commit och deploya OPS

```bash
cd "/Users/hekmath/Projects/gridex-ops-platform"

git checkout -b fix/runtime-readiness-capability-v4
git add .
git commit -m "fix: gate OPS API by verified runtime capabilities"
git push -u origin fix/runtime-readiness-capability-v4
```

Mergea därefter branchen till `main` efter grönt GitHub-workflow. Om Vercel-projektet är kopplat till `main` startas produktionsdeployen av merge/push.

Om ni deployar manuellt med Vercel CLI:

```bash
npx vercel --prod
```

Databasen ska vara grön före appdeploy, vilket redan är verifierat för det anslutna projektet.

## 6. Vänta ut readiness-cache och smoke-testa OPS

Vänta minst 30 sekunder efter att den nya deploymenten tagit trafik.

```bash
export GRIDEX_API_KEY='din_server_side_api_nyckel'

curl -sS -D /tmp/gridex-context.headers \
  -H "Authorization: Bearer $GRIDEX_API_KEY" \
  -H 'Accept: application/json' \
  'https://app.gridex.se/api/v1/integration/context' \
  -o /tmp/gridex-context.json

cat /tmp/gridex-context.headers
cat /tmp/gridex-context.json

curl -sS -D /tmp/gridex-contracts.headers \
  -H "Authorization: Bearer $GRIDEX_API_KEY" \
  -H 'Accept: application/json' \
  'https://app.gridex.se/api/v1/website/public-contracts' \
  -o /tmp/gridex-contracts.json

cat /tmp/gridex-contracts.headers
cat /tmp/gridex-contracts.json
```

Krav:

```text
HTTP 200
X-Gridex-Contract-Version: 2026-08-03.1
X-Request-ID finns
ingen platform_schema_not_ready
integration context innehåller rätt tenant_reference
public contracts innehåller tenantbundna publicerade avtal
```

Kontrollera även publik OpenAPI-release:

```bash
curl -fsS \
  'https://app.gridex.se/api/v1/openapi/release-manifest.json' \
  | python3 -m json.tool
```

Samtliga versioner i manifestet ska vara `2026-08-03.1`.

## 7. Synka Gridex Web mot OPS OpenAPI

Gridex Webs synkskript hämtar den publika release-manifesten och verifierar SHA-256 för båda specifikationerna. Ingen API-nyckel behövs för OpenAPI-synken.

```bash
cd "/Users/hekmath/Desktop/Projects/gridex-web"

npm ci
npm run api:sync
npm run api:check:local
npm run api:check:live
npm run api:contract
npm run api:compatibility
npm run typecheck
npm run test:launch
npm run build
```

Efter `api:sync` ska följande vara synkroniserat till `2026-08-03.1`:

```text
docs/openapi/website-integration-v1.json
docs/openapi/customer-portal-v1.json
docs/openapi/release-manifest.json
lib/ops/generated/website-api.d.ts
lib/ops/generated/customer-portal-api.d.ts
lib/ops/contract.ts
```

Commit och deploya Gridex Web först efter att OPS-smoketestet ger `200`.

```bash
git add .
git commit -m "chore: sync Gridex API contract 2026-08-03.1"
git push
```

## 8. Verifiera att snapshot-fallbacken fylls

Efter ett lyckat public-contract-anrop ska snapshotlagret börja innehålla data. Kontrollera rätt OPS-databas:

```sql
select
  count(*) as snapshot_count,
  max(updated_at) as latest_snapshot_at
from public.website_public_contract_snapshots;
```

Krav:

```text
snapshot_count > 0
```

Därefter kan Gridex Web använda last-known-good vid ett senare tillfälligt OPS-avbrott.

## 9. Slutligt E2E-test

Kör en unik testkund genom hela flödet:

```text
publicerat avtal
→ immutable offer_reference
→ canonical quote
→ Idempotency-Key
→ OPS accepted
→ signerat avtal och signaturbevis
→ durable continuation
→ verifierad tack-sida
→ kundmail/outbox
→ portalidentitet och owner-koppling
→ portal-bundle
→ signerad webhook
```

En lyckad build är inte samma sak som ett lyckat distribuerat E2E-flöde. Produktionen ska inte markeras slutverifierad förrän detta test har genomförts.
