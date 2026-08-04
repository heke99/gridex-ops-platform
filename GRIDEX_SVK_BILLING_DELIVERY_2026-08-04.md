# Gridex OPS — SVK-geodata och canonical billing price area

## Leveransstatus

- Supabase-migrationen är redan applicerad på projekt `piidsfebjqjmnepdpnas`.
- Live migrationsversioner är `20260804190000` och `20260804193000`.
- Databasens SVK-importer, promoter och billing-underlay-trigger är installerade.
- Det trasiga `contract_price_snapshots` tenant-guardet är korrigerat från den obefintliga `customer_contract_id` till `contract_id`.
- Ett riktigt staged SVK-objekt (`BRL`, `SE3`) har verifierats i en rollback-transaktion.
- Ett komplett rollback-test verifierade att en SE3-snapshot fyller SE3 automatiskt och att SE4-avvikelse blockeras.
- Den gamla importen mot fel källversion har stängts som `svk_import_source_superseded`.
- Det finns inga befintliga kundavtal, prissnapshots eller fakturaunderlag i dev som kräver backfill.
- Appkoden är inte deployad från denna leverans och full import av aktuella SVK-geometrier återstår därför.

## Synka ändringspaketet

```bash
rm -rf /tmp/gridex-svk-billing-fix
mkdir -p /tmp/gridex-svk-billing-fix
unzip ~/Downloads/gridex-ops-svk-billing-canonical-fix-2026-08-04.zip -d /tmp/gridex-svk-billing-fix
rsync -av /tmp/gridex-svk-billing-fix/ /Users/hekmath/Projects/gridex-ops-platform/
cd /Users/hekmath/Projects/gridex-ops-platform
```

Paketet är ett changed-files-paket. Använd inte `--delete` med rsync.

## Lokala/CI-kontroller

```bash
nvm use 22
npm ci
npm run gridex:svk-billing-area-regression
npm run db:migrations:check
npm run typecheck
npm test
npm run lint
npm run build
```

I leveransmiljön passerade dependency-free regression, migrationsintegritet och
TypeScript-syntaxkontroll. Full npm-kedja kunde inte köras eftersom npm-registret
inte gick att DNS-resolvera och arkivet saknade `node_modules`.

## Deploy och kör aktuell SVK-import

Deploya OPS-koden först. Kör därefter den autentiserade cron-routen upprepade gånger
så länge svaret anger `hasMore=true`:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $GRID_AREA_IMPORT_CRON_SECRET" \
  "https://app.gridex.se/api/internal/platform/grid-areas/import/cron"
```

Importen använder den aktuella FeatureServer-tjänsten `Natomraden_250526`, layer 3,
och källfälten `Natomrade`, `Namn`, `Agare`, `Elomrade`.

## Databasverifiering efter import

```sql
select version, name
from supabase_migrations.schema_migrations
where version in ('20260804190000', '20260804193000')
order by version;

select
  count(*) filter (where source = 'svk_arcgis' and is_active) as active_svk_geometries,
  count(distinct grid_area_code) filter (where source = 'svk_arcgis' and is_active) as active_grid_area_codes,
  max(imported_at) filter (where source = 'svk_arcgis' and is_active) as latest_imported_at
from public.platform_grid_area_geometries;

select id, version_key, status, coverage_status, feature_count,
       source_url, metadata, verified_at
from public.energy_geodata_versions
where provider = 'svk_arcgis'
order by started_at desc
limit 5;

select
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.billing_underlays'::regclass
      and tgname = 'billing_underlays_price_area_snapshot_guard'
      and not tgisinternal
  ) as billing_price_area_guard_installed;
```

Godkänt resultat kräver en aktuell `verified` geodataversion och fler än noll aktiva
geometrier. Fakturering ska därefter provas med ett riktigt quote -> avtal -> mätvärde
-> fakturaunderlag-flöde där header och rader har exakt samma låsta snapshotområde.
