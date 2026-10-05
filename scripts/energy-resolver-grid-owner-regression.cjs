/* eslint-disable @typescript-eslint/no-require-imports */
// This script checks that the energy resolver grid owner migration and related code changes are present in the codebase.
const fs = require('fs')

const aliasRepair = 'supabase/migrations/20260902100045_fix_website_poa_scope_and_grid_owner_aliases.sql'
const checks = [
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'platform_grid_owners'],
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'platform_grid_areas'],
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'platform_grid_area_geometries'],
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'customer_site_resolution'],
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'grid_owner_information_requests'],
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'gridex_point_to_grid_area'],
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'gridex_import_grid_area_geojson_feature'],
  ['lib/energy/resolver.ts', 'resolveEnergyContext'],
  ['lib/energy/resolver.ts', 'publicPriceAreaByPostalCode'],
  ['lib/energy/gridOwnerRequests.ts', 'ensureGridOwnerInformationRequest'],
  ['lib/energy/gridOwnerRequests.ts', 'markFacilityDataReceived'],
  ['lib/website/applicationReview.ts', 'canRequestGridOwnerInformation'],
  ['lib/website/applicationReview.ts', 'facilityVerified'],
  ['lib/website/customerApplications.ts', 'runEnergyResolution'],
  ['lib/website/customerApplications.ts', 'processWebsiteApplicationIntake'],
  ['lib/customer-operations/z01Prerequisites.ts', 'ensureGridOwnerInformationRequest'],
  ['app/admin/website-applications/actions.ts', 'resolveWebsiteApplicationEnergyAction'],
  ['app/admin/website-applications/actions.ts', 'requestWebsiteApplicationGridOwnerInfoAction'],
  ['app/admin/website-applications/actions.ts', 'markWebsiteApplicationFacilityDataReceivedAction'],
  ['app/admin/website-applications/page.tsx', 'Kör adressmatchning'],
  ['app/admin/website-applications/page.tsx', 'Begär uppgifter från nätägare'],
  ['app/api/platform/energy/resolve/route.ts', 'resolveEnergyContext'],
  ['lib/energy/svkGeometryImport.ts', 'N%C3%A4tomr%C3%A5den_240524_2_WFL1'],
  ['app/api/public/energy-area/route.ts', 'public_energy_area_removed'],
  ['supabase/migrations/20260824080448_unique_postal_city_provisional_grid_owner.sql', 'postal_city_consensus'],
  ['supabase/migrations/20260824080448_unique_postal_city_provisional_grid_owner.sql', "'candidateCount' <> '1'"],
  ['supabase/migrations/20260824080448_unique_postal_city_provisional_grid_owner.sql', "'mapping_conflict_count', '0'"],
  ['supabase/migrations/20260824080448_unique_postal_city_provisional_grid_owner.sql', 'new.selected_grid_owner_id := v_ops_grid_owner_id'],
  ['supabase/migrations/20260824080448_unique_postal_city_provisional_grid_owner.sql', "'canonical', false"],
  ['supabase/migrations/20260824080448_unique_postal_city_provisional_grid_owner.sql', "'purpose', 'facility_information_routing'"],
  ['lib/customer-operations/customerIntakeOrchestrator.ts', 'A safely selected provisional grid owner may therefore be used'],
  ['lib/customer-operations/customerIntakeOrchestrator.ts', 'Canonical grid-owner verification remains mandatory below before any switch starts'],
  [aliasRepair, 'gridex_grid_owner_name_key', 'SVK trading names are normalized before canonical owner matching'],
  [aliasRepair, 'candidate_count = 1', 'only an unambiguous canonical grid owner may replace a source alias'],
  [aliasRepair, 'nullif(btrim(ediel_id)', 'canonical alias targets require an Ediel identity'],
  [aliasRepair, 'ops_grid_owner_id is not null', 'canonical alias targets must be mapped into OPS'],
  [aliasRepair, 'create or replace function public.gridex_import_grid_area_master_row', 'future SVK imports reuse canonical actor identities'],
]

let ok = true
for (const check of checks) {
  const [file, needle, why] = check
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (!content.includes(needle)) {
    ok = false
    console.error(`Missing ${needle} in ${file}${why ? ` (${why})` : ''}`)
  }
}

const orchestratorPath = 'lib/customer-operations/customerIntakeOrchestrator.ts'
const orchestrator = fs.existsSync(orchestratorPath) ? fs.readFileSync(orchestratorPath, 'utf8') : ''
const facilityLookupGate = orchestrator.indexOf('if (!context.facilityReady)')
const strictGridOwnerGate = orchestrator.indexOf('if (!context.gridOwnerReady)')
if (facilityLookupGate < 0 || strictGridOwnerGate < 0 || facilityLookupGate >= strictGridOwnerGate) {
  ok = false
  console.error('Facility lookup must be evaluated before strict customer-flow grid-owner verification.')
}

if (!ok) process.exit(1)
console.log(`energy-resolver-grid-owner-regression: ${checks.length} checks passed; provisional lookup ordering verified`)
