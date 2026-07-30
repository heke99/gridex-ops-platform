# Synkronisering och verifiering

## 1. Lägg in patchfilerna i Gridex Ops

Kör från katalogen där ZIP-filen packats upp:

```bash
export OPS_REPO="/absolut/sökväg/till/gridex-ops-platform"

rsync -av --checksum --itemize-changes \
  ./gridex-ops-platform-canonical-production-repair-2026-07-30/files/ \
  "$OPS_REPO/"

cd "$OPS_REPO"
npm ci
```

Kontrollera diffen innan databas eller deploy:

```bash
git status --short
git diff --check
git diff -- \
  supabase/migrations/20260728170000_live_schema_code_canonical_sync.sql \
  scripts/migration-history-manifest.json

sha256sum \
  supabase/migrations/20260728170000_live_schema_code_canonical_sync.sql \
  supabase/migrations/20260730130000_historical_sync_forward_repair.sql
```

Förväntade migrationshashar:

```text
881e1bc552b6a6295b6bc993cec82e55a25c56f0d5cdf525a784e33d2222d482
3e204b00fa33badbfdc7a11c0304df3bc5385b16e0854e40af2df1c06b32b50b
```

## 2. Kör lokala grindar med projektets deklarerade Node 22

```bash
cd "$OPS_REPO"

npm run db:migrations:check
npm run typecheck
npm run typecheck:scripts
npm run typecheck:tests
npm run typecheck:ediel-consolidation
npm run typecheck:contract-go-live
npm test
npm run lint
npm run api:docs
npm run api:error-boundaries
npm run api:performance-tenant-gates
npm run build
```

## 3. Databassynk i staging

Kör inte `db push` förrän de tre dubbla migrationsversionerna har jämförts med
den auktoritativa applied-ledgern och `db:migrations:check` är grön.

```bash
cd "$OPS_REPO"

npx supabase link --project-ref "$STAGING_SUPABASE_PROJECT_REF"
npx supabase migration list --linked
npm run db:migrations:check
npx supabase db push --dry-run
```

Efter godkänd ledger-review och godkänd dry-run:

```bash
npx supabase db push
npx supabase migration list --linked
```

Kör samma verifiering mot både en tom testdatabas och en kopia av den faktiska
uppgraderingskedjan. Avbryt vid första SQL-fel; skriv inte om en historisk
migration eller dess checksumma.

## 4. Kontrollera driftsatta OpenAPI-bytes

Efter OPS-deploy:

```bash
export OPS_ORIGIN="https://app.gridex.se"
mkdir -p /tmp/gridex-openapi-live

curl -fsS \
  "$OPS_ORIGIN/api/v1/openapi/release-manifest.json" \
  -o /tmp/gridex-openapi-live/release-manifest.json
curl -fsS \
  "$OPS_ORIGIN/api/v1/openapi/website-integration-v1.json" \
  -o /tmp/gridex-openapi-live/website-integration-v1.json
curl -fsS \
  "$OPS_ORIGIN/api/v1/openapi/customer-portal-v1.json" \
  -o /tmp/gridex-openapi-live/customer-portal-v1.json

sha256sum \
  /tmp/gridex-openapi-live/website-integration-v1.json \
  /tmp/gridex-openapi-live/customer-portal-v1.json

node -e '
const fs = require("node:fs");
const crypto = require("node:crypto");
const dir = "/tmp/gridex-openapi-live";
const manifest = JSON.parse(fs.readFileSync(`${dir}/release-manifest.json`, "utf8"));
const sha = name => crypto.createHash("sha256")
  .update(fs.readFileSync(`${dir}/${name}`))
  .digest("hex");
const actual = {
  website: sha("website-integration-v1.json"),
  customer_portal: sha("customer-portal-v1.json"),
};
for (const key of Object.keys(actual)) {
  const expected = manifest.specifications[key].sha256;
  if (actual[key] !== expected) {
    throw new Error(`${key}: manifest=${expected}, actual=${actual[key]}`);
  }
}
console.log("Live OpenAPI manifest SHA parity: PASS", actual);
'
```

Gridex Web ska synkroniseras först efter att detta kommando passerar och dess
aktuella källkod har tillhandahållits.
