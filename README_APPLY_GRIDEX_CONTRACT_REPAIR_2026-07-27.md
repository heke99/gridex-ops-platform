# README_APPLY – GRIDEX avtalsreparation 2026-07-27

Målprojekt:

```text
/Users/hekmath/Projects/gridex-ops-platform
```

Leveransen innehåller en patch-ZIP med endast ändrade/tillagda filer, en komplett korrigerad källkods-ZIP, unified diff, slutrapport, verifieringslogg och SHA-256-manifest.

## 1. Ta backup och kontrollera lokalt skick

```bash
set -euo pipefail

PROJECT="/Users/hekmath/Projects/gridex-ops-platform"
BACKUP="$HOME/Backups/gridex-ops-platform-before-contract-repair-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$(dirname "$BACKUP")"
rsync -a --exclude node_modules --exclude .next --exclude .git \
  "$PROJECT/" "$BACKUP/"

cd "$PROJECT"
git status --short
git diff --check
```

Committa eller stash egna lokala ändringar innan synk. Skriv inte över okontrollerade ändringar.

## 2. Packa upp patchen

Antag att filen ligger i `~/Downloads`:

```bash
rm -rf /tmp/gridex-contract-repair-2026-07-27
mkdir -p /tmp/gridex-contract-repair-2026-07-27

unzip -q \
  "$HOME/Downloads/gridex-ops-contract-repair-patch-2026-07-27.zip" \
  -d /tmp/gridex-contract-repair-2026-07-27
```

## 3. Kontrollera checksummor

Lägg även SHA-filerna i `~/Downloads` och kör:

```bash
cd "$HOME/Downloads"
shasum -a 256 -c SHA256SUMS_GRIDEX_CONTRACT_REPAIR_2026-07-27.txt
shasum -a 256 -c SHA256SUMS_GRIDEX_CONTRACT_REPAIR_2026-07-27.txt.sha256
```

## 4. Rsync dry-run

```bash
rsync -av --checksum --itemize-changes --dry-run \
  /tmp/gridex-contract-repair-2026-07-27/gridex-ops-contract-repair-patch-2026-07-27/files/ \
  /Users/hekmath/Projects/gridex-ops-platform/
```

Kontrollera att endast filerna i `CHANGED_FILES_GRIDEX_CONTRACT_REPAIR_2026-07-27.txt` ändras.

## 5. Applicera patchfilerna

```bash
rsync -av --checksum --itemize-changes \
  /tmp/gridex-contract-repair-2026-07-27/gridex-ops-contract-repair-patch-2026-07-27/files/ \
  /Users/hekmath/Projects/gridex-ops-platform/

cd /Users/hekmath/Projects/gridex-ops-platform
git status --short
git diff --check
```

Alternativt kan unified diff testas och appliceras:

```bash
cd /Users/hekmath/Projects/gridex-ops-platform
git apply --check "$HOME/Downloads/gridex-ops-contract-repair-2026-07-27.patch"
git apply "$HOME/Downloads/gridex-ops-contract-repair-2026-07-27.patch"
```

Använd antingen rsync eller `git apply`, inte båda.

## 6. Installera dependencies

Projektet har `package-lock.json`, därför är canonical kommandot:

```bash
cd /Users/hekmath/Projects/gridex-ops-platform
npm ci
```

Om npm svarar med ett temporärt registryfel, kör om när registryt är tillgängligt. Fortsätt inte till release med saknade dependencies.

## 7. Kontrollera migrationer och checksummor

```bash
node scripts/check-migration-versions.cjs
npm run db:migrations:check
```

Förväntat: exit code `0` och samtliga migrationsfiler registrerade.

## 8. Kör statiska avtalsregressioner

```bash
node scripts/gridex-contract-lifecycle-repair-regression.cjs
node scripts/gridex-contract-go-live-regression.cjs
node scripts/gridex-contract-delete-graph-regression.cjs
node scripts/gridex-contract-security-energy-direction-regression.cjs
node scripts/gridex-contract-tenant-lifecycle-regression.cjs
node scripts/gridex-contract-single-source-regression.cjs
node scripts/gridex-canonical-contract-model-regression.cjs
node scripts/gridex-contract-api-signature-visibility-regression.cjs
node scripts/gridex-contract-legal-publication-completion-regression.cjs
node scripts/gridex-platform-tenant-contracts-api-mail-regression.cjs
npm run api:docs
```

## 9. Kör full applikationsverifiering

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Godkänn inte releasen förrän alla processer avslutas med exit code `0`. `next build --webpack` utan avslutad process är inte en godkänd build.

## 10. Kontrollera staging migration history

Kräver korrekt länkad Supabase CLI och stagingcredentials:

```bash
npx supabase migration list --linked
npx supabase db push --linked --dry-run
```

Dry-run ska endast visa de nya framåtriktade migrationerna:

```text
20260727160000_contract_valid_to_active_rpc_repair.sql
20260727161000_contract_type_slug_alignment.sql
```

Stoppa om dry-run vill applicera ett stort antal äldre migrationer. Kör inte `migration repair` eller `db reset --linked` utan separat verifierad anledning.

## 11. Applicera databasmigrationer före applikationskod

```bash
npx supabase db push --linked
npx supabase db lint --linked --schema public --fail-on error
```

Databasen ska deployas före applikationsreleasen eftersom applikationen förlitar sig på reparerade RPC-definitioner och uppdaterade constraints.

## 12. Verifiera live definitioner, grants, constraints och index

Med en separat staging-anslutningssträng:

```bash
DATABASE_URL='postgresql://...' \
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f scripts/gridex-contract-repair-post-apply.sql
```

Scriptet stoppar om:

- `gridex_publish_contract_channel` eller `gridex_archive_contract_product` har okvalificerad `coalesce(valid_to, ...)`;
- nödvändiga aliasreferenser saknas;
- känsliga RPC:er är exekverbara av `PUBLIC`, `anon` eller `authenticated`;
- `service_role` saknar execute;
- canonicala kontraktstyper saknas;
- ett unikt slugindex finns kvar.

## 13. Staging smoke tests

Kör följande i en dedikerad testtenant:

1. Skapa nytt draftavtal.
2. Slutför readiness.
3. Publicera internt.
4. Publicera till API.
5. Publicera till website.
6. Kontrollera public-contracts och diagnostics.
7. Stäng avtalet och verifiera `lifecycle_status = closed`.
8. Arkivera och verifiera `lifecycle_status = archived` samt `archived_at is not null`.
9. Kontrollera att kanaler, publiceringsversioner och assignments är avslutade.
10. Kontrollera att avtalet är dolt i standardlistor och public API men syns under `Arkiverade`.
11. Skapa nytt avtal med samma namn/slug och verifiera att ingen `23505` uppstår.
12. Verifiera typerna `fixed`, `variable_monthly`, `variable_hourly`, `variable_quarterly`, `portfolio`, `mixed`.
13. Försök cross-tenant access och actor spoofing; förvänta säker 403/404 och korrekt audit actor.
14. Refresh båda adminvyerna och public API för att verifiera cacheinvalidering.

## 14. Deploy applikationskod

Efter gröna migrations-, SQL-, typecheck-, lint-, test-, build- och smoke-kontroller:

```bash
cd /Users/hekmath/Projects/gridex-ops-platform
git diff --check
git status --short
```

Commit/pusha via ordinarie releaseflöde och deploya föregående verifierade commit plus denna patch.

## 15. Rollback

Applikationsrollback görs genom att återdeploya föregående verifierade releaseartifact.

Ändra eller radera aldrig en applicerad migration. Databasrollback måste vara en ny framåtriktad migration som:

- behåller kvalificerade `valid_to`-referenser;
- inte återinför unikt slugkrav;
- inte raderar kund-, quote-, faktura-, juridik- eller auditdata;
- inte ger `authenticated` execute på känsliga admin-RPC:er;
- inte återaktiverar arkiverade avtal.

Efter rollback körs åter post-apply-scriptet och hela smoke-testsviten.
